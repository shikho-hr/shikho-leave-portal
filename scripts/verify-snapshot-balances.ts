// Read-only check: for every active employee with a balance snapshot, run
// the app's real calculateBalance() (same inputs as /api/balance) and
// compare remaining sick/casual/annual against the sheet's Balance columns.
// Usage: npx tsx --env-file=.env.local scripts/verify-snapshot-balances.ts
import {
  getEmployees,
  getLeavesByEmployee,
  getOpeningBalance,
  getAllBalanceSnapshots,
} from "../src/lib/db";
import { calculateBalance } from "../src/lib/leave-calculator";

async function main() {
  const employees = (await getEmployees()).filter((e) => e.status === "active");
  const snapshots = await getAllBalanceSnapshots();
  let checked = 0;
  const mismatches: string[] = [];
  for (const e of employees) {
    const snap = snapshots.get(e.email.toLowerCase());
    if (!snap) continue;
    checked++;
    const leaves = await getLeavesByEmployee(e.email);
    const approved = leaves.filter((l) => l.status === "approved");
    const opening = (await getOpeningBalance(e.email)) ?? undefined;
    const b = calculateBalance(e, approved, opening, snap);
    for (const type of ["annual", "sick", "casual"] as const) {
      const entry = snap[type];
      if (!entry) continue;
      if (Math.abs(b.remaining[type] - entry.balance) > 0.01) {
        mismatches.push(`${e.email} ${type}: portal=${b.remaining[type]} sheet=${entry.balance} (entitled=${entry.entitled} taken=${entry.taken})`);
      }
    }
  }
  console.log(`active employees with a snapshot: ${checked}`);
  console.log(`mismatches vs sheet balance: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 20)) console.log("  " + m);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
