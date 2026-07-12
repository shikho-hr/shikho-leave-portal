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
  | "unpaid";

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
  halfDayPeriod?: HalfDayPeriod;
  reason: string;
  status: LeaveStatus;
  appliedOn: string;
  reviewedBy: string;
  reviewedOn: string;
  reviewerComments: string;
}

// ── Leave balance ───────────────────────────────────────────────

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
