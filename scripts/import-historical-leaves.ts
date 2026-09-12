// One-off historical leave import — see prepare-import-data.py (must be run
// first to produce historical-leaves-clean.json) and
// .claude/plans/cozy-soaring-mccarthy.md for the full design/rationale.
// Usage: npx tsx scripts/import-historical-leaves.ts [--commit]
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/prisma";
import { getEmployees } from "../src/lib/db";
import { calculateLeaveDays, splitDaysByYear } from "../src/lib/leave-calculator";
import { generateHistoricalLeaveId } from "../src/lib/ids";

interface CleanRow {
  sourceRow: number;
  email: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  appliedOn: string;
  days: number | null;
  reason: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const dataPath = path.join(__dirname, "historical-leaves-clean.json");
  const rows: CleanRow[] = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

  const employees = await getEmployees();
  const employeeByEmail = new Map(employees.map((e) => [e.email.toLowerCase(), e]));

  const skippedUnmatched: { sourceRow: number; email: string }[] = [];
  const toInsert: {
    id: string;
    employeeEmail: string;
    employeeName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
    daysByYear: Record<string, number>;
    reason: string;
    status: string;
    appliedOn: string;
  }[] = [];

  for (const row of rows) {
    const employee = employeeByEmail.get(row.email);
    if (!employee) {
      skippedUnmatched.push({ sourceRow: row.sourceRow, email: row.email });
      continue;
    }

    let days = row.days;
    if (days === null) {
      days = calculateLeaveDays(row.startDate, row.endDate, "", [], []);
    }

    const startYear = row.startDate.slice(0, 4);
    const endYear = row.endDate.slice(0, 4);
    let daysByYear: Record<string, number>;
    if (startYear === endYear) {
      daysByYear = { [startYear]: days };
    } else {
      // Rare cross-year span — use the same weekday-exclusion split the
      // app itself uses, and let the sum become the authoritative `days`
      // for consistency (overrides the CSV's total in this rare case).
      daysByYear = splitDaysByYear(row.startDate, row.endDate, "", [], []);
      days = Object.values(daysByYear).reduce((a, b) => a + b, 0);
    }

    toInsert.push({
      id: generateHistoricalLeaveId(),
      employeeEmail: employee.email,
      employeeName: employee.name,
      leaveType: row.leaveType,
      startDate: row.startDate,
      endDate: row.endDate,
      days,
      daysByYear,
      reason: row.reason,
      status: "approved",
      appliedOn: row.appliedOn,
    });
  }

  console.log(`Parsed rows: ${rows.length}`);
  console.log(`Matched to a current employee: ${toInsert.length}`);
  console.log(`Skipped (no matching employee): ${skippedUnmatched.length}`);
  const distinctSkippedEmails = new Set(skippedUnmatched.map((s) => s.email));
  console.log(`  distinct unmatched emails: ${distinctSkippedEmails.size}`);

  const skipReportPath = path.join(
    process.cwd(),
    "historical-import-skipped.csv"
  );
  fs.writeFileSync(
    skipReportPath,
    "sourceRow,email\n" +
      skippedUnmatched.map((s) => `${s.sourceRow},${s.email}`).join("\n")
  );
  console.log(`Full skip list written to ${skipReportPath}`);

  if (!commit) {
    console.log("\nDry run only — no writes made. Re-run with --commit to import.");
    return;
  }

  console.log(`\nCommitting ${toInsert.length} leave records...`);
  let created = 0;
  const failures: { id: string; error: string }[] = [];
  for (const batch of chunk(toInsert, 200)) {
    const results = await Promise.allSettled(
      batch.map((r) =>
        prisma.leave.create({
          data: {
            id: r.id,
            employeeEmail: r.employeeEmail,
            employeeName: r.employeeName,
            leaveType: r.leaveType,
            startDate: new Date(r.startDate),
            endDate: new Date(r.endDate),
            days: r.days,
            daysByYear: r.daysByYear,
            reason: r.reason,
            status: r.status,
            appliedOn: new Date(r.appliedOn),
            reviewedBy: "",
            reviewedOn: "",
            reviewerComments: "",
          },
        })
      )
    );
    results.forEach((res, i) => {
      if (res.status === "fulfilled") created++;
      else failures.push({ id: batch[i].id, error: String(res.reason) });
    });
  }

  console.log(`Created: ${created}`);
  console.log(`Failed: ${failures.length}`);
  if (failures.length) console.log(failures.slice(0, 10));
}

main().then(() => process.exit(0));
