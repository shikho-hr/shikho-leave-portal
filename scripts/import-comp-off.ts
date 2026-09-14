// One-off import of the Compensatory Off balances employees already had
// before the portal tracked them, plus any comp-off they'd already taken
// against those days.
//
// Usage (dry run prints a per-employee before/after table and writes
// nothing):
//   CREDITS_CSV="C:\path\credits.csv" [TAKEN_CSV="C:\path\taken.csv"] \
//     npx tsx --env-file=.env.local scripts/import-comp-off.ts
// Then re-run with --commit. Prefix DATABASE_URL="<prod pooled url>" to
// target production.
//
// CREDITS_CSV columns (header row required, order doesn't matter):
//   email, workDate, days, reason
//     workDate  YYYY-MM-DD or D-MMM-YY(YY), the day they worked extra
//     days      1 or 0.5
//     reason    free text; defaults to "Pre-portal compensatory off balance"
//
// TAKEN_CSV columns (optional — comp-off already taken against those days):
//   email, startDate, endDate, days, reason
//
// Credits are written as already-accepted (source "import", so they're
// distinguishable from anything an employee recorded), taken leaves as
// approved balance-drawn comp-off leaves with no work dates, and the FIFO
// consumption is then applied so each person's remaining balance matches
// what HR expects.
//
// Idempotent: a credit is skipped when that employee already has one for
// the same work date and day count; a taken leave is skipped when one
// already exists for the same employee, type and start date.

import * as fs from "fs";
import { prisma } from "../src/lib/prisma";
import {
  createCompOffCredit,
  getCompOffCredits,
  getCompOffSummary,
  getEmployees,
  getLeavesByEmployee,
} from "../src/lib/db";
import {
  WORK_DATE_ALREADY_USED,
  planFifoConsumption,
  round,
  workDateUsage,
  wouldExceedWorkDate,
} from "../src/lib/comp-off";
import { generateHistoricalLeaveId } from "../src/lib/ids";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// Accepts "2026-03-07" and the "7-Mar-26" / "7-Mar-2026" shapes Google
// Sheets exports, same as the other import scripts on this project.
function parseDate(raw: string): string | null {
  const s = (raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (!m) return null;
  const [, day, mon, yr] = m;
  const month = MONTHS[mon.toLowerCase()];
  if (!month) return null;
  const year = yr.length === 4 ? yr : `20${yr}`;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

// Minimal quote-aware CSV reader — the same reason the historical import
// uses Python's csv module: reasons contain commas.
function readCsv(path: string): Record<string, string>[] {
  const text = fs.readFileSync(path, "utf-8").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

async function main() {
  const commit = process.argv.includes("--commit");
  const creditsCsv = process.env.CREDITS_CSV;
  const takenCsv = process.env.TAKEN_CSV;
  if (!creditsCsv) throw new Error("CREDITS_CSV is not set");

  console.log(`host ${new URL(process.env.DATABASE_URL!).host.split(".")[0]}`);
  console.log(`mode ${commit ? "COMMIT" : "dry run"}\n`);

  const employees = await getEmployees();
  const byEmail = new Map(employees.map((e) => [e.email.toLowerCase(), e]));

  type Credit = { email: string; workDate: string; days: number; reason: string };
  type Taken = { email: string; startDate: string; endDate: string; days: number; reason: string };

  const credits: Credit[] = [];
  const takenLeaves: Taken[] = [];
  const skipped: string[] = [];

  // Accept HR's own headers ("Additional Work Date", "Day(s)") as well as
  // the plain ones documented above.
  const col = (r: Record<string, string>, ...names: string[]) =>
    names.map((n) => r[n]).find((v) => v !== undefined && v !== "") ?? "";
  for (const [i, r] of readCsv(creditsCsv).entries()) {
    const email = col(r, "email", "email address").toLowerCase();
    const workDate = parseDate(col(r, "workdate", "additional work date", "work date"));
    const days = Number(col(r, "days", "day(s)"));
    if (!byEmail.has(email)) { skipped.push(`credits row ${i + 2}: no employee "${email}"`); continue; }
    if (!workDate) { skipped.push(`credits row ${i + 2}: bad workDate "${col(r, "workdate", "additional work date", "work date")}"`); continue; }
    if (days !== 1 && days !== 0.5) { skipped.push(`credits row ${i + 2}: days must be 1 or 0.5, got "${r.days}"`); continue; }
    credits.push({ email, workDate, days, reason: col(r, "reason") || "Pre-portal compensatory off balance" });
  }

  if (takenCsv) {
    for (const [i, r] of readCsv(takenCsv).entries()) {
      const email = (r.email || "").toLowerCase();
      const startDate = parseDate(r.startdate);
      const endDate = parseDate(r.enddate) || startDate;
      const days = Number(r.days);
      if (!byEmail.has(email)) { skipped.push(`taken row ${i + 2}: no employee "${r.email}"`); continue; }
      if (!startDate || !endDate) { skipped.push(`taken row ${i + 2}: bad dates`); continue; }
      if (!(days > 0)) { skipped.push(`taken row ${i + 2}: bad days "${r.days}"`); continue; }
      takenLeaves.push({ email, startDate, endDate, days, reason: r.reason || "Compensatory off taken before the portal" });
    }
  }

  const affected = Array.from(new Set([...credits, ...takenLeaves].map((r) => r.email)));
  console.log(`Parsed ${credits.length} credit(s) and ${takenLeaves.length} taken leave(s) across ${affected.length} employee(s).`);
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} row(s):`);
    for (const s of skipped.slice(0, 20)) console.log(`  ${s}`);
    if (skipped.length > 20) console.log(`  ... and ${skipped.length - 20} more`);
  }

  // Per-employee plan, checking the never-twice rule as we go.
  const before = new Map<string, number>();
  const conflicts: string[] = [];
  const toCreateCredits: Credit[] = [];
  const toCreateLeaves: Taken[] = [];

  for (const email of affected) {
    const [existingCredits, existingLeaves] = await Promise.all([
      getCompOffCredits(email),
      getLeavesByEmployee(email),
    ]);
    before.set(email, (await getCompOffSummary(email)).remaining);

    const usage = workDateUsage(existingCredits, existingLeaves);
    for (const c of credits.filter((x) => x.email === email)) {
      const duplicate = existingCredits.some(
        (e) => e.workDate === c.workDate && e.days === c.days && e.status !== "rejected"
      );
      if (duplicate) continue; // idempotent re-run
      if (wouldExceedWorkDate(usage, c.workDate, c.days)) {
        conflicts.push(`${email} ${c.workDate} (${c.days}d): ${WORK_DATE_ALREADY_USED}`);
        continue;
      }
      usage.set(c.workDate, (usage.get(c.workDate) ?? 0) + c.days);
      toCreateCredits.push(c);
    }

    for (const t of takenLeaves.filter((x) => x.email === email)) {
      const duplicate = existingLeaves.some(
        (l) => l.leaveType === "compensatory" && l.startDate === t.startDate
      );
      if (!duplicate) toCreateLeaves.push(t);
    }
  }

  if (conflicts.length) {
    console.log(`\n${conflicts.length} work date(s) already claimed — these are NOT imported:`);
    for (const c of conflicts.slice(0, 20)) console.log(`  ${c}`);
  }
  console.log(`\nTo create: ${toCreateCredits.length} credit(s), ${toCreateLeaves.length} taken leave(s).`);

  // Projected remaining per employee, so the numbers can be eyeballed
  // against HR's own sheet before anything is written.
  console.log("\nemployee                                  before  +credits  -taken   after");
  for (const email of affected) {
    const add = toCreateCredits.filter((c) => c.email === email).reduce((s, c) => s + c.days, 0);
    const take = toCreateLeaves.filter((t) => t.email === email).reduce((s, t) => s + t.days, 0);
    const b = before.get(email) ?? 0;
    console.log(
      `${email.padEnd(40)} ${String(b).padStart(6)}  ${String(round(add)).padStart(8)}  ${String(round(take)).padStart(6)}  ${String(round(b + add - take)).padStart(6)}`
    );
  }

  if (!commit) {
    console.log("\nDry run only — no writes made. Re-run with --commit to import.");
    return;
  }

  let createdCredits = 0;
  for (const c of toCreateCredits) {
    await createCompOffCredit({
      employeeEmail: c.email,
      workDate: c.workDate,
      days: c.days,
      reason: c.reason,
      status: "accepted",
      source: "import",
      reviewedBy: "hr.portal@shikho.com",
      reviewedOn: new Date().toISOString().split("T")[0],
    });
    createdCredits++;
  }
  console.log(`\nCreated ${createdCredits} accepted credit(s).`);

  let createdLeaves = 0;
  for (const t of toCreateLeaves) {
    const employee = byEmail.get(t.email)!;
    const year = t.startDate.slice(0, 4);
    await prisma.leave.create({
      data: {
        id: generateHistoricalLeaveId(),
        employeeEmail: t.email,
        employeeName: employee.name,
        leaveType: "compensatory",
        startDate: new Date(t.startDate),
        endDate: new Date(t.endDate),
        days: t.days,
        daysByYear: { [year]: t.days },
        reason: t.reason,
        status: "approved",
        appliedOn: new Date(t.startDate),
        // No extraWork dates: these draw on the imported balance, so the
        // FIFO pass below is what pays for them.
        reviewedBy: "hr.portal@shikho.com",
        reviewedOn: t.startDate,
        reviewerComments: "",
      },
    });
    createdLeaves++;
  }
  console.log(`Created ${createdLeaves} approved comp-off leave(s).`);

  // Apply FIFO consumption for everything just imported, so remaining
  // lands where HR expects instead of showing the full credited total.
  console.log("\nApplying FIFO consumption...");
  for (const email of affected) {
    const take = toCreateLeaves.filter((t) => t.email === email).reduce((s, t) => s + t.days, 0);
    if (take <= 0) continue;
    const rows = await getCompOffCredits(email);
    const plan = planFifoConsumption(rows, take);
    if (!plan) {
      console.log(`  ${email}: NOT ENOUGH credits to cover ${take} day(s) taken — left unconsumed, check this one`);
      continue;
    }
    for (const step of plan) {
      await prisma.compOffCredit.update({
        where: { id: step.id },
        data: { consumedDays: step.consumedDays },
      });
    }
  }

  console.log("\nemployee                                  expected   actual");
  let mismatches = 0;
  for (const email of affected) {
    const add = toCreateCredits.filter((c) => c.email === email).reduce((s, c) => s + c.days, 0);
    const take = toCreateLeaves.filter((t) => t.email === email).reduce((s, t) => s + t.days, 0);
    const expected = round((before.get(email) ?? 0) + add - take);
    const actual = (await getCompOffSummary(email)).remaining;
    if (Math.abs(expected - actual) > 0.001) mismatches++;
    console.log(
      `${email.padEnd(40)} ${String(expected).padStart(8)} ${String(actual).padStart(8)}${
        Math.abs(expected - actual) > 0.001 ? "  <-- MISMATCH" : ""
      }`
    );
  }
  console.log(mismatches === 0 ? "\nDone — every balance matches." : `\n${mismatches} balance(s) differ, investigate before telling HR it's done.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
