import {
  Employee,
  EmployeeType,
  LeaveRequest,
  LeaveBalance,
  BalanceInfo,
  LeaveType,
  HalfDayPeriod,
  OpeningBalance,
  BalanceSnapshot,
} from "./types";
import {
  parseISO,
  isAfter,
  isBefore,
  addDays,
  format,
} from "date-fns";

// ── Helpers ─────────────────────────────────────────────────────

// Server-side label source (e.g. for email content built in db.ts) — the
// client pages each keep their own identical TYPE_LABELS copy for display.
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  sick: "Sick Leave",
  casual: "Casual Leave",
  annual: "Annual Leave",
  marriage: "Marriage Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  ladies_wfh: "Monthly WFH (Ladies)",
  compassionate: "Compassionate Leave",
  compensatory: "Compensatory Off",
  wfh: "Work from Home",
  unpaid: "Unpaid Leave",
  offsite_attendance: "Off-site Attendance",
  wfh_deployment: "WFH - Deployment",
};

export const HALF_DAY_ELIGIBLE_TYPES: LeaveType[] = [
  "sick",
  "casual",
  "annual",
  "wfh",
  "offsite_attendance",
  "wfh_deployment",
];

// Off-site Attendance / WFH - Deployment are unlimited — tracked and
// approved like any other request, but never counted against a leave
// balance (see the LeaveBalance comment in types.ts), so they're skipped
// entirely by the balance check in validateLeaveRequest().
export const UNLIMITED_LEAVE_TYPES: LeaveType[] = [
  "offsite_attendance",
  "wfh_deployment",
];

// Manager-only leave types, regardless of employeeType — Monthly WFH for
// Ladies, plus Off-site Attendance / WFH - Deployment. Combined with the
// tele-sales shortcut inside isSingleStageApproval() below.
export const SINGLE_STAGE_LEAVE_TYPES: LeaveType[] = [
  "ladies_wfh",
  "offsite_attendance",
  "wfh_deployment",
];

// Reason is optional (but the field stays visible) for these types.
export const REASON_OPTIONAL_TYPES: LeaveType[] = [
  "maternity",
  "paternity",
  "ladies_wfh",
];

// Applies only where reason is already mandatory (i.e. not in REASON_OPTIONAL_TYPES).
export const MIN_REASON_LENGTH = 60;

export const MATERNITY_PATERNITY_LIFETIME_CAP = 2;
export const MARRIAGE_MAX_DAYS = 7;
export const PATERNITY_MAX_DAYS = 14;
export const MATERNITY_MAX_DAYS = 180;

// Whether a leave only needs Manager approval, skipping HR entirely — true
// for tele-sales employees (any leave type), or for any of
// SINGLE_STAGE_LEAVE_TYPES regardless of employee type (Monthly WFH for
// Ladies, Off-site Attendance, WFH - Deployment). Shared between the
// approval-workflow route and the Dashboard's status display so both agree
// on the same rule.
export function isSingleStageApproval(
  employeeType: EmployeeType,
  leaveType: LeaveType
): boolean {
  return (
    employeeType !== "non-tele-sales" ||
    SINGLE_STAGE_LEAVE_TYPES.includes(leaveType)
  );
}

// Display format for dates shown anywhere in the portal, e.g. "15 Jul, 2026".
export function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), "d MMM, yyyy");
}

// Display format for a leave's date range — drops the redundant repeated
// year when both ends fall in the same year (e.g. "17 Oct - 23 Oct, 2026"),
// but shows the year on both ends when a request spans New Year's
// (e.g. "29 Dec, 2026 - 2 Jan, 2027"), and collapses to a single date for a
// same-day (e.g. half-day or Monthly WFH) request.
export function formatDateRange(startDate: string, endDate: string): string {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (startDate === endDate) return format(start, "d MMM, yyyy");
  if (start.getFullYear() === end.getFullYear()) {
    return `${format(start, "d MMM")} - ${format(end, "d MMM, yyyy")}`;
  }
  return `${format(start, "d MMM, yyyy")} - ${format(end, "d MMM, yyyy")}`;
}

// Company weekend is Friday/Saturday.
// Note: compare using local-time yyyy-MM-dd (via date-fns `format`), not
// `date.toISOString()` — toISOString() converts to UTC, which silently
// shifts the date by a day in any timezone ahead of UTC and would never
// match the holiday dates as stored (which are plain "yyyy-MM-dd" strings
// interpreted as local time everywhere else via parseISO).
function isExcludedDay(date: Date, holidaySet: Set<string>): boolean {
  const day = date.getDay(); // 0 = Sunday ... 5 = Friday, 6 = Saturday
  if (day === 5 || day === 6) return true;
  return holidaySet.has(format(date, "yyyy-MM-dd"));
}

// Splits a leave's day count by calendar year — most requests fall entirely
// within one year (a single-entry result), but a request spanning New
// Year's (e.g. Dec 30 – Jan 2) needs its days attributed to each year
// separately, so each year's balance is only charged for the days that
// actually fall within it. Excludes the weekend and any date in
// holidayDates, same as the day-counting this replaces.
export function splitDaysByYear(
  startDate: string,
  endDate: string,
  halfDayPeriod: HalfDayPeriod | "" | undefined,
  holidayDates: string[]
): Record<string, number> {
  const holidaySet = new Set(holidayDates);
  const result: Record<string, number> = {};

  if (halfDayPeriod) {
    const date = parseISO(startDate);
    if (!isExcludedDay(date, holidaySet)) {
      result[String(date.getFullYear())] = 0.5;
    }
    return result;
  }

  let cursor = parseISO(startDate);
  const end = parseISO(endDate);
  while (!isAfter(cursor, end)) {
    if (!isExcludedDay(cursor, holidaySet)) {
      const key = String(cursor.getFullYear());
      result[key] = (result[key] || 0) + 1;
    }
    cursor = addDays(cursor, 1);
  }
  return result;
}

// Counts leave days between startDate/endDate (inclusive), excluding the
// weekend and any date in holidayDates. Half-day requests are always a
// single date and count as 0.5 — unless that date itself is excluded, in
// which case there's nothing to apply for (caller should block submission).
export function calculateLeaveDays(
  startDate: string,
  endDate: string,
  halfDayPeriod: HalfDayPeriod | "" | undefined,
  holidayDates: string[]
): number {
  return Object.values(
    splitDaysByYear(startDate, endDate, halfDayPeriod, holidayDates)
  ).reduce((sum, d) => sum + d, 0);
}

function monthsWorkedInYear(joiningDate: Date, year: number): number {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const effectiveStart = isAfter(joiningDate, yearStart)
    ? joiningDate
    : yearStart;
  if (isAfter(effectiveStart, yearEnd)) return 0;
  return 12 - effectiveStart.getMonth();
}

function isOnProbation(employee: Employee, asOfDate: Date): boolean {
  if (!employee.probationEndDate) return false;
  return isBefore(asOfDate, parseISO(employee.probationEndDate));
}

// ── Tele-sales balance ──────────────────────────────────────────
// 1 SL + 1 CL per month from joining. Accumulates within the year.
// Even if someone joins on the 27th/28th, they get the full month's leave.

function teleSalesEntitlement(
  employee: Employee,
  year: number
): LeaveBalance {
  const months = monthsWorkedInYear(parseISO(employee.joiningDate), year);
  return {
    sick: months,
    casual: months,
    annual: 0,
    marriage: 0,
    maternity: 0,
    paternity: 0,
    ladies_wfh: 0,
    compassionate: 0,
    compensatory: 0,
    wfh: 0,
    unpaid: 30,
  };
}

// ── Freelancer balance ────────────────────────────────────────────
// No leave entitlement of any kind.

function freelancerEntitlement(): LeaveBalance {
  return {
    sick: 0,
    casual: 0,
    annual: 0,
    marriage: 0,
    maternity: 0,
    paternity: 0,
    ladies_wfh: 0,
    compassionate: 0,
    compensatory: 0,
    wfh: 0,
    unpaid: 0,
  };
}

// ── Non-Tele-sales balance ──────────────────────────────────────
// During probation: 1 SL + 1 CL per month
// After probation: full pro-rata SL (14/yr) + CL (10/yr)
//   Pro-rata: 14 minus months missed (Jan=0 missed, Feb=1 missed, etc.)
// AL: 15 days/year, pro-rata. Not available during probation but accrues.
//   AL accrual per month = calendar days from joining to EOM / 24.33, rounded up
// Carry forward: max 10 AL/year, lifetime max 60
//
// For tele-sales→FT transitions (fullTimeEffectiveDate is set):
//   SL, CL, AL calculated from the FT effective date, same rules.

function nonTeleSalesEntitlement(
  employee: Employee,
  year: number,
  asOfDate: Date
): LeaveBalance {
  // If this employee transitioned from tele-sales, use FT effective date
  // for calculating full-time entitlements
  const ftDate = employee.fullTimeEffectiveDate
    ? parseISO(employee.fullTimeEffectiveDate)
    : parseISO(employee.joiningDate);

  const ftYear = ftDate.getFullYear();
  const onProbation = isOnProbation(employee, asOfDate);

  // ── Sick Leave: 14 days/year, pro-rata if joined after Jan 1 ──
  let sickEntitled: number;
  if (onProbation) {
    // During probation: 1 per month worked since FT date (or joining)
    sickEntitled = monthsWorkedInYear(ftDate, year);
  } else if (year === ftYear) {
    // Pro-rata: 14 minus months missed
    const monthsMissed = ftDate.getMonth();
    sickEntitled = Math.max(14 - monthsMissed, 0);
  } else {
    sickEntitled = 14;
  }

  // ── Casual Leave: 10 days/year, pro-rata ──
  let casualEntitled: number;
  if (onProbation) {
    casualEntitled = monthsWorkedInYear(ftDate, year);
  } else if (year === ftYear) {
    const monthsMissed = ftDate.getMonth();
    casualEntitled = Math.max(10 - monthsMissed, 0);
  } else {
    casualEntitled = 10;
  }

  // ── Annual Leave: 15 days/year ──
  // Monthly accrual: (calendar days from joining to EOM) / 24.33, rounded up
  // Not available during probation but accrues
  let annualEntitled: number;
  if (year === ftYear) {
    const monthsRemaining = 12 - ftDate.getMonth();
    annualEntitled = Math.ceil((monthsRemaining / 12) * 15);
  } else {
    annualEntitled = 15;
  }

  return {
    sick: sickEntitled,
    casual: casualEntitled,
    annual: annualEntitled,
    marriage: 7,
    maternity: employee.gender === "female" ? 180 : 0, // ~6 months
    paternity: employee.gender === "male" ? 14 : 0,
    // 1/month ceiling; the real gate is hasUsedLadiesWfhThisMonth(), not this balance.
    ladies_wfh: employee.gender === "female" ? 12 : 0,
    compassionate: 3,
    compensatory: 0,
    wfh: 0,
    unpaid: 60,
  };
}

// ── Calculate used leaves ───────────────────────────────────────

// Attributes each leave's days to targetYear using its stored daysByYear
// split — falling back to the pre-daysByYear behavior (100% attributed to
// startDate's year) for records created before that field existed, so
// nothing in Firestore needs a data migration.
function calculateUsed(
  approvedLeaves: LeaveRequest[],
  targetYear: number
): LeaveBalance {
  const used: LeaveBalance = {
    sick: 0,
    casual: 0,
    annual: 0,
    marriage: 0,
    maternity: 0,
    paternity: 0,
    ladies_wfh: 0,
    compassionate: 0,
    compensatory: 0,
    wfh: 0,
    unpaid: 0,
  };

  for (const leave of approvedLeaves) {
    const type = leave.leaveType as LeaveType;
    if (!(type in used)) continue;
    const balanceKey = type as keyof LeaveBalance;
    const yearDays =
      leave.daysByYear?.[String(targetYear)] ??
      (new Date(leave.startDate).getFullYear() === targetYear
        ? leave.days
        : 0);
    used[balanceKey] += yearDays;
  }

  return used;
}

// ── Leave-history based eligibility helpers ─────────────────────
// Both operate on ALL of an employee's leave requests (any status, all
// time), not just approved — a currently-pending request also consumes a
// slot (so multiple simultaneous pending requests can't all later be
// approved past the limit), but a rejected request frees the slot back up.

export function countNonRejectedLifetime(
  allLeaves: LeaveRequest[],
  type: LeaveType
): number {
  return allLeaves.filter((l) => l.leaveType === type && l.status !== "rejected")
    .length;
}

export function hasUsedLadiesWfhThisMonth(
  allLeaves: LeaveRequest[],
  asOfDate: Date = new Date()
): boolean {
  const year = asOfDate.getFullYear();
  const month = asOfDate.getMonth();
  return allLeaves.some((l) => {
    if (l.leaveType !== "ladies_wfh" || l.status === "rejected") return false;
    const start = parseISO(l.startDate);
    return start.getFullYear() === year && start.getMonth() === month;
  });
}

// ── Main balance calculator ─────────────────────────────────────

export function calculateBalance(
  employee: Employee,
  approvedLeaves: LeaveRequest[],
  openingBalance?: OpeningBalance,
  snapshot?: BalanceSnapshot,
  year?: number,
  asOfDate: Date = new Date()
): BalanceInfo {
  const targetYear = year || new Date().getFullYear();

  // Entitlement track is driven by contract type, not department — a
  // tele-sales employee who's full-time from day one gets the full formula
  // (fullTimeEffectiveDate already falls back to joiningDate when blank).
  let entitled: LeaveBalance;
  if (employee.contractType === "freelancer") {
    entitled = freelancerEntitlement();
  } else if (employee.contractType === "full-time") {
    entitled = nonTeleSalesEntitlement(employee, targetYear, asOfDate);
  } else {
    entitled = teleSalesEntitlement(employee, targetYear);
  }

  if (openingBalance) {
    for (const type of Object.keys(entitled) as (keyof LeaveBalance)[]) {
      entitled[type] += openingBalance[type] ?? 0;
    }
  }

  const used = calculateUsed(approvedLeaves, targetYear);

  // A historical balance snapshot (one-time CSV import) sets entitled to
  // the real historical entitlement and adds the historical "taken" on top
  // of portal usage — so entitled/used both show real numbers (not just an
  // opaque override that happens to land on the right "remaining") — while
  // still correctly decreasing only as new leave is approved through the
  // portal from here on.
  if (snapshot) {
    (["sick", "casual", "annual"] as const).forEach((type) => {
      const entry = snapshot[type];
      if (entry) {
        entitled[type] = entry.entitled;
        used[type] += entry.taken;
      }
    });
  }

  // Monthly WFH for Ladies is a flat "1 per calendar month" allowance, not a
  // yearly-accumulating total — override the generic entitled/used here so
  // every consumer of this function (dashboard cards, admin balances,
  // export, and the generic remaining-balance check below) shows/uses the
  // same corrected number instead of a misleading running total.
  if (employee.gender === "female") {
    const usedThisMonth = approvedLeaves.some((l) => {
      if (l.leaveType !== "ladies_wfh") return false;
      const start = parseISO(l.startDate);
      return (
        start.getFullYear() === asOfDate.getFullYear() &&
        start.getMonth() === asOfDate.getMonth()
      );
    });
    entitled.ladies_wfh = 1;
    used.ladies_wfh = usedThisMonth ? 1 : 0;
  }

  const remaining: LeaveBalance = {
    sick: Math.max(entitled.sick - used.sick, 0),
    casual: Math.max(entitled.casual - used.casual, 0),
    annual: Math.max(entitled.annual - used.annual, 0),
    marriage: Math.max(entitled.marriage - used.marriage, 0),
    maternity: Math.max(entitled.maternity - used.maternity, 0),
    paternity: Math.max(entitled.paternity - used.paternity, 0),
    ladies_wfh: Math.max(entitled.ladies_wfh - used.ladies_wfh, 0),
    compassionate: Math.max(entitled.compassionate - used.compassionate, 0),
    compensatory: Math.max(entitled.compensatory - used.compensatory, 0),
    wfh: Math.max(entitled.wfh - used.wfh, 0),
    unpaid: Math.max(entitled.unpaid - used.unpaid, 0),
  };

  return { entitled, used, remaining };
}

// ── Validation ──────────────────────────────────────────────────

export function validateLeaveRequest(
  employee: Employee,
  balancesByYear: Record<string, BalanceInfo>,
  leaveType: LeaveType,
  days: number,
  daysByYear: Record<string, number>,
  requestStartDate: string,
  halfDayPeriod?: HalfDayPeriod,
  existingLeaves: LeaveRequest[] = [],
  extraWorkDates?: { startDate?: string; endDate?: string }
): { valid: boolean; error?: string } {
  // As-of the leave's own start date, not "today" — a backdated request
  // must be judged against the employee's probation status at the time,
  // not their current status (same root cause as the year-boundary bug
  // this function was reworked to fix).
  const onProbation = isOnProbation(employee, parseISO(requestStartDate));

  // Employees can never self-select Unpaid Leave — only HR/Admin can put a
  // request into this bucket, via the separate admin reclassification path
  // (which doesn't call this function at all).
  if (leaveType === "unpaid") {
    return {
      valid: false,
      error: "Unpaid leave requires explicit approval — please contact HR.",
    };
  }

  // Compensatory Off requires recording which extra day(s) were worked
  if (
    leaveType === "compensatory" &&
    (!extraWorkDates?.startDate || !extraWorkDates?.endDate)
  ) {
    return {
      valid: false,
      error: "Please specify the date(s) you worked extra for this compensatory off.",
    };
  }

  // The same extra-work day(s) can't be claimed as compensatory off twice —
  // check for date-range overlap against this employee's own non-rejected
  // compensatory-off requests (a rejected one frees the date back up, same
  // convention as countNonRejectedLifetime below).
  if (
    leaveType === "compensatory" &&
    extraWorkDates?.startDate &&
    extraWorkDates?.endDate
  ) {
    const alreadyUsed = existingLeaves.some((l) => {
      if (l.leaveType !== "compensatory" || l.status === "rejected")
        return false;
      if (!l.extraWorkStartDate || !l.extraWorkEndDate) return false;
      return (
        extraWorkDates.startDate! <= l.extraWorkEndDate &&
        l.extraWorkStartDate <= extraWorkDates.endDate!
      );
    });
    if (alreadyUsed) {
      return {
        valid: false,
        error: "This Additional Work Date has already been used",
      };
    }
  }

  // Half-day is only available for specific leave types
  if (halfDayPeriod && !HALF_DAY_ELIGIBLE_TYPES.includes(leaveType)) {
    return {
      valid: false,
      error: "Half-day is not available for this leave type.",
    };
  }

  // Maternity/paternity are gated by gender
  if (leaveType === "maternity" && employee.gender !== "female") {
    return {
      valid: false,
      error: "Maternity leave is only available to female employees.",
    };
  }
  if (leaveType === "paternity" && employee.gender !== "male") {
    return {
      valid: false,
      error: "Paternity leave is only available to male employees.",
    };
  }

  // Maternity/paternity capped at 2 uses in the whole employment tenure
  if (
    (leaveType === "maternity" || leaveType === "paternity") &&
    countNonRejectedLifetime(existingLeaves, leaveType) >=
      MATERNITY_PATERNITY_LIFETIME_CAP
  ) {
    return {
      valid: false,
      error: `${
        leaveType === "maternity" ? "Maternity" : "Paternity"
      } leave can only be availed ${MATERNITY_PATERNITY_LIFETIME_CAP} times during employment.`,
    };
  }

  // Maternity/paternity max days per request
  if (leaveType === "maternity" && days > MATERNITY_MAX_DAYS) {
    return {
      valid: false,
      error: `Maternity leave is restricted to a maximum of ${MATERNITY_MAX_DAYS} days.`,
    };
  }
  if (leaveType === "paternity" && days > PATERNITY_MAX_DAYS) {
    return {
      valid: false,
      error: `Paternity leave is restricted to a maximum of ${PATERNITY_MAX_DAYS} days.`,
    };
  }

  // Monthly WFH for Ladies: female-only, single day, once per calendar month
  if (leaveType === "ladies_wfh") {
    if (employee.gender !== "female") {
      return {
        valid: false,
        error: "Monthly WFH for Ladies is only available to female employees.",
      };
    }
    if (days > 1) {
      return {
        valid: false,
        error: "Monthly WFH for Ladies is limited to a single day.",
      };
    }
    if (hasUsedLadiesWfhThisMonth(existingLeaves)) {
      return {
        valid: false,
        error:
          "Monthly WFH for Ladies has already been used this month. It will be available again next month.",
      };
    }
  }

  // AL not available during probation for full-time employees
  if (
    leaveType === "annual" &&
    employee.contractType === "full-time" &&
    onProbation
  ) {
    return {
      valid: false,
      error: "Annual leave is not available during probation period.",
    };
  }

  // Marriage leave requires probation completion
  if (leaveType === "marriage" && onProbation) {
    return {
      valid: false,
      error: "Marriage leave requires completion of probation period.",
    };
  }

  // Marriage leave max days per request
  if (leaveType === "marriage" && days > MARRIAGE_MAX_DAYS) {
    return {
      valid: false,
      error: `Marriage leave is restricted to a maximum of ${MARRIAGE_MAX_DAYS} days.`,
    };
  }

  // CL max 2 days at a stretch for full-time employees
  if (
    leaveType === "casual" &&
    employee.contractType === "full-time" &&
    days > 2
  ) {
    return {
      valid: false,
      error: "Casual leave is restricted to a maximum of 2 days at a stretch.",
    };
  }

  // Compassionate leave max 3 days at a stretch
  if (leaveType === "compassionate" && days > 3) {
    return {
      valid: false,
      error: "Compassionate leave is restricted to a maximum of 3 days at a stretch.",
    };
  }

  // No leave days to apply for (selection fell entirely on weekend/holidays)
  if (days <= 0) {
    return {
      valid: false,
      error: "The selected date(s) fall on a weekend or holiday — there are no leave days to apply for.",
    };
  }

  // SL > 3 days requires medical certificate (warn, don't block)
  // We allow submission but the UI can show a notice

  // Check remaining balance — per year, since a request spanning New Year's
  // draws from two separate years' balances (see daysByYear). Skipped
  // entirely for unlimited types, which have no LeaveBalance entry to check.
  if (!UNLIMITED_LEAVE_TYPES.includes(leaveType)) {
    const balanceKey = leaveType as keyof LeaveBalance;
    for (const [yearStr, yearDays] of Object.entries(daysByYear)) {
      const yearBalance = balancesByYear[yearStr];
      if (!yearBalance || yearBalance.remaining[balanceKey] < yearDays) {
        return {
          valid: false,
          error: `Insufficient ${leaveType} leave balance for ${yearStr}. Available: ${
            yearBalance?.remaining[balanceKey] ?? 0
          }, Requested: ${yearDays}`,
        };
      }
    }
  }

  return { valid: true };
}

// ── Available leave types per employee ──────────────────────────

export function getAvailableLeaveTypes(
  employee: Employee,
  allLeaves: LeaveRequest[] = []
): LeaveType[] {
  if (employee.contractType === "freelancer") {
    return [];
  }
  if (employee.contractType !== "full-time") {
    return ["sick", "casual"];
  }

  return [
    "sick",
    "casual",
    "annual",
    "marriage",
    "maternity",
    "paternity",
    "ladies_wfh",
    "compassionate",
    "compensatory",
    "wfh",
    "offsite_attendance",
    "wfh_deployment",
  ].filter((type) => {
    if (type === "maternity") {
      return (
        employee.gender === "female" &&
        countNonRejectedLifetime(allLeaves, "maternity") <
          MATERNITY_PATERNITY_LIFETIME_CAP
      );
    }
    if (type === "paternity") {
      return (
        employee.gender === "male" &&
        countNonRejectedLifetime(allLeaves, "paternity") <
          MATERNITY_PATERNITY_LIFETIME_CAP
      );
    }
    if (type === "ladies_wfh") {
      return (
        employee.gender === "female" && !hasUsedLadiesWfhThisMonth(allLeaves)
      );
    }
    return true;
  }) as LeaveType[];
}
