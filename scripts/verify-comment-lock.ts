// One-off check that addComment/addInternalNote-blocking logic works as
// intended for resolved leaves (isResolvedLeaveStatus). Pure function check
// only — doesn't hit the API routes (those need an authenticated session) —
// just confirms the shared predicate used by both the POST guards and the
// GET cache-header decision behaves correctly for every status the app uses.
//
// Usage: npx tsx scripts/verify-comment-lock.ts

import { isResolvedLeaveStatus } from "../src/lib/leave-calculator";

const cases: [string, boolean][] = [
  ["pending", false],
  ["manager_approved", false],
  ["approved", true],
  ["rejected", true],
];

let failures = 0;
for (const [status, expected] of cases) {
  const actual = isResolvedLeaveStatus(status);
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${status.padEnd(20)} expected ${expected} got ${actual} ${ok ? "OK" : "MISMATCH"}`);
}

console.log(failures === 0 ? "\nAll cases pass." : `\n${failures} case(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
