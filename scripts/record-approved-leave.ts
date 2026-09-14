// Record a leave that was approved outside the portal (HR tells us after the
// fact). Direct insert like the historical import: no notifications, no
// emails. Idempotent per (email, type, date). Refreshes the admin balance cache.
//
// Usage (staging):
//   LEAVE_EMAIL=x@shikho.com LEAVE_DATE=2026-09-14 LEAVE_TYPE=sick REVIEWED_ON=2026-09-14 \n//     npx tsx --env-file=.env.local scripts/record-approved-leave.ts
// Prefix DATABASE_URL="<prod pooled url>" to target production.
//
// REVIEWED_ON decides whether it reduces the balance: a date on/after the
// balance snapshot's importedAt counts against the balance; an earlier date
// records it as history only (already inside the HR sheet's "taken").
import { prisma } from "../src/lib/prisma";
import { generateLeaveId } from "../src/lib/ids";
import { calculateLeaveDays, calculateBalance } from "../src/lib/leave-calculator";
import { getEmployeeByEmail, getLeavesByEmployee, getBalanceSnapshot, refreshEmployeeBalanceCache } from "../src/lib/db";
async function main() {
  const email = process.env.LEAVE_EMAIL!, date = process.env.LEAVE_DATE!, type = process.env.LEAVE_TYPE!, reviewedOn = process.env.REVIEWED_ON!;
  const emp = await getEmployeeByEmail(email);
  if (!emp || emp.status !== "active") throw new Error("employee not found/active");
  const existing = await prisma.leave.findFirst({ where: { employeeEmail: email, leaveType: type, startDate: new Date(date) } });
  if (existing) console.log("already recorded:", existing.id, existing.status);
  else {
    const days = calculateLeaveDays(date, date, "", [], []);
    const row = await prisma.leave.create({ data: {
      id: generateLeaveId(), employeeEmail: email, employeeName: emp.name, leaveType: type,
      startDate: new Date(date), endDate: new Date(date), days, daysByYear: { [date.slice(0, 4)]: days },
      reason: `${type[0].toUpperCase()}${type.slice(1)} leave - approved outside the portal, recorded by HR`, status: "approved",
      appliedOn: new Date(date), reviewedBy: "julkar.niem@shikho.com", reviewedOn, reviewerComments: "",
    } });
    console.log("created:", row.id, "days =", days);
  }
  const approved = (await getLeavesByEmployee(email)).filter((l) => l.status === "approved");
  const b = calculateBalance(emp, approved, undefined, (await getBalanceSnapshot(email)) ?? undefined);
  console.log(`${type} now: entitled=${b.entitled[type as "sick"]} used=${b.used[type as "sick"]} remaining=${b.remaining[type as "sick"]}`);
  const c = await refreshEmployeeBalanceCache();
  console.log("cache refreshed, cached", type, "=", c.data[email]?.[type as "sick"]);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
