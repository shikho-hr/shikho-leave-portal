import {
  Employee,
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

export const HALF_DAY_ELIGIBLE_TYPES: LeaveType[] = [
  "sick",
  "casual",
  "annual",
  "wfh",
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

// Display format for dates shown anywhere in the portal, e.g. "15 Jul, 2026".
export function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), "d MMM, yyyy");
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
  const holidaySet = new Set(holidayDates);

  if (halfDayPeriod) {
    return isExcludedDay(parseISO(startDate), holidaySet) ? 0 : 0.5;
  }

  let count = 0;
  let cursor = parseISO(startDate);
  const end = parseISO(endDate);
  while (!isAfter(cursor, end)) {
    if (!isExcludedDay(cursor, holidaySet)) count++;
    cursor = addDays(cursor, 1);
  }
  return count;
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
    maternity: employee.gender === "female" ? 182 : 0, // 26 weeks
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

function calculateUsed(approvedLeaves: LeaveRequest[]): LeaveBalance {
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
    if (type in used) {
      used[type] += leave.days;
    }
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
  year?: number
): BalanceInfo {
  const targetYear = year || new Date().getFullYear();
  const asOfDate = new Date();

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
    for (const type of Object.keys(entitled) as LeaveType[]) {
      entitled[type] += openingBalance[type] ?? 0;
    }
  }

  const yearLeaves = approvedLeaves.filter(
    (l) => new Date(l.startDate).getFullYear() === targetYear
  );
  const used = calculateUsed(yearLeaves);

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
  balance: BalanceInfo,
  leaveType: LeaveType,
  days: number,
  halfDayPeriod?: HalfDayPeriod,
  existingLeaves: LeaveRequest[] = []
): { valid: boolean; error?: string } {
  const onProbation = isOnProbation(employee, new Date());

  // Half-day is only meaningful for sick/casual/annual
  if (halfDayPeriod && !HALF_DAY_ELIGIBLE_TYPES.includes(leaveType)) {
    return {
      valid: false,
      error: "Half-day is only available for sick, casual, and annual leave.",
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

  // Check remaining balance
  if (balance.remaining[leaveType] < days) {
    return {
      valid: false,
      error: `Insufficient ${leaveType} leave balance. Available: ${balance.remaining[leaveType]}, Requested: ${days}`,
    };
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
    return ["sick", "casual", "unpaid"];
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
    "unpaid",
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
