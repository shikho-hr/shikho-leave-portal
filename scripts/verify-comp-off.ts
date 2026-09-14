// End-to-end check of the Compensatory Off balance rules against whatever
// DATABASE_URL points at. Creates its own scratch data on one real employee,
// asserts every rule, then deletes everything it made (in a finally block,
// so a failed assertion still cleans up).
//
// Safe to run against production: it only touches TEST_EMAIL's own rows and
// removes them again. Nothing here sends email or creates notifications.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/verify-comp-off.ts
//   TEST_EMAIL=someone@shikho.com npx tsx --env-file=.env.local scripts/verify-comp-off.ts
import { prisma } from "../src/lib/prisma";
import {
  createCompOffCredit,
  decideCompOffCredit,
  getCompOffCredits,
  getCompOffSummary,
  getEmployeeByEmail,
  getLeavesByEmployee,
  getApprovedLeavesByEmployee,
  approveWithCompOffConsumption,
} from "../src/lib/db";
import {
  workDateUsage,
  wouldExceedWorkDate,
  planFifoConsumption,
} from "../src/lib/comp-off";
import { calculateBalance, validateLeaveRequest } from "../src/lib/leave-calculator";
import { generateLeaveId } from "../src/lib/ids";
import { BalanceInfo } from "../src/lib/types";

const EMAIL = process.env.TEST_EMAIL || "julkar.niem@shikho.com";
let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
}

async function balanceFor(email: string) {
  const employee = (await getEmployeeByEmail(email))!;
  const approved = await getApprovedLeavesByEmployee(email);
  const compOff = await getCompOffSummary(email);
  return calculateBalance(employee, approved, undefined, undefined, undefined, undefined, compOff);
}

async function validate(email: string, days: number, extraWork?: { startDate: string; endDate: string }) {
  const employee = (await getEmployeeByEmail(email))!;
  const b = await balanceFor(email);
  const year = String(new Date().getFullYear());
  const balancesByYear: Record<string, BalanceInfo> = { [year]: b };
  const leaves = await getLeavesByEmployee(email);
  const credits = await getCompOffCredits(email);
  return validateLeaveRequest(
    employee, balancesByYear, "compensatory", days, { [year]: days },
    `${year}-06-15`, undefined, leaves, extraWork, credits
  );
}

async function main() {
  const employee = await getEmployeeByEmail(EMAIL);
  if (!employee) throw new Error(`${EMAIL} not found`);
  console.log(`host ${new URL(process.env.DATABASE_URL!).host.split(".")[0]} | employee ${employee.name} (${employee.contractType})\n`);

  const createdCredits: string[] = [];
  const createdLeaves: string[] = [];
  const D1 = "2026-03-07", D2 = "2026-03-14", D3 = "2026-03-21";

  try {
    const before = await getCompOffSummary(EMAIL);
    console.log("starting summary:", JSON.stringify(before), "\n");

    // 1. A pending credit is not yet spendable.
    const c1 = await createCompOffCredit({ employeeEmail: EMAIL, workDate: D1, days: 1, reason: "scratch 1" });
    createdCredits.push(c1);
    let s = await getCompOffSummary(EMAIL);
    check("pending credit adds to pending, not remaining", [s.pending - before.pending, s.remaining - before.remaining], [1, 0]);

    // 2. Accepting it makes it spendable.
    await decideCompOffCredit(c1, "accepted", "test@shikho.com", "");
    s = await getCompOffSummary(EMAIL);
    check("accepted credit becomes remaining", s.remaining - before.remaining, 1);

    // 3. Card arithmetic: Remaining + Taken = Entitled.
    const b = await balanceFor(EMAIL);
    check("remaining + taken = entitled", b.remaining.compensatory + b.used.compensatory, b.entitled.compensatory);

    // 4. The same work date can't be claimed again in full.
    let credits = await getCompOffCredits(EMAIL);
    let leaves = await getLeavesByEmployee(EMAIL);
    check("full day already used is blocked", wouldExceedWorkDate(workDateUsage(credits, leaves), D1, 1), true);
    check("half day on a used full day is blocked", wouldExceedWorkDate(workDateUsage(credits, leaves), D1, 0.5), true);

    // 5. Half days share a date up to 1.0.
    const h1 = await createCompOffCredit({ employeeEmail: EMAIL, workDate: D2, days: 0.5, reason: "scratch half a" });
    createdCredits.push(h1);
    credits = await getCompOffCredits(EMAIL);
    check("second half day on the same date is allowed", wouldExceedWorkDate(workDateUsage(credits, leaves), D2, 0.5), false);
    const h2 = await createCompOffCredit({ employeeEmail: EMAIL, workDate: D2, days: 0.5, reason: "scratch half b" });
    createdCredits.push(h2);
    credits = await getCompOffCredits(EMAIL);
    check("a third half day on the same date is blocked", wouldExceedWorkDate(workDateUsage(credits, leaves), D2, 0.5), true);

    // 6. Balance mode: 1 day available, so 1 passes and 2 fails.
    check("balance-drawn 1 day valid", (await validate(EMAIL, 1)).valid, true);
    const tooMuch = await validate(EMAIL, 2);
    check("balance-drawn 2 days rejected", tooMuch.valid, false);
    console.log(`     message: ${tooMuch.error}`);

    // 7. An explicit-date request on an already-claimed date is rejected.
    const reused = await validate(EMAIL, 1, { startDate: D1, endDate: D1 });
    check("explicit-date reuse rejected", reused.valid, false);
    check("with the exact HR wording", reused.error, "This Additional Work Date has been used");

    // 8. An explicit-date request on a free date passes without a balance.
    check("explicit-date on a free date valid", (await validate(EMAIL, 1, { startDate: D3, endDate: D3 })).valid, true);

    // 9. Reservation: a pending balance-drawn leave blocks spending twice.
    const lv = generateLeaveId();
    await prisma.leave.create({ data: {
      id: lv, employeeEmail: EMAIL, employeeName: employee.name, leaveType: "compensatory",
      startDate: new Date("2026-06-15"), endDate: new Date("2026-06-15"), days: 1,
      daysByYear: { "2026": 1 }, reason: "scratch balance-drawn", status: "pending",
      appliedOn: new Date("2026-06-01"), reviewedBy: "", reviewedOn: "", reviewerComments: "",
    } });
    createdLeaves.push(lv);
    const second = await validate(EMAIL, 1);
    check("second balance-drawn request blocked while one is pending", second.valid, false);
    console.log(`     message: ${second.error}`);

    // 10. FIFO: approving consumes the oldest credit first.
    const ok = await approveWithCompOffConsumption(lv, EMAIL, 1, "test@shikho.com", "");
    check("approval consumed the balance", ok, true);
    const after = await prisma.compOffCredit.findUnique({ where: { id: c1 } });
    check("oldest credit consumed first (FIFO)", after?.consumedDays.toNumber(), 1);
    s = await getCompOffSummary(EMAIL);
    check("remaining back to start", s.remaining - before.remaining, 0);
    check("consumed recorded", s.consumed - before.consumed, 1);

    // 11. Approving again with nothing left fails cleanly.
    check("approval with an exhausted balance refuses", await approveWithCompOffConsumption(lv, EMAIL, 1, "t@x.com", ""), false);

    // 12. FIFO planner picks oldest first across several credits.
    const plan = planFifoConsumption(
      [
        { id: "new", workDate: "2026-05-01", days: 1, consumedDays: 0, status: "accepted", createdAt: "2026-05-01T00:00:00Z" },
        { id: "old", workDate: "2026-01-01", days: 1, consumedDays: 0, status: "accepted", createdAt: "2026-01-01T00:00:00Z" },
      ],
      1.5
    );
    check("FIFO order is oldest work date first", plan?.map((p) => p.id), ["old", "new"]);
  } finally {
    for (const id of createdLeaves) await prisma.leave.delete({ where: { id } }).catch(() => {});
    for (const id of createdCredits) await prisma.compOffCredit.delete({ where: { id } }).catch(() => {});
    const s = await getCompOffSummary(EMAIL);
    console.log(`\ncleaned up | summary now: ${JSON.stringify(s)}`);
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
