// One-off historical leave import — see prepare-import-data.py (must be run
// first to produce historical-leaves-clean.json) and
// .claude/plans/cozy-soaring-mccarthy.md for the full design/rationale.
// Usage: npx tsx scripts/import-historical-leaves.ts [--commit] [--replace]
//          [--types=sick,casual] [--year=2026] [--skip-existing]
//   --replace        delete every existing "HIST-…" leave first (a previous
//                    run of this import) so the file is loaded fresh, not
//                    appended. Don't combine with --types/--year.
//   --types=a,b      only import these leave types (default: all parsed).
//   --year=YYYY      only import leaves starting in this year.
//   --skip-existing  skip a row when the employee already has a leave of the
//                    same type starting on the same date (any status) — so a
//                    leave HR already recorded by hand isn't duplicated.
//
// Rows are written with a blank reviewedOn, so for anyone with a balance
// snapshot they are history only and never change a balance (see
// calculateBalance). For someone WITHOUT a snapshot, current-year rows do
// count as used — the run reports how many matched rows fall in that case.
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
  halfDayPeriod?: "first_half" | "second_half" | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const replace = process.argv.includes("--replace");
  const skipExisting = process.argv.includes("--skip-existing");
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const onlyTypes = arg("types")?.split(",").map((t) => t.trim()).filter(Boolean);
  const onlyYear = arg("year");
  if (replace && (onlyTypes || onlyYear)) {
    throw new Error("--replace deletes ALL HIST- leaves; don't combine it with --types/--year.");
  }
  const dataPath = path.join(__dirname, "historical-leaves-clean.json");
  const existingHist = await prisma.leave.count({ where: { id: { startsWith: "HIST-" } } });
  console.log(`Existing HIST- leaves in the database: ${existingHist}${replace ? " (will be deleted first)" : ""}`);
  let rows: CleanRow[] = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  if (onlyTypes) rows = rows.filter((r) => onlyTypes.includes(r.leaveType));
  if (onlyYear) rows = rows.filter((r) => r.startDate.startsWith(`${onlyYear}-`));
  if (onlyTypes || onlyYear) console.log(`Filter: types=${onlyTypes?.join(",") ?? "all"} year=${onlyYear ?? "all"} -> ${rows.length} rows`);

  // For --skip-existing: every (email, type, startDate) already in the table.
  const existingKeys = new Set<string>();
  if (skipExisting) {
    const existing = await prisma.leave.findMany({ select: { employeeEmail: true, leaveType: true, startDate: true } });
    for (const l of existing) existingKeys.add(`${l.employeeEmail.toLowerCase()}|${l.leaveType}|${l.startDate.toISOString().slice(0, 10)}`);
  }
  const snapshotEmails = new Set((await prisma.balanceSnapshot.findMany({ select: { email: true } })).map((s) => s.email.toLowerCase()));

  const employees = await getEmployees();
  const employeeByEmail = new Map(employees.map((e) => [e.email.toLowerCase(), e]));

  const skippedUnmatched: { sourceRow: number; email: string }[] = [];
  const oddDates: { sourceRow: number; email: string; start: string; end: string; days: number }[] = [];
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
    halfDayPeriod: string | null;
  }[] = [];

  let skippedExisting = 0;
  let matchedWithoutSnapshot = 0;
  for (const row of rows) {
    const employee = employeeByEmail.get(row.email);
    if (!employee) {
      skippedUnmatched.push({ sourceRow: row.sourceRow, email: row.email });
      continue;
    }
    if (skipExisting && existingKeys.has(`${employee.email.toLowerCase()}|${row.leaveType}|${row.startDate}`)) {
      skippedExisting++;
      continue;
    }
    if (!snapshotEmails.has(employee.email.toLowerCase())) matchedWithoutSnapshot++;

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
      const split = splitDaysByYear(row.startDate, row.endDate, "", [], []);
      const splitTotal = Object.values(split).reduce((a, b) => a + b, 0);
      if (splitTotal > 0 && splitTotal <= 366) {
        daysByYear = split;
        days = splitTotal;
      } else {
        // A typo'd date in the source (year "0222", end before start, a
        // multi-year span…) makes the split meaningless — or larger than
        // the numeric(5,1) column can hold. Keep the sheet's own day count,
        // attribute it to the start year, and report the row.
        daysByYear = { [startYear]: days };
        oddDates.push({ sourceRow: row.sourceRow, email: row.email, start: row.startDate, end: row.endDate, days });
      }
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
      halfDayPeriod: row.halfDayPeriod ?? null,
    });
  }

  console.log(`Parsed rows: ${rows.length}`);
  console.log(`Matched to a current employee: ${toInsert.length}`);
  console.log(`Skipped (no matching employee): ${skippedUnmatched.length}`);
  const distinctSkippedEmails = new Set(skippedUnmatched.map((s) => s.email));
  console.log(`  distinct unmatched emails: ${distinctSkippedEmails.size}`);
  if (skipExisting) console.log(`Skipped (same employee/type/start date already recorded): ${skippedExisting}`);
  console.log(`Matched rows for employees WITHOUT a balance snapshot (these WILL count as used): ${matchedWithoutSnapshot}`);
  if (oddDates.length) {
    console.log(`Rows with implausible cross-year dates (imported with the sheet's day count, start-year attribution):`);
    for (const o of oddDates) console.log(`  row ${o.sourceRow} ${o.email} ${o.start} -> ${o.end} days=${o.days}`);
  }

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

  if (replace && existingHist > 0) {
    const { count } = await prisma.leave.deleteMany({ where: { id: { startsWith: "HIST-" } } });
    console.log(`Deleted ${count} previous HIST- leaves.`);
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
            halfDayPeriod: r.halfDayPeriod,
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
