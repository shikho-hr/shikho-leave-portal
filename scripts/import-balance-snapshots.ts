// One-off fresh balance snapshot import — see prepare-import-data.py (must
// be run first to produce balance-snapshots-clean.json) and
// .claude/plans/cozy-soaring-mccarthy.md for the full design/rationale.
// Usage: npx tsx scripts/import-balance-snapshots.ts [--commit]
import * as fs from "fs";
import * as path from "path";
import { getEmployees, upsertBalanceSnapshots } from "../src/lib/db";
import { BalanceSnapshot } from "../src/lib/types";

interface CleanRow {
  sourceRow: number;
  email: string;
  casualTaken: number | null;
  casualEntitled: number | null;
  casualBalance: number | null;
  sickTaken: number | null;
  sickEntitled: number | null;
  sickBalance: number | null;
  annualTaken: number | null;
  annualEntitled: number | null;
  annualBalance: number | null;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const dataPath = path.join(__dirname, "balance-snapshots-clean.json");
  const rows: CleanRow[] = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

  const employees = await getEmployees();
  const employeeEmails = new Set(employees.map((e) => e.email.toLowerCase()));

  const skippedUnmatched: { sourceRow: number; email: string }[] = [];
  const importedAt = new Date().toISOString().split("T")[0];
  const snapshots: BalanceSnapshot[] = [];

  for (const row of rows) {
    if (!employeeEmails.has(row.email)) {
      skippedUnmatched.push({ sourceRow: row.sourceRow, email: row.email });
      continue;
    }
    snapshots.push({
      email: row.email,
      casual: {
        taken: row.casualTaken ?? 0,
        entitled: row.casualEntitled ?? 0,
        balance: row.casualBalance ?? 0,
      },
      sick: {
        taken: row.sickTaken ?? 0,
        entitled: row.sickEntitled ?? 0,
        balance: row.sickBalance ?? 0,
      },
      annual: {
        taken: row.annualTaken ?? 0,
        entitled: row.annualEntitled ?? 0,
        balance: row.annualBalance ?? 0,
      },
      importedAt,
    });
  }

  console.log(`Parsed rows: ${rows.length}`);
  console.log(`Matched to a current employee: ${snapshots.length}`);
  console.log(`Skipped (no matching employee): ${skippedUnmatched.length}`);
  if (skippedUnmatched.length) console.log(skippedUnmatched);

  if (!commit) {
    console.log("\nDry run only — no writes made. Re-run with --commit to import.");
    return;
  }

  console.log(`\nCommitting ${snapshots.length} balance snapshots...`);
  await upsertBalanceSnapshots(snapshots);
  console.log("Done.");
}

main().then(() => process.exit(0));
