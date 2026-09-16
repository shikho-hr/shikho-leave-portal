// Record a leave that was approved outside the portal (HR tells us after the
// fact). Direct insert like the historical import: no notifications, no
// emails. Idempotent per (email, type, start date). Refreshes the admin
// balance cache.
//
// Usage (staging/local dev):
//   LEAVE_EMAIL=x@shikho.com LEAVE_START=2026-09-15 LEAVE_TYPE=sick REVIEWED_ON=2026-09-15 \
//     npx tsx --env-file=.env.local scripts/record-approved-leave.ts
// Prefix DATABASE_URL="<prod pooled url>" to target production.
//
// Optional: LEAVE_END (defaults to LEAVE_START, for a multi-day request),
// LEAVE_HALF_DAY (first_half|second_half), LEAVE_REASON (defaults to a
// generic "approved outside the portal" note if left unset).
//
// REVIEWED_ON decides whether it reduces the balance: a date on/after the
// balance snapshot's importedAt counts against the balance; an earlier date
// records it as history only (already inside the HR sheet's "taken").
import { prisma } from "../src/lib/prisma";
import { generateLeaveId } from "../src/lib/ids";
import {
  calculateLeaveDays,
  splitDaysByYear,
} from "../src/lib/leave-calculator";
import {
  getEmployeeByEmail,
  getLeavesByEmployee,
  getBalanceSnapshot,
  getHolidays,
  getWorkingWeekends,
  refreshEmployeeBalanceCache,
} from "../src/lib/db";
import type { HalfDayPeriod } from "../src/lib/types";
import { calculateBalance } from "../src/lib/leave-calculator";

async function main() {
  const email = process.env.LEAVE_EMAIL!;
  const startDate = process.env.LEAVE_START!;
  const endDate = process.env.LEAVE_END || startDate;
  const type = process.env.LEAVE_TYPE!;
  const reviewedOn = process.env.REVIEWED_ON!;
  const halfDayPeriod = (process.env.LEAVE_HALF_DAY || undefined) as
    | HalfDayPeriod
    | undefined;
  const reason =
    process.env.LEAVE_REASON ||
    `${type[0].toUpperCase()}${type.slice(1)} leave - approved outside the portal, recorded by HR`;

  const emp = await getEmployeeByEmail(email);
  if (!emp || emp.status !== "active") throw new Error("employee not found/active");

  const existing = await prisma.leave.findFirst({
    where: { employeeEmail: email, leaveType: type, startDate: new Date(startDate) },
  });
  if (existing) {
    console.log("already recorded:", existing.id, existing.status);
  } else {
    const [holidays, workingWeekends] = await Promise.all([
      getHolidays(),
      getWorkingWeekends(),
    ]);
    const holidayDates = holidays.map((h) => h.date);
    const days = calculateLeaveDays(startDate, endDate, halfDayPeriod, holidayDates, workingWeekends);
    const daysByYear = splitDaysByYear(startDate, endDate, halfDayPeriod, holidayDates, workingWeekends);
    const row = await prisma.leave.create({
      data: {
        id: generateLeaveId(),
        employeeEmail: email,
        employeeName: emp.name,
        leaveType: type,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        days,
        daysByYear,
        ...(halfDayPeriod ? { halfDayPeriod } : {}),
        reason,
        status: "approved",
        appliedOn: new Date(startDate),
        reviewedBy: "julkar.niem@shikho.com",
        reviewedOn,
        reviewerComments: "",
      },
    });
    console.log("created:", row.id, "days =", days, halfDayPeriod ? `(${halfDayPeriod})` : "");
  }

  const approved = (await getLeavesByEmployee(email)).filter((l) => l.status === "approved");
  const b = calculateBalance(emp, approved, undefined, (await getBalanceSnapshot(email)) ?? undefined);
  console.log(`${type} now: entitled=${b.entitled[type as "sick"]} used=${b.used[type as "sick"]} remaining=${b.remaining[type as "sick"]}`);
  const c = await refreshEmployeeBalanceCache();
  console.log("cache refreshed, cached", type, "=", c.data[email]?.[type as "sick"]);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
