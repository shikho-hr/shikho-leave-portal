// Pure-function check of the Saturday-worker day counting (no DB, no login).
// Usage: npx tsx scripts/verify-saturday-workers.ts
import { calculateLeaveDays, splitDaysByYear } from "../src/lib/leave-calculator";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
}

// 2026-10-04 is a Sunday; 09 = Friday, 10 = Saturday.
const week = ["2026-10-04", "2026-10-10"] as const;
check("Sun-Sat, default", calculateLeaveDays(week[0], week[1], "", []), 5);
check("Sun-Sat, Saturday worker", calculateLeaveDays(week[0], week[1], "", [], [], "sick", true), 6);
check("Lone Saturday, default", calculateLeaveDays("2026-10-10", "2026-10-10", "", []), 0);
check("Lone Saturday, worker", calculateLeaveDays("2026-10-10", "2026-10-10", "", [], [], "sick", true), 1);
check("Lone Friday, default", calculateLeaveDays("2026-10-09", "2026-10-09", "", []), 0);
check("Lone Friday, worker", calculateLeaveDays("2026-10-09", "2026-10-09", "", [], [], "sick", true), 0);
check("Saturday holiday, worker", calculateLeaveDays("2026-10-10", "2026-10-10", "", ["2026-10-10"], [], "sick", true), 0);
check("Saturday working-weekend, default", calculateLeaveDays("2026-10-10", "2026-10-10", "", [], ["2026-10-10"]), 1);
check("Saturday working-weekend, worker", calculateLeaveDays("2026-10-10", "2026-10-10", "", [], ["2026-10-10"], "sick", true), 1);
check("Friday working-weekend, worker", calculateLeaveDays("2026-10-09", "2026-10-09", "", [], ["2026-10-09"], "sick", true), 1);
check("Half-day Saturday, default", calculateLeaveDays("2026-10-10", "2026-10-10", "first_half", []), 0);
check("Half-day Saturday, worker", calculateLeaveDays("2026-10-10", "2026-10-10", "first_half", [], [], "sick", true), 0.5);
check("WFH Saturday, default", calculateLeaveDays("2026-10-10", "2026-10-10", "", [], [], "wfh"), 1);
check("WFH Saturday, worker", calculateLeaveDays("2026-10-10", "2026-10-10", "", [], [], "wfh", true), 1);
check("WFH Friday holiday", calculateLeaveDays("2026-10-09", "2026-10-09", "", ["2026-10-09"], [], "wfh", true), 0);
check("Off-site week, worker", calculateLeaveDays(week[0], week[1], "", [], [], "offsite_attendance", true), 7);
check(
  "New Year split, worker (Wed 30 Dec 2026 - Sun 3 Jan 2027)",
  splitDaysByYear("2026-12-30", "2027-01-03", "", [], [], "annual", true),
  { "2026": 2, "2027": 2 } // Wed+Thu | Fri 1 Jan skipped, Sat 2 + Sun 3 count
);
check(
  "New Year split, default",
  splitDaysByYear("2026-12-30", "2027-01-03", "", [], [], "annual"),
  { "2026": 2, "2027": 1 } // Sun 3 Jan only
);

console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
