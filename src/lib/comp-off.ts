// Compensatory Off — shared, pure logic.
//
// Two ways to take a comp-off exist side by side:
//
//   1. Explicit-date (the original): the employee names the extra day(s)
//      they worked on the leave application itself. The work date IS the
//      entitlement, so no balance is involved (Leave.extraWorkStartDate /
//      extraWorkEndDate).
//   2. Balance-drawn (added 2026-09-14): the employee banks additional work
//      days as CompOffCredit rows, a manager or HR admin accepts them, and
//      later leave is applied for with no work dates and consumed FIFO by
//      work date.
//
// Both must respect one rule: a given additional work date can never be
// claimed more than once. Half days are the exception that proves it — the
// same date may appear on several records as long as the total stays at or
// below one full day. workDateUsage()/wouldExceedWorkDate() below are the
// single implementation of that rule, used when recording a credit and when
// submitting an explicit-date leave.
//
// No imports from db.ts or prisma here on purpose: this module is pure so it
// can be unit-checked with plain objects and reused on both sides of the API.

import { parseISO, addDays, isAfter, format } from "date-fns";
import { CompOffCredit, LeaveRequest } from "./types";

export const WORK_DATE_ALREADY_USED = "This Additional Work Date has been used";

// Floating point: 0.5 + 0.5 can land a hair above 1. Compare with slack.
const EPSILON = 1e-9;

export function isBalanceDrawn(leave: {
  leaveType: string;
  extraWorkStartDate?: string;
  extraWorkEndDate?: string;
}): boolean {
  return (
    leave.leaveType === "compensatory" &&
    !leave.extraWorkStartDate &&
    !leave.extraWorkEndDate
  );
}

// Every calendar date in an inclusive range, as "YYYY-MM-DD". Weekends and
// holidays are NOT excluded: the whole point of an additional work day is
// that the person worked on a day they normally wouldn't.
export function datesInRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cursor = parseISO(startDate);
  const end = parseISO(endDate);
  // Guard against a reversed or typo'd range producing an endless loop.
  if (isAfter(cursor, end)) return [startDate];
  while (!isAfter(cursor, end) && out.length < 366) {
    out.push(format(cursor, "yyyy-MM-dd"));
    cursor = addDays(cursor, 1);
  }
  return out;
}

// How much of each additional work date this employee has already claimed,
// across both flows. Rejected records free their date again — same
// convention the original overlap check used, and the same one
// countNonRejectedLifetime() follows elsewhere.
export function workDateUsage(
  credits: Pick<CompOffCredit, "workDate" | "days" | "status">[],
  leaves: Pick<
    LeaveRequest,
    "leaveType" | "status" | "days" | "extraWorkStartDate" | "extraWorkEndDate"
  >[]
): Map<string, number> {
  const usage = new Map<string, number>();
  const add = (date: string, amount: number) =>
    usage.set(date, (usage.get(date) ?? 0) + amount);

  for (const credit of credits) {
    if (credit.status === "rejected") continue;
    add(credit.workDate.slice(0, 10), credit.days);
  }

  for (const leave of leaves) {
    if (leave.leaveType !== "compensatory" || leave.status === "rejected")
      continue;
    if (!leave.extraWorkStartDate || !leave.extraWorkEndDate) continue;
    const dates = datesInRange(leave.extraWorkStartDate, leave.extraWorkEndDate);
    // A 2-day leave backed by a 2-day work range uses 1.0 of each date; a
    // half-day leave over one date uses 0.5 of it.
    const share = leave.days / dates.length;
    for (const date of dates) add(date, Math.min(share, 1));
  }

  return usage;
}

// Would claiming `amount` more of `date` push it past a full day?
export function wouldExceedWorkDate(
  usage: Map<string, number>,
  date: string,
  amount: number
): boolean {
  return (usage.get(date.slice(0, 10)) ?? 0) + amount > 1 + EPSILON;
}

// The first date in `dates` that can't take `amountPerDate` more, or null.
export function firstExhaustedDate(
  usage: Map<string, number>,
  dates: string[],
  amountPerDate: number
): string | null {
  for (const date of dates) {
    if (wouldExceedWorkDate(usage, date, amountPerDate)) return date;
  }
  return null;
}

export function summarize(
  credits: Pick<CompOffCredit, "days" | "consumedDays" | "status">[],
  explicitDays: number
): { accepted: number; consumed: number; remaining: number; pending: number; explicitDays: number } {
  let accepted = 0;
  let consumed = 0;
  let pending = 0;
  for (const credit of credits) {
    if (credit.status === "accepted") {
      accepted += credit.days;
      consumed += credit.consumedDays;
    } else if (credit.status === "pending") {
      pending += credit.days;
    }
  }
  return {
    accepted: round(accepted),
    consumed: round(consumed),
    remaining: round(accepted - consumed),
    pending: round(pending),
    explicitDays: round(explicitDays),
  };
}

// Which accepted credits to draw `days` from, oldest work date first. Pure:
// the caller writes the increments inside a transaction. Returns null when
// the balance can't cover the request.
export function planFifoConsumption(
  credits: Pick<CompOffCredit, "id" | "workDate" | "days" | "consumedDays" | "status" | "createdAt">[],
  days: number
): { id: string; consumedDays: number }[] | null {
  const spendable = credits
    .filter((c) => c.status === "accepted" && c.days - c.consumedDays > EPSILON)
    .sort((a, b) =>
      a.workDate === b.workDate
        ? a.createdAt.localeCompare(b.createdAt)
        : a.workDate.localeCompare(b.workDate)
    );

  const plan: { id: string; consumedDays: number }[] = [];
  let outstanding = days;
  for (const credit of spendable) {
    if (outstanding <= EPSILON) break;
    const available = credit.days - credit.consumedDays;
    const take = Math.min(available, outstanding);
    plan.push({ id: credit.id, consumedDays: round(credit.consumedDays + take) });
    outstanding = round(outstanding - take);
  }

  return outstanding > EPSILON ? null : plan;
}

// Balances are in half-day steps; keep them clean of float dust.
export function round(value: number): number {
  return Math.round(value * 10) / 10;
}
