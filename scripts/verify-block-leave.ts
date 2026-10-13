// Pure-function check of the Maternity/Paternity lifetime-allowance rule (no DB, no login).
// Usage: npx tsx scripts/verify-block-leave.ts
import {
  calculateBalance,
  getAvailableLeaveTypes,
  validateLeaveRequest,
} from "../src/lib/leave-calculator";
import type { BalanceInfo, Employee, LeaveRequest, LeaveStatus, LeaveType } from "../src/lib/types";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
}

const base = {
  id: "x",
  department: "d",
  designation: "d",
  employeeType: "non-tele-sales" as const,
  managerEmail: "m@shikho.com",
  probationEndDate: "2024-02-20",
  role: "employee" as const,
  status: "active" as const,
  fullTimeEffectiveDate: "2023-11-19",
  contractType: "full-time" as const,
  probationAnnualLeaveApproved: false,
  worksSaturday: false,
  lastDay: "",
  joiningDate: "2023-08-20",
};
const man: Employee = { ...base, name: "Nurul", email: "nurul@shikho.com", gender: "male" };
const woman: Employee = { ...base, name: "Woman", email: "w@shikho.com", gender: "female" };

let n = 0;
function leave(
  leaveType: LeaveType,
  days: number,
  startDate: string,
  status: LeaveStatus = "approved"
): LeaveRequest {
  return {
    id: `L${n++}`,
    employeeEmail: "x@shikho.com",
    employeeName: "x",
    leaveType,
    startDate,
    endDate: startDate,
    days,
    reason: "",
    status,
    appliedOn: startDate,
    reviewedBy: "",
    reviewedOn: "",
    reviewerComments: "",
  };
}
const approved = (ls: LeaveRequest[]) => ls.filter((l) => l.status === "approved");
const bal = (e: Employee, ls: LeaveRequest[], year = 2026) =>
  calculateBalance(e, approved(ls), undefined, undefined, year, new Date(`${year}-10-13`));
const rem = (b: BalanceInfo, t: "paternity" | "maternity") => [b.entitled[t], b.used[t], b.remaining[t]];

// Validate a request of `days` on 2026-10-20, against balances for 2026.
function validate(e: Employee, ls: LeaveRequest[], type: LeaveType, days: number) {
  return validateLeaveRequest(
    e,
    { "2026": bal(e, ls) },
    type,
    days,
    { "2026": days },
    "2026-10-20",
    "2026-10-20",
    undefined,
    ls
  );
}

// ── Nurul Amin's real history: 14 (2025) + 5 + 3 (2026) ────────────
const nurul = [
  leave("paternity", 14, "2025-06-19"),
  leave("paternity", 5, "2026-08-09"),
  leave("paternity", 3, "2026-08-30"),
];
check("Nurul balance [entitled, used, remaining]", rem(bal(man, nurul), "paternity"), [28, 22, 6]);
check("Nurul sees Paternity", getAvailableLeaveTypes(man, nurul).includes("paternity"), true);
check("Nurul can take the 6 left", validate(man, nurul, "paternity", 6).valid, true);
check("Nurul cannot take 7", validate(man, nurul, "paternity", 7).valid, false);

// ── Allowance boundaries ───────────────────────────────────────────
check("No leave taken", rem(bal(man, []), "paternity"), [14, 0, 14]);
check("10 taken -> 4 left in first allowance", rem(bal(man, [leave("paternity", 10, "2026-03-01")]), "paternity"), [14, 10, 4]);
check("10 taken, a 5-day request is refused", validate(man, [leave("paternity", 10, "2026-03-01")], "paternity", 5).valid, false);
check("14 taken -> a fresh 14 is added", rem(bal(man, [leave("paternity", 14, "2026-03-01")]), "paternity"), [28, 14, 14]);
check("28 taken -> nothing left", rem(bal(man, [leave("paternity", 14, "2025-03-01"), leave("paternity", 14, "2026-03-01")]), "paternity"), [28, 28, 0]);
const spent = [leave("paternity", 14, "2025-03-01"), leave("paternity", 14, "2026-03-01")];
check("28 taken: type hidden", getAvailableLeaveTypes(man, spent).includes("paternity"), false);
check("28 taken: request refused", validate(man, spent, "paternity", 1).valid, false);

// ── Pending requests reserve days; rejected ones free them ─────────
const pending = [leave("paternity", 14, "2025-03-01"), leave("paternity", 10, "2026-10-01", "pending")];
check("Pending 10 of the fresh 14 leaves 4", validate(man, pending, "paternity", 4).valid, true);
check("...but not 5", validate(man, pending, "paternity", 5).valid, false);
const rejected = [leave("paternity", 14, "2025-03-01"), leave("paternity", 10, "2026-10-01", "rejected")];
check("Rejected request holds nothing", validate(man, rejected, "paternity", 14).valid, true);

// ── Per-request cap and gender gate still hold ─────────────────────
check("15 days in one request is refused", validate(man, [], "paternity", 15).valid, false);
check("Paternity refused for a woman", validate(woman, [], "paternity", 1).valid, false);
check("Paternity not offered to a woman", getAvailableLeaveTypes(woman, []).includes("paternity"), false);

// ── Maternity follows the same rule with 180-day allowances ────────
check("Maternity fresh", rem(bal(woman, []), "maternity"), [180, 0, 180]);
const mat1 = [leave("maternity", 180, "2025-01-01")];
check("Maternity 180 taken -> fresh 180", rem(bal(woman, mat1), "maternity"), [360, 180, 180]);
const mat2 = [leave("maternity", 100, "2025-01-01"), leave("maternity", 80, "2025-06-01"), leave("maternity", 100, "2026-03-01")];
check("Maternity split 100+80+100 -> 80 left", rem(bal(woman, mat2), "maternity"), [360, 280, 80]);
check("Maternity sees type with days left", getAvailableLeaveTypes(woman, mat2).includes("maternity"), true);
check("Maternity 80 allowed", validate(woman, mat2, "maternity", 80).valid, true);
check("Maternity 81 refused", validate(woman, mat2, "maternity", 81).valid, false);
const matDone = [leave("maternity", 180, "2024-01-01"), leave("maternity", 180, "2025-06-01")];
check("Maternity all used: hidden", getAvailableLeaveTypes(woman, matDone).includes("maternity"), false);
check("Maternity is male-blocked", validate(man, [], "maternity", 10).valid, false);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
