// ── Employee types ──────────────────────────────────────────────

export type EmployeeType = "tele-sales" | "non-tele-sales";
export type Role = "employee" | "manager" | "admin";
export type Gender = "male" | "female";
export type ContractType =
  | "full-time"
  | "contractual"
  | "part-time"
  | "freelancer"; // zero leave entitlement across all types

export interface Employee {
  id: string;
  name: string;
  email: string;
  joiningDate: string; // ISO date
  designation: string;
  department: string;
  employeeType: EmployeeType;
  managerEmail: string;
  probationEndDate: string; // ISO date
  role: Role;
  status: "active" | "inactive";
  fullTimeEffectiveDate: string; // ISO date — for tele-sales→FT transitions
  gender: Gender;
  contractType: ContractType; // drives entitlement formula, not employeeType
  // Admin-granted exception letting this specific employee select Annual
  // Leave while still on probation (normally blocked entirely) — see
  // leave-calculator.ts's getAvailableLeaveTypes/validateLeaveRequest.
  probationAnnualLeaveApproved: boolean;
}

// ── Leave types ─────────────────────────────────────────────────

export type LeaveType =
  | "sick"
  | "casual"
  | "annual"
  | "marriage"
  | "maternity"
  | "paternity"
  | "ladies_wfh"
  | "compassionate"
  | "compensatory"
  | "wfh"
  | "unpaid"
  | "offsite_attendance"
  | "wfh_deployment";

export type LeaveStatus = "pending" | "manager_approved" | "approved" | "rejected";
export type HalfDayPeriod = "first_half" | "second_half";

export interface LeaveRequest {
  id: string;
  employeeEmail: string;
  employeeName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number; // supports 0.5 for half-day
  daysByYear?: Record<string, number>; // days split per calendar year, for New Year-boundary-spanning requests — absent on records created before this field existed
  halfDayPeriod?: HalfDayPeriod;
  extraWorkStartDate?: string; // compensatory only — date(s) actually worked extra
  extraWorkEndDate?: string;
  reason: string;
  status: LeaveStatus;
  appliedOn: string;
  reviewedBy: string;
  reviewedOn: string;
  reviewerComments: string;
  rejectedByRole?: "manager" | "admin"; // which stage did the rejecting, if rejected
}

// ── Leave balance ───────────────────────────────────────────────

// Note: "offsite_attendance" and "wfh_deployment" are deliberately absent
// from this interface — they're unlimited/untracked leave types with no
// entitlement or balance concept (see leave-calculator.ts's
// UNLIMITED_LEAVE_TYPES), so they're never keys here.
export interface LeaveBalance {
  sick: number;
  casual: number;
  annual: number;
  marriage: number;
  maternity: number;
  paternity: number;
  ladies_wfh: number;
  compassionate: number;
  compensatory: number;
  wfh: number;
  unpaid: number;
}

export interface BalanceInfo {
  entitled: LeaveBalance;
  used: LeaveBalance;
  remaining: LeaveBalance;
}

// ── Leave comments ─────────────────────────────────────────────

export interface LeaveComment {
  id: string;
  leaveId: string;
  authorEmail: string;
  authorName: string;
  comment: string;
  createdAt: string; // ISO datetime
}

// ── Notifications ───────────────────────────────────────────────
// One doc per recipient per comment — fanned out to the leave's employee,
// their manager, and all HR/admins (minus whoever wrote the comment) at
// comment-creation time. Regular comments only, not internal notes.

export interface Notification {
  id: string;
  recipientEmail: string;
  leaveId: string;
  leaveType: LeaveType;
  employeeName: string;
  commentAuthorName: string;
  commentPreview: string;
  isInternalNote: boolean; // true = "Note to HR only" — never sent to the employee
  isSubmission: boolean; // true = the auto-added reason comment from a brand-new
  // leave application — rendered as "X submitted a new Y request", not "X commented"
  read: boolean;
  createdAt: string; // ISO datetime
}

// ── Holidays ────────────────────────────────────────────────────

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

// ── Opening / carry-forward balances ───────────────────────────

export type OpeningBalance = Partial<LeaveBalance> & { email: string };

// ── Historical balance snapshot (one-time import) ──────────────

export interface BalanceSnapshotEntry {
  entitled: number;
  taken: number;
  balance: number;
}

export interface BalanceSnapshot {
  email: string;
  casual?: BalanceSnapshotEntry;
  sick?: BalanceSnapshotEntry;
  annual?: BalanceSnapshotEntry;
  importedAt: string;
}

// ── Column mappings (legacy, kept for reference) ────────────────

export const EMPLOYEE_COLUMNS = [
  "id",
  "name",
  "email",
  "joiningDate",
  "department",
  "employeeType",
  "managerEmail",
  "probationEndDate",
  "role",
  "status",
  "fullTimeEffectiveDate",
] as const;

export const LEAVE_COLUMNS = [
  "id",
  "employeeEmail",
  "employeeName",
  "leaveType",
  "startDate",
  "endDate",
  "days",
  "reason",
  "status",
  "appliedOn",
  "reviewedBy",
  "reviewedOn",
  "reviewerComments",
] as const;
