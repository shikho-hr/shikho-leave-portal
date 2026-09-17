import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
import {
  Employee,
  EmployeeType,
  Role,
  Gender,
  ContractType,
  LeaveRequest,
  LeaveComment,
  LeaveType,
  LeaveStatus,
  Holiday,
  OpeningBalance,
  BalanceSnapshot,
  Notification,
  NotificationKind,
  LeaveBalance,
  CompOffCredit,
  CompOffCreditStatus,
  CompOffSummary,
} from "./types";
import {
  generateLeaveId,
  generateCompOffCreditId,
  generateCommentId,
  generateNoteId,
  generateNotificationId,
} from "./ids";
import {
  LEAVE_TYPE_LABELS,
  WFH_LEAVE_TYPES,
  formatDateRange,
  calculateBalance,
} from "./leave-calculator";
import { sendMail } from "./mailer";
import { renderEmail, type EmailContent } from "./email-templates";
import { SYSTEM_ADMIN_EMAIL, isSystemAdmin } from "./system-admin";
import {
  planFifoConsumption,
  summarize as summarizeCompOff,
} from "./comp-off";

// ── Date/decimal <-> plain-object conversion helpers ────────────
// The app talks in plain strings/numbers throughout (ISO date strings,
// JS numbers) - Postgres wants real DATE/DECIMAL columns. These helpers
// keep that boundary in one place. "" is treated as "no value" on the app
// side (the shape the Sheet-sync/UI code already produces for optional
// dates/emails) and maps to SQL NULL, not the literal string "".
function dateToStr(d: Date): string {
  return d.toISOString().split("T")[0];
}
function strToDate(s: string | undefined | null): Date | null {
  return s ? new Date(s) : null;
}
function strToDateRequired(s: string): Date {
  return new Date(s);
}

// Every table row we hand back through db.ts's public API keeps returning
// plain objects shaped exactly like the old Firestore doc data, so nothing
// above this file (routes, leave-calculator.ts, sheets-sync.ts) needs to
// change.
function rowToEmployee(row: {
  id: string;
  name: string;
  email: string;
  joiningDate: Date;
  designation: string;
  department: string;
  employeeType: string;
  managerEmail: string | null;
  probationEndDate: Date | null;
  role: string;
  status: string;
  fullTimeEffectiveDate: Date | null;
  gender: string | null;
  contractType: string;
  probationAnnualLeaveApproved: boolean;
}): Employee {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    joiningDate: dateToStr(row.joiningDate),
    designation: row.designation,
    department: row.department,
    employeeType: row.employeeType as EmployeeType,
    managerEmail: row.managerEmail ?? "",
    probationEndDate: row.probationEndDate ? dateToStr(row.probationEndDate) : "",
    role: row.role as Role,
    status: row.status as "active" | "inactive",
    fullTimeEffectiveDate: row.fullTimeEffectiveDate
      ? dateToStr(row.fullTimeEffectiveDate)
      : "",
    gender: (row.gender ?? "") as Gender,
    contractType: row.contractType as ContractType,
    probationAnnualLeaveApproved: row.probationAnnualLeaveApproved,
  };
}

function rowToLeaveRequest(row: {
  id: string;
  employeeEmail: string;
  employeeName: string;
  leaveType: string;
  startDate: Date;
  endDate: Date;
  days: { toNumber(): number };
  daysByYear: unknown;
  halfDayPeriod: string | null;
  extraWorkStartDate: Date | null;
  extraWorkEndDate: Date | null;
  reason: string;
  status: string;
  appliedOn: Date;
  reviewedBy: string;
  reviewedOn: string;
  reviewerComments: string;
  rejectedByRole: string | null;
}): LeaveRequest {
  return {
    id: row.id,
    employeeEmail: row.employeeEmail,
    employeeName: row.employeeName,
    leaveType: row.leaveType as LeaveType,
    startDate: dateToStr(row.startDate),
    endDate: dateToStr(row.endDate),
    days: row.days.toNumber(),
    daysByYear: (row.daysByYear as Record<string, number>) ?? {},
    ...(row.halfDayPeriod
      ? { halfDayPeriod: row.halfDayPeriod as "first_half" | "second_half" }
      : {}),
    ...(row.extraWorkStartDate
      ? { extraWorkStartDate: dateToStr(row.extraWorkStartDate) }
      : {}),
    ...(row.extraWorkEndDate
      ? { extraWorkEndDate: dateToStr(row.extraWorkEndDate) }
      : {}),
    reason: row.reason,
    status: row.status as LeaveStatus,
    appliedOn: row.appliedOn.toISOString(),
    reviewedBy: row.reviewedBy,
    reviewedOn: row.reviewedOn,
    reviewerComments: row.reviewerComments,
    ...(row.rejectedByRole
      ? { rejectedByRole: row.rejectedByRole as "manager" | "admin" }
      : {}),
  };
}

function rowToComment(row: {
  id: string;
  leaveId: string;
  authorEmail: string;
  authorName: string;
  comment: string;
  createdAt: Date;
}): LeaveComment {
  return {
    id: row.id,
    leaveId: row.leaveId,
    authorEmail: row.authorEmail,
    authorName: row.authorName,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToHoliday(row: { date: Date; name: string }): Holiday {
  return { date: dateToStr(row.date), name: row.name };
}

// LeaveBalance's "ladies_wfh" key doesn't match Postgres column-naming
// convention, so the Prisma column is "ladiesWfh" - every other key is
// identical between the two, so only this one needs remapping.
function rowToOpeningBalance(row: {
  email: string;
  sick: { toNumber(): number } | null;
  casual: { toNumber(): number } | null;
  annual: { toNumber(): number } | null;
  marriage: { toNumber(): number } | null;
  maternity: { toNumber(): number } | null;
  paternity: { toNumber(): number } | null;
  ladiesWfh: { toNumber(): number } | null;
  compassionate: { toNumber(): number } | null;
  compensatory: { toNumber(): number } | null;
  wfh: { toNumber(): number } | null;
  unpaid: { toNumber(): number } | null;
}): OpeningBalance {
  const result: OpeningBalance = { email: row.email };
  if (row.sick !== null) result.sick = row.sick.toNumber();
  if (row.casual !== null) result.casual = row.casual.toNumber();
  if (row.annual !== null) result.annual = row.annual.toNumber();
  if (row.marriage !== null) result.marriage = row.marriage.toNumber();
  if (row.maternity !== null) result.maternity = row.maternity.toNumber();
  if (row.paternity !== null) result.paternity = row.paternity.toNumber();
  if (row.ladiesWfh !== null) result.ladies_wfh = row.ladiesWfh.toNumber();
  if (row.compassionate !== null)
    result.compassionate = row.compassionate.toNumber();
  if (row.compensatory !== null)
    result.compensatory = row.compensatory.toNumber();
  if (row.wfh !== null) result.wfh = row.wfh.toNumber();
  if (row.unpaid !== null) result.unpaid = row.unpaid.toNumber();
  return result;
}

function rowToBalanceSnapshot(row: {
  email: string;
  casualEntitled: { toNumber(): number } | null;
  casualTaken: { toNumber(): number } | null;
  casualBalance: { toNumber(): number } | null;
  sickEntitled: { toNumber(): number } | null;
  sickTaken: { toNumber(): number } | null;
  sickBalance: { toNumber(): number } | null;
  annualEntitled: { toNumber(): number } | null;
  annualTaken: { toNumber(): number } | null;
  annualBalance: { toNumber(): number } | null;
  importedAt: Date;
}): BalanceSnapshot {
  const result: BalanceSnapshot = { email: row.email, importedAt: row.importedAt.toISOString() };
  if (row.casualEntitled !== null)
    result.casual = {
      entitled: row.casualEntitled.toNumber(),
      taken: row.casualTaken!.toNumber(),
      balance: row.casualBalance!.toNumber(),
    };
  if (row.sickEntitled !== null)
    result.sick = {
      entitled: row.sickEntitled.toNumber(),
      taken: row.sickTaken!.toNumber(),
      balance: row.sickBalance!.toNumber(),
    };
  if (row.annualEntitled !== null)
    result.annual = {
      entitled: row.annualEntitled.toNumber(),
      taken: row.annualTaken!.toNumber(),
      balance: row.annualBalance!.toNumber(),
    };
  return result;
}

function rowToNotification(row: {
  id: string;
  recipientEmail: string;
  leaveId: string | null;
  kind: string;
  creditId: string | null;
  leaveType: string;
  employeeName: string;
  commentAuthorName: string;
  commentPreview: string;
  isInternalNote: boolean;
  isSubmission: boolean;
  read: boolean;
  createdAt: Date;
}): Notification {
  return {
    id: row.id,
    recipientEmail: row.recipientEmail,
    kind: row.kind as NotificationKind,
    // Omitted rather than nulled when absent, matching how rowToLeaveRequest
    // treats its optional columns.
    ...(row.leaveId ? { leaveId: row.leaveId } : {}),
    ...(row.creditId ? { creditId: row.creditId } : {}),
    leaveType: row.leaveType as LeaveType,
    employeeName: row.employeeName,
    commentAuthorName: row.commentAuthorName,
    commentPreview: row.commentPreview,
    isInternalNote: row.isInternalNote,
    isSubmission: row.isSubmission,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToCompOffCredit(row: {
  id: string;
  employeeEmail: string;
  workDate: Date;
  days: { toNumber(): number };
  reason: string;
  status: string;
  consumedDays: { toNumber(): number };
  source: string;
  reviewedBy: string;
  reviewedOn: string;
  reviewerComments: string;
  createdAt: Date;
}): CompOffCredit {
  return {
    id: row.id,
    employeeEmail: row.employeeEmail,
    workDate: dateToStr(row.workDate),
    days: row.days.toNumber(),
    reason: row.reason,
    status: row.status as CompOffCreditStatus,
    consumedDays: row.consumedDays.toNumber(),
    source: row.source as "employee" | "import",
    reviewedBy: row.reviewedBy,
    reviewedOn: row.reviewedOn,
    reviewerComments: row.reviewerComments,
    createdAt: row.createdAt.toISOString(),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// ── Employees ──────────────────────────────────────────────────

// Returns every employee regardless of status — callers that only want
// active ones (e.g. manager-reportee lookups) filter client-side. The one
// current caller is the admin-only /api/employees route, which needs to
// show inactive employees too.
export async function getEmployees(): Promise<Employee[]> {
  // The system admin (hr.portal@) is a service account, not staff — keep it
  // out of every employee listing (Team Details, balances cache, analytics,
  // Role Assigner, import scripts). It still resolves via getEmployeeByEmail
  // for sign-in. See system-admin.ts.
  const rows = await prisma.employee.findMany({
    where: { email: { not: SYSTEM_ADMIN_EMAIL } },
  });
  return rows.map(rowToEmployee);
}

// Guarantees the HR automation account exists as an active admin. Called on
// every sign-in of that account (session route + getCurrentUser), so a
// deleted, deactivated or demoted row is silently restored — this is what
// makes the account "undeletable". Fields other than role/status are only
// placeholders; nothing computes a balance for this row (getEmployees
// excludes it) and it cannot apply for leave (see /api/leaves POST).
export async function ensureSystemAdmin(): Promise<void> {
  const placeholder = {
    name: "HR Portal",
    designation: "System Administrator",
    department: "Human Resources",
    employeeType: "non-tele-sales",
    contractType: "full-time",
    joiningDate: new Date("2026-09-14"),
  };
  await prisma.employee.upsert({
    where: { email: SYSTEM_ADMIN_EMAIL },
    create: {
      email: SYSTEM_ADMIN_EMAIL,
      id: "HR-PORTAL",
      role: "admin",
      status: "active",
      ...placeholder,
    },
    update: { role: "admin", status: "active" },
  });
}

export async function getEmployeeByEmail(
  email: string
): Promise<Employee | null> {
  const row = await prisma.employee.findUnique({
    where: { email: email.toLowerCase() },
  });
  return row ? rowToEmployee(row) : null;
}

// Resolves a small set of reviewer emails to display names, for showing
// "Reviewed by <name>" instead of a raw email (History tab, Team Details'
// "Reviewed By" column).
export async function getEmployeeNamesByEmails(
  emails: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))
  );
  if (unique.length === 0) return new Map();
  const rows = await prisma.employee.findMany({
    where: { email: { in: unique } },
    select: { email: true, name: true },
  });
  return new Map(rows.map((r) => [r.email, r.name]));
}

// Resolves a small set of employee emails to departments for the analytics
// view — leave rows don't carry a department, so it's joined in from the
// employee row.
export async function getEmployeeDepartmentsByEmails(
  emails: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))
  );
  if (unique.length === 0) return new Map();
  const rows = await prisma.employee.findMany({
    where: { email: { in: unique } },
    select: { email: true, department: true },
  });
  return new Map(rows.map((r) => [r.email, r.department]));
}

export async function getEmployeesByManager(
  managerEmail: string
): Promise<Employee[]> {
  const rows = await prisma.employee.findMany({
    where: { managerEmail: managerEmail.toLowerCase() },
  });
  return rows.map(rowToEmployee);
}

// Upsert employees pulled from the Google Sheet roster. Two passes: first
// every employee row is written with managerEmail left unset, then
// managerEmail is filled in on a second pass once every row exists — the
// self-referencing manager FK would otherwise fail depending on manager-vs-
// reportee ordering in the sheet.
//
// Role is deliberately NOT in the shared update fields — it's admin-managed
// directly in the app (Team Details' "Role Assigner" tab), never sheet-
// synced, same reasoning as holidays/working weekends. A genuinely new
// employee still defaults to "employee" (set only on create); an existing
// one's role is never touched by a re-sync, no matter what the sheet says.
export async function upsertEmployeesFromSheet(
  employees: Employee[]
): Promise<void> {
  // A sheet row for the system admin account must never override its
  // forced role/status (or turn it into "staff") — drop it up front.
  employees = employees.filter((emp) => !isSystemAdmin(emp.email));
  const sheetEmails = employees.map((emp) => emp.email.toLowerCase());
  for (const batch of chunk(employees, 200)) {
    await Promise.all(
      batch.map((emp) => {
        const email = emp.email.toLowerCase();
        const shared = {
          name: emp.name,
          joiningDate: strToDateRequired(emp.joiningDate),
          designation: emp.designation,
          department: emp.department,
          employeeType: emp.employeeType,
          probationEndDate: strToDate(emp.probationEndDate),
          status: emp.status,
          fullTimeEffectiveDate: strToDate(emp.fullTimeEffectiveDate),
          gender: emp.gender || null,
          contractType: emp.contractType,
        };
        // `id` is the HR employee ID from the sheet's column A ("0001",
        // "AC0013"…). Rows synced before this was persisted carry the
        // email as a placeholder id, so a blank sheet value leaves the
        // existing id alone rather than reverting it.
        const id = emp.id.trim();
        return prisma.employee.upsert({
          where: { email },
          create: { email, id: id || email, role: "employee", ...shared },
          update: id ? { id, ...shared } : shared,
        });
      })
    );
  }
  for (const batch of chunk(employees, 200)) {
    await Promise.all(
      batch.map((emp) =>
        prisma.employee.update({
          where: { email: emp.email.toLowerCase() },
          data: {
            managerEmail: emp.managerEmail ? emp.managerEmail.toLowerCase() : null,
          },
        })
      )
    );
  }

  // An employee deleted outright from the sheet (as opposed to having their
  // own status cell switched to "inactive") has no incoming row at all, so
  // the upsert above never touches their record — left alone, they'd stay
  // "active" in the DB forever. Anyone currently active but missing from
  // this sync's sheet snapshot is deactivated here instead, so a removal
  // from the roster is equivalent to marking them inactive. The system
  // admin is exempt — it's never sheet-driven (see the filter above).
  await prisma.employee.updateMany({
    where: {
      status: "active",
      email: { notIn: [...sheetEmails, SYSTEM_ADMIN_EMAIL] },
    },
    data: { status: "inactive" },
  });
}

// Admin-only role change (Team Details' "Role Assigner" tab) — the only
// place an employee's role is ever set after their initial "employee"
// default, per upsertEmployeesFromSheet's comment above.
export async function updateEmployeeRole(
  email: string,
  role: Role
): Promise<void> {
  if (isSystemAdmin(email)) {
    throw new Error("The HR Portal system admin's role cannot be changed.");
  }
  await prisma.employee.update({
    where: { email: email.toLowerCase() },
    data: { role },
  });
}

// Admin-only grant/revoke for the Annual-Leave-during-probation exception
// (Team Details' "Probation AL Access" tab).
export async function setProbationAnnualLeaveApproval(
  email: string,
  approved: boolean
): Promise<void> {
  await prisma.employee.update({
    where: { email: email.toLowerCase() },
    data: { probationAnnualLeaveApproved: approved },
  });
}

// Everyone currently granted the exception AND still on probation — the
// list naturally shrinks with no extra cleanup once someone's probation
// ends, since they simply stop matching this filter (see the tab's own
// comment for why the stale `true` left on their row afterward is
// harmless).
export async function getProbationAnnualLeaveApprovedEmployees(): Promise<
  Employee[]
> {
  const rows = await prisma.employee.findMany({
    where: {
      probationAnnualLeaveApproved: true,
      probationEndDate: { gt: new Date() },
    },
  });
  return rows.map(rowToEmployee);
}

// ── Holidays ───────────────────────────────────────────────────

export async function getHolidays(): Promise<Holiday[]> {
  const rows = await prisma.holiday.findMany();
  return rows.map(rowToHoliday);
}

// Membership check for a specific handful of dates — returns the subset of
// the given dates that are holidays.
export async function getHolidaysByDates(
  dates: string[]
): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const rows = await prisma.holiday.findMany({
    where: { date: { in: dates.map((d) => strToDateRequired(d)) } },
    select: { date: true },
  });
  return new Set(rows.map((r) => dateToStr(r.date)));
}

// Admin-managed directly in the app (Team Details' "Company Calendar" tab)
// - not sheet-synced, so there's only ever one source of truth for it.
export async function createHoliday(date: string, name: string): Promise<void> {
  await prisma.holiday.upsert({
    where: { date: strToDateRequired(date) },
    create: { date: strToDateRequired(date), name },
    update: { name },
  });
}

export async function deleteHoliday(date: string): Promise<void> {
  await prisma.holiday.delete({ where: { date: strToDateRequired(date) } });
}

// ── Working weekends (a Friday/Saturday that's a working day) ───

export async function getWorkingWeekends(): Promise<string[]> {
  const rows = await prisma.workingWeekend.findMany();
  return rows.map((r) => dateToStr(r.date));
}

// Also admin-managed directly, same reasoning as createHoliday/deleteHoliday.
export async function createWorkingWeekend(date: string): Promise<void> {
  await prisma.workingWeekend.upsert({
    where: { date: strToDateRequired(date) },
    create: { date: strToDateRequired(date) },
    update: {},
  });
}

export async function deleteWorkingWeekend(date: string): Promise<void> {
  await prisma.workingWeekend.delete({ where: { date: strToDateRequired(date) } });
}

// ── Opening / carry-forward balances ────────────────────────────

export async function getOpeningBalance(
  email: string
): Promise<OpeningBalance | null> {
  const row = await prisma.openingBalance.findUnique({
    where: { email: email.toLowerCase() },
  });
  return row ? rowToOpeningBalance(row) : null;
}

// Upsert opening balances pulled from the Google Sheet roster. Employee
// rows must already exist (email is a foreign key) — the sync route runs
// this after the employee upsert, not in parallel with it.
export async function upsertOpeningBalancesFromSheet(
  balances: OpeningBalance[]
): Promise<void> {
  for (const batch of chunk(balances, 200)) {
    await Promise.all(
      batch.map((balance) => {
        const email = balance.email.toLowerCase();
        const data = {
          sick: balance.sick ?? null,
          casual: balance.casual ?? null,
          annual: balance.annual ?? null,
          marriage: balance.marriage ?? null,
          maternity: balance.maternity ?? null,
          paternity: balance.paternity ?? null,
          ladiesWfh: balance.ladies_wfh ?? null,
          compassionate: balance.compassionate ?? null,
          compensatory: balance.compensatory ?? null,
          wfh: balance.wfh ?? null,
          unpaid: balance.unpaid ?? null,
        };
        return prisma.openingBalance.upsert({
          where: { email },
          create: { email, ...data },
          update: data,
        });
      })
    );
  }
}

// One query instead of one read-attempt per employee — used by the admin
// balances table, which otherwise pays a read for every employee even when
// most have no opening balance at all.
export async function getAllOpeningBalances(): Promise<
  Map<string, OpeningBalance>
> {
  const rows = await prisma.openingBalance.findMany();
  return new Map(rows.map((r) => [r.email, rowToOpeningBalance(r)]));
}

// ── Historical balance snapshots (one-time import) ──────────────

export async function getBalanceSnapshot(
  email: string
): Promise<BalanceSnapshot | null> {
  const row = await prisma.balanceSnapshot.findUnique({
    where: { email: email.toLowerCase() },
  });
  return row ? rowToBalanceSnapshot(row) : null;
}

// Used only by the one-off CSV import script, not by any sync route.
export async function upsertBalanceSnapshots(
  snapshots: BalanceSnapshot[]
): Promise<void> {
  for (const batch of chunk(snapshots, 200)) {
    await Promise.all(
      batch.map((snapshot) => {
        const email = snapshot.email.toLowerCase();
        const data = {
          casualEntitled: snapshot.casual?.entitled ?? null,
          casualTaken: snapshot.casual?.taken ?? null,
          casualBalance: snapshot.casual?.balance ?? null,
          sickEntitled: snapshot.sick?.entitled ?? null,
          sickTaken: snapshot.sick?.taken ?? null,
          sickBalance: snapshot.sick?.balance ?? null,
          annualEntitled: snapshot.annual?.entitled ?? null,
          annualTaken: snapshot.annual?.taken ?? null,
          annualBalance: snapshot.annual?.balance ?? null,
          importedAt: strToDateRequired(snapshot.importedAt),
        };
        return prisma.balanceSnapshot.upsert({
          where: { email },
          create: { email, ...data },
          update: data,
        });
      })
    );
  }
}

// One query instead of one read-attempt per employee — same reasoning as
// getAllOpeningBalances().
export async function getAllBalanceSnapshots(): Promise<
  Map<string, BalanceSnapshot>
> {
  const rows = await prisma.balanceSnapshot.findMany();
  return new Map(rows.map((r) => [r.email, rowToBalanceSnapshot(r)]));
}

// ── Leave Requests ─────────────────────────────────────────────

export async function getLeaveRequests(): Promise<LeaveRequest[]> {
  const rows = await prisma.leave.findMany({ orderBy: { appliedOn: "desc" } });
  return rows.map(rowToLeaveRequest);
}

export async function getLeaveById(
  leaveId: string
): Promise<LeaveRequest | null> {
  const row = await prisma.leave.findUnique({ where: { id: leaveId } });
  return row ? rowToLeaveRequest(row) : null;
}

export async function getLeavesByEmployee(
  email: string
): Promise<LeaveRequest[]> {
  const rows = await prisma.leave.findMany({
    where: { employeeEmail: email.toLowerCase() },
    orderBy: { appliedOn: "desc" },
  });
  return rows.map(rowToLeaveRequest);
}

export async function getLeavesByStatus(
  status: string
): Promise<LeaveRequest[]> {
  const rows = await prisma.leave.findMany({
    where: { status },
    orderBy: { appliedOn: "desc" },
  });
  return rows.map(rowToLeaveRequest);
}

export async function getPendingLeavesForManager(
  managerEmail: string
): Promise<LeaveRequest[]> {
  const rows = await prisma.leave.findMany({
    where: {
      status: "pending",
      employee: { managerEmail: managerEmail.toLowerCase() },
    },
    orderBy: { appliedOn: "desc" },
  });
  return rows.map(rowToLeaveRequest);
}

// Every leave HR should be able to see, from the moment it's submitted —
// not just once a manager has forwarded it. Includes both "pending" (not
// yet reviewed by the manager) and "manager_approved" (awaiting HR's own
// sign-off) — HR can act on either directly (full override authority over
// the approval workflow, including bypassing the manager stage entirely).
export async function getLeavesVisibleToHR(): Promise<LeaveRequest[]> {
  const rows = await prisma.leave.findMany({
    where: { status: { in: ["pending", "manager_approved"] } },
    orderBy: { appliedOn: "desc" },
  });
  return rows.map(rowToLeaveRequest);
}

export async function createLeaveRequest(
  leave: Omit<
    LeaveRequest,
    "id" | "reviewedBy" | "reviewedOn" | "reviewerComments"
  >
): Promise<string> {
  const id = generateLeaveId();
  await prisma.leave.create({
    data: {
      id,
      employeeEmail: leave.employeeEmail.toLowerCase(),
      employeeName: leave.employeeName,
      leaveType: leave.leaveType,
      startDate: strToDateRequired(leave.startDate),
      endDate: strToDateRequired(leave.endDate),
      days: leave.days,
      daysByYear: leave.daysByYear || {},
      halfDayPeriod: leave.halfDayPeriod ?? null,
      extraWorkStartDate: strToDate(leave.extraWorkStartDate),
      extraWorkEndDate: strToDate(leave.extraWorkEndDate),
      reason: leave.reason,
      status: leave.status,
      appliedOn: strToDateRequired(leave.appliedOn),
      reviewedBy: "",
      reviewedOn: "",
      reviewerComments: "",
    },
  });
  return id;
}

export async function updateLeaveStatus(
  leaveId: string,
  status: "manager_approved" | "approved" | "rejected",
  reviewedBy: string,
  comments: string,
  rejectedByRole?: "manager" | "admin"
): Promise<void> {
  await prisma.leave.update({
    where: { id: leaveId },
    data: {
      status,
      reviewedBy,
      reviewedOn: new Date().toISOString().split("T")[0],
      reviewerComments: comments,
      ...(rejectedByRole ? { rejectedByRole } : {}),
    },
  });
}

// Admin-only correction of a request's leave type — the route calling this
// already restricts it to pending/manager_approved requests.
export async function updateLeaveType(
  leaveId: string,
  leaveType: LeaveType
): Promise<void> {
  await prisma.leave.update({ where: { id: leaveId }, data: { leaveType } });
}

// ── Approved leaves for balance calculation ────────────────────

export async function getApprovedLeavesByEmployee(
  email: string
): Promise<LeaveRequest[]> {
  const rows = await prisma.leave.findMany({
    where: { employeeEmail: email.toLowerCase(), status: "approved" },
  });
  return rows.map(rowToLeaveRequest);
}

// Leaves for a specific set of employees (e.g. a manager's direct reportees)
// — used by the Team Details page's "All Requests" tab for managers.
export async function getLeavesByEmployees(
  emails: string[]
): Promise<LeaveRequest[]> {
  if (emails.length === 0) return [];
  const rows = await prisma.leave.findMany({
    where: { employeeEmail: { in: emails } },
    orderBy: { appliedOn: "desc" },
  });
  return rows.map(rowToLeaveRequest);
}

// Same idea as getAllApprovedLeavesGroupedByEmployee(), but scoped to a
// specific set of employees — used for a manager's team balance instead of
// the whole company's approved leaves.
export async function getApprovedLeavesGroupedByEmployees(
  emails: string[]
): Promise<Map<string, LeaveRequest[]>> {
  if (emails.length === 0) return new Map();
  const rows = await prisma.leave.findMany({
    where: { employeeEmail: { in: emails }, status: "approved" },
  });
  const grouped = new Map<string, LeaveRequest[]>();
  rows.forEach((row) => {
    const leave = rowToLeaveRequest(row);
    grouped.set(leave.employeeEmail, [
      ...(grouped.get(leave.employeeEmail) || []),
      leave,
    ]);
  });
  return grouped;
}

// One query for every approved leave company-wide, grouped by employee —
// used by the admin balances table instead of querying per employee.
export async function getAllApprovedLeavesGroupedByEmployee(): Promise<
  Map<string, LeaveRequest[]>
> {
  const rows = await prisma.leave.findMany({ where: { status: "approved" } });
  const grouped = new Map<string, LeaveRequest[]>();
  rows.forEach((row) => {
    const leave = rowToLeaveRequest(row);
    const list = grouped.get(leave.employeeEmail) || [];
    list.push(leave);
    grouped.set(leave.employeeEmail, list);
  });
  return grouped;
}

// ── Admin balance cache ──────────────────────────────────────────
// The admin Team Details balances table is the only view that needs every
// employee's balance computed at once (managers get a cheap, reportee-
// scoped version via getApprovedLeavesGroupedByEmployees instead). This is
// still a real full-company scan + per-employee calculateBalance() call, so
// its result is cached (see EmployeeBalanceCache in schema.prisma) instead
// of recomputed on every admin page load. The employee list itself is never
// cached — only this balance map.

// Same computation the admin branch of /api/employees used to do inline —
// extracted so it can be called both by the nightly cron/manual-refresh
// route and, as a cold-start fallback, by /api/employees itself.
export async function computeAllEmployeeBalances(): Promise<
  Record<string, LeaveBalance>
> {
  const employees = await getEmployees();
  const [approvedByEmail, openingBalances, snapshots, compOff] =
    await Promise.all([
      getAllApprovedLeavesGroupedByEmployee(),
      getAllOpeningBalances(),
      getAllBalanceSnapshots(),
      getCompOffSummaries(employees.map((e) => e.email)),
    ]);

  const result: Record<string, LeaveBalance> = {};
  for (const emp of employees) {
    const approved = approvedByEmail.get(emp.email) || [];
    const balance = calculateBalance(
      emp,
      approved,
      openingBalances.get(emp.email),
      snapshots.get(emp.email),
      undefined,
      undefined,
      compOff.get(emp.email.toLowerCase())
    );
    result[emp.email] = balance.remaining;
  }
  return result;
}

export async function refreshEmployeeBalanceCache(): Promise<{
  data: Record<string, LeaveBalance>;
  computedAt: Date;
}> {
  const data = await computeAllEmployeeBalances();
  const jsonData = data as unknown as Prisma.InputJsonValue;
  const row = await prisma.employeeBalanceCache.upsert({
    where: { id: "admin" },
    create: { id: "admin", data: jsonData },
    update: { data: jsonData, computedAt: new Date() },
  });
  return { data, computedAt: row.computedAt };
}

export async function getCachedEmployeeBalances(): Promise<{
  data: Record<string, LeaveBalance>;
  computedAt: Date;
} | null> {
  const row = await prisma.employeeBalanceCache.findUnique({
    where: { id: "admin" },
  });
  if (!row) return null;
  return {
    data: row.data as unknown as Record<string, LeaveBalance>,
    computedAt: row.computedAt,
  };
}

// Approved leaves whose date range overlaps [rangeStart, rangeEnd] — used
// by the analytics weekday chart.
export async function getApprovedLeavesOverlapping(
  rangeStart: string,
  rangeEnd: string
): Promise<LeaveRequest[]> {
  const rows = await prisma.leave.findMany({
    where: {
      status: "approved",
      startDate: { lte: strToDateRequired(rangeEnd) },
      endDate: { gte: strToDateRequired(rangeStart) },
    },
  });
  return rows.map(rowToLeaveRequest);
}

// ── Leave Comments ─────────────────────────────────────────────

export async function getCommentsByLeave(
  leaveId: string
): Promise<LeaveComment[]> {
  const rows = await prisma.leaveComment.findMany({
    where: { leaveId },
    orderBy: { createdAt: "asc" },
  });
  const comments = rows.map(rowToComment);

  // The reason typed at submission is auto-added as this leave's first
  // comment (see addComment's isSubmission param) purely so it can flow
  // through the same notifyRecipients() email path as a real comment.
  // It's already shown as its own "Reason" field everywhere a leave is
  // displayed, so surfacing it a second time here would just be the same
  // text twice — drop it from the thread itself, at the one place every
  // comment-thread UI reads from.
  const first = comments[0];
  if (first) {
    const leave = await getLeaveById(leaveId);
    if (
      leave &&
      first.comment === leave.reason &&
      first.authorEmail.toLowerCase() === leave.employeeEmail.toLowerCase()
    ) {
      comments.shift();
    }
  }

  return comments;
}

export async function addComment(
  leaveId: string,
  authorEmail: string,
  authorName: string,
  comment: string,
  isSubmission = false,
  suppressEmail = false,
  isRejection = false
): Promise<LeaveComment> {
  const id = generateCommentId();
  const createdAt = new Date();
  await prisma.leaveComment.create({
    data: { id, leaveId, authorEmail, authorName, comment, createdAt },
  });
  const data: LeaveComment = {
    id,
    leaveId,
    authorEmail,
    authorName,
    comment,
    createdAt: createdAt.toISOString(),
  };
  await notifyRecipients(
    leaveId,
    authorEmail,
    authorName,
    comment,
    false,
    isSubmission,
    suppressEmail,
    isRejection
  );
  return data;
}

// The one fixed HR mailbox CC'd on every leave email — replaces fanning the
// email out to every admin account (the in-app bell still does that, below).
const HR_NOTIFICATION_EMAIL = "hr@shikho.com";

// Fans a comment/note out to everyone with a stake in the leave it's on —
// minus whoever wrote it, so nobody gets notified about their own message.
// Regular comments go to the employee, their manager, and every HR/admin
// (bell) / HR_NOTIFICATION_EMAIL (email). Internal notes go to the manager
// and HR/admins only — the employee is deliberately never a recipient,
// matching internalNotes' own visibility rule ("never exposed to the
// employee"). isSubmission marks the one special case: the reason
// auto-added as a leave's first comment, which reads to recipients as "X
// submitted a new leave request" rather than "X commented" — same
// recipients/mechanics as a regular comment, just a different notification
// framing. Best-effort: a missing leave/employee record just means fewer
// recipients, never a thrown error, since a notification failing to send
// shouldn't block the comment itself. Also emails (see sendMail() in
// mailer.ts — itself best-effort and gated behind LEAVE_EMAILS_ENABLED),
// unless suppressEmail is set — used for approval/forward auto-comments,
// which must never email per the "never on approval" rule.
export async function notifyRecipients(
  leaveId: string,
  authorEmail: string,
  authorName: string,
  commentText: string,
  isInternalNote: boolean,
  isSubmission = false,
  suppressEmail = false,
  isRejection = false
): Promise<void> {
  const leave = await getLeaveById(leaveId);
  if (!leave) return;

  const recipients = new Set<string>();
  if (!isInternalNote) {
    recipients.add(leave.employeeEmail.toLowerCase());
  }

  const employee = await getEmployeeByEmail(leave.employeeEmail);
  if (employee?.managerEmail) {
    recipients.add(employee.managerEmail.toLowerCase());
  }

  // The email recipient set (employee unless internal note + manager + HR)
  // is captured here, before admins are folded into `recipients` below and
  // before the author is excluded — per the business rule, the actor still
  // gets a copy of the email (e.g. the employee who submits still gets the
  // submission email, the manager who rejects still gets the rejection
  // email). Email always CCs the single HR mailbox, not every admin
  // account — that fan-out is for the in-app bell only (below).
  const emailRecipientSet = new Set(recipients);
  emailRecipientSet.add(HR_NOTIFICATION_EMAIL);

  // No status filter here, deliberately — matches prior behavior exactly
  // (every employee with role "admin" is notified, active or not).
  // The system admin (hr.portal@) is also the mailbox these emails are SENT
  // from — notifying it would just mail itself, so it's left out.
  const admins = await prisma.employee.findMany({
    where: { role: "admin", email: { not: SYSTEM_ADMIN_EMAIL } },
    select: { email: true },
  });
  const adminEmails = new Set(admins.map((a) => a.email.toLowerCase()));
  adminEmails.forEach((email) => recipients.add(email));

  recipients.delete(authorEmail.toLowerCase());
  if (recipients.size === 0 && emailRecipientSet.size === 0) return;

  if (recipients.size > 0) {
    const createdAt = new Date();
    await prisma.notification.createMany({
      data: Array.from(recipients).map((recipientEmail) => ({
        id: generateNotificationId(),
        recipientEmail,
        leaveId,
        leaveType: leave.leaveType,
        employeeName: leave.employeeName,
        commentAuthorName: authorName,
        commentPreview: commentText.slice(0, 140),
        isInternalNote,
        isSubmission,
        read: false,
        createdAt,
      })),
    });
  }

  // Internal notes are bell-only: they're a Manager/HR-side scratchpad,
  // not something that needs to land in anyone's inbox.
  if (suppressEmail || isInternalNote) return;

  const typeLabel = LEAVE_TYPE_LABELS[leave.leaveType] || leave.leaveType;
  const dateRange = formatDateRange(leave.startDate, leave.endDate);
  const daysLabel = leave.days === 1 ? "1 day" : `${leave.days} days`;
  const link = `${process.env.APP_BASE_URL || ""}/dashboard`;
  const buttonLabel = "Review in Leave Portal";

  // Every notification uses the same subject so mail clients group them as
  // one conversation alongside the Message-ID threading below. "WFH" for
  // the three work-from-home arrangements, "Leave" for everything else.
  const subjectPrefix = WFH_LEAVE_TYPES.includes(leave.leaveType) ? "WFH" : "Leave";
  const subject = `[${subjectPrefix}] ${leave.employeeName} - ${typeLabel}`;

  // Emails are addressed to one person even though everyone with a stake
  // receives a copy: the manager for anything that needs their review, the
  // employee for anything about their own request. An employee with no
  // manager on file is reviewed by HR directly, so HR gets the greeting.
  const managerName = employee?.managerEmail
    ? (await getEmployeeNamesByEmails([employee.managerEmail])).get(
        employee.managerEmail.toLowerCase()
      )
    : undefined;
  const reviewerGreeting = `Hi ${managerName || "HR"},`;
  const employeeGreeting = `Hi ${leave.employeeName},`;
  // The trailing half of the "{type} request (...)" phrase that appears in
  // prose below — split off so the type name itself can be bolded.
  const requestSuffix = ` request (${dateRange}, ${daysLabel})`;

  let content: EmailContent;
  if (isSubmission) {
    content = {
      greeting: reviewerGreeting,
      intro: `${leave.employeeName} has requested leave and it's awaiting your review.`,
      details: [
        { label: "Leave Type:", value: typeLabel },
        { label: "Dates:", value: `${dateRange} (${daysLabel})` },
        { label: "Reason:", value: `"${commentText}"` },
      ],
      buttonLabel,
      link,
    };
  } else if (isRejection) {
    const rejectedBy = leave.rejectedByRole === "admin" ? "HR" : "Manager";
    content = {
      greeting: employeeGreeting,
      intro: [
        { text: "Your " },
        { text: typeLabel, bold: true },
        { text: `${requestSuffix} was not approved.` },
      ],
      quote: {
        heading: [{ text: "Rejected by:", bold: true }, { text: ` ${rejectedBy}` }],
        label: "Remarks:",
        text: leave.reviewerComments || "",
      },
      buttonLabel,
      link,
    };
  } else if (authorEmail.toLowerCase() === leave.employeeEmail.toLowerCase()) {
    // The employee replying on their own request — usually answering a
    // question from the reviewer, so it's the reviewer's turn again.
    content = {
      greeting: reviewerGreeting,
      intro: [
        { text: `${leave.employeeName} has replied on their ` },
        { text: typeLabel, bold: true },
        { text: `${requestSuffix}.` },
      ],
      quote: { label: `${leave.employeeName} commented:`, text: commentText },
      buttonLabel,
      link,
    };
  } else {
    // Manager or HR commenting on the employee's request before deciding.
    // Both the intro and the quote are labelled by role rather than name,
    // so the employee knows which stage the comment is coming from without
    // it reading as a specific person addressing them.
    const author = await getEmployeeByEmail(authorEmail);
    const authorRole = author?.role === "admin" ? "HR" : "Manager";
    content = {
      greeting: employeeGreeting,
      intro: [
        { text: `${authorRole} made a comment on your ` },
        { text: typeLabel, bold: true },
        { text: `${requestSuffix}.` },
      ],
      quote: { label: `${authorRole} commented:`, text: commentText },
      buttonLabel,
      link,
    };
  }
  const { html, text } = renderEmail(content);

  // Every email about this leave shares one root Message-ID so mail clients
  // thread them into a single conversation. The submission email originates
  // the thread; everything after it replies into that root.
  const rootMessageId = `<leave-${leaveId}@shikho.com>`;

  // Test-only escape hatch: when previewing email formatting/rendering
  // locally, skip CC'ing the real HR inbox — in-app notifications above
  // are unaffected, this only trims who the email itself goes to. Must
  // stay off (unset) anywhere real, since HR being CC'd is the actual
  // business rule — see project_leave_email_notifications memory.
  //
  // Only strips the HR mailbox if it's HR-only here — on the off chance
  // HR_NOTIFICATION_EMAIL is also the applicant or manager on this specific
  // leave, it still gets the email as themselves, not as "HR"; otherwise
  // that person could end up with zero recipients at all.
  const managerEmail = employee?.managerEmail?.toLowerCase();
  const hrOnlyEmails = new Set(
    [HR_NOTIFICATION_EMAIL].filter(
      (email) =>
        email !== leave.employeeEmail.toLowerCase() && email !== managerEmail
    )
  );
  const emailRecipients =
    process.env.LEAVE_EMAILS_SKIP_HR_FOR_TESTING === "true"
      ? Array.from(emailRecipientSet).filter((email) => !hrOnlyEmails.has(email))
      : Array.from(emailRecipientSet);
  if (emailRecipients.length === 0) return;

  await sendMail({
    to: emailRecipients,
    subject,
    text,
    html,
    ...(isSubmission
      ? { messageId: rootMessageId }
      : { inReplyTo: rootMessageId, references: rootMessageId }),
  });
}

// ── Notifications ───────────────────────────────────────────────

export async function getNotificationsForUser(
  email: string,
  limitCount = 30
): Promise<Notification[]> {
  const rows = await prisma.notification.findMany({
    where: { recipientEmail: email.toLowerCase() },
    orderBy: { createdAt: "desc" },
    take: limitCount,
  });
  return rows.map(rowToNotification);
}

export async function getNotificationById(
  id: string
): Promise<Notification | null> {
  const row = await prisma.notification.findUnique({ where: { id } });
  return row ? rowToNotification(row) : null;
}

export async function markNotificationRead(id: string): Promise<void> {
  await prisma.notification.update({ where: { id }, data: { read: true } });
}

// ── Compensatory Off credits ────────────────────────────────────
// Banked additional work days. See src/lib/comp-off.ts for the shared rules
// and prisma/schema.prisma's CompOffCredit for the row shape.

export async function getCompOffCredits(
  email: string
): Promise<CompOffCredit[]> {
  const rows = await prisma.compOffCredit.findMany({
    where: { employeeEmail: email.toLowerCase() },
    orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(rowToCompOffCredit);
}

// Pending credits a reviewer can decide, oldest first: every pending one
// for an HR admin, or just their own reportees' for a manager. Feeds the
// "Comp Off Approval" tab on Team's Leave Requests, so a request survives
// the notification being dismissed.
export async function getPendingCompOffQueue(
  reviewer: { email: string; role: string }
): Promise<(CompOffCredit & { employeeName: string })[]> {
  const rows = await prisma.compOffCredit.findMany({
    where: {
      status: "pending",
      ...(reviewer.role === "admin"
        ? {}
        : { employee: { managerEmail: reviewer.email.toLowerCase() } }),
    },
    include: { employee: { select: { name: true } } },
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map((r) => ({ ...rowToCompOffCredit(r), employeeName: r.employee.name }));
}

export async function getCompOffCreditById(
  id: string
): Promise<CompOffCredit | null> {
  const row = await prisma.compOffCredit.findUnique({ where: { id } });
  return row ? rowToCompOffCredit(row) : null;
}

export async function createCompOffCredit(credit: {
  employeeEmail: string;
  workDate: string;
  days: number;
  reason: string;
  status?: CompOffCreditStatus;
  source?: "employee" | "import";
  reviewedBy?: string;
  reviewedOn?: string;
}): Promise<string> {
  const id = generateCompOffCreditId();
  await prisma.compOffCredit.create({
    data: {
      id,
      employeeEmail: credit.employeeEmail.toLowerCase(),
      workDate: strToDateRequired(credit.workDate),
      days: credit.days,
      reason: credit.reason,
      status: credit.status ?? "pending",
      source: credit.source ?? "employee",
      reviewedBy: credit.reviewedBy ?? "",
      reviewedOn: credit.reviewedOn ?? "",
    },
  });
  return id;
}

// Accept or reject a pending credit. Conditional on the row still being
// pending so two reviewers clicking at once can't both "win" — the count
// tells the caller whether this call was the one that decided it.
export async function decideCompOffCredit(
  id: string,
  status: "accepted" | "rejected",
  reviewedBy: string,
  comments: string
): Promise<boolean> {
  const { count } = await prisma.compOffCredit.updateMany({
    where: { id, status: "pending" },
    data: {
      status,
      reviewedBy,
      reviewedOn: new Date().toISOString().split("T")[0],
      reviewerComments: comments,
    },
  });
  return count > 0;
}

// The `explicitDays` half of a comp-off summary: approved comp-off that
// brought its own entitlement rather than drawing on the balance. Two
// shapes qualify — a leave that carried its own work dates, and a
// pre-portal comp-off loaded by the historical import (HIST- id, no work
// dates on file: the day it was earned was only ever written in the reason
// text). Neither ever consumed a credit, so both count on the Taken side
// without touching Remaining. Same HIST- convention calculateBalance uses
// to keep imported history out of the live balance maths.
function isSelfEntitledCompOff(l: {
  id: string;
  leaveType: string;
  status: string;
  extraWorkStartDate?: string;
  extraWorkEndDate?: string;
}): boolean {
  return (
    l.leaveType === "compensatory" &&
    l.status === "approved" &&
    (Boolean(l.extraWorkStartDate && l.extraWorkEndDate) ||
      l.id.startsWith("HIST-"))
  );
}

function explicitCompOffDays(leaves: LeaveRequest[]): number {
  return leaves
    .filter(isSelfEntitledCompOff)
    .reduce((sum, l) => sum + l.days, 0);
}

export async function getCompOffSummary(
  email: string
): Promise<CompOffSummary> {
  const [credits, leaves] = await Promise.all([
    getCompOffCredits(email),
    getApprovedLeavesByEmployee(email),
  ]);
  return summarizeCompOff(credits, explicitCompOffDays(leaves));
}

// Batch version for the whole-company paths (the nightly admin balance cache
// and the manager view) — two queries total, never one per employee, per the
// standing rule about full-table scans on this project.
export async function getCompOffSummaries(
  emails: string[]
): Promise<Map<string, CompOffSummary>> {
  const lowered = emails.map((e) => e.toLowerCase());
  const [creditRows, leaveRows] = await Promise.all([
    prisma.compOffCredit.findMany({
      where: { employeeEmail: { in: lowered } },
      orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.leave.findMany({
      where: {
        employeeEmail: { in: lowered },
        leaveType: "compensatory",
        status: "approved",
        // Mirrors isSelfEntitledCompOff: own work dates, or imported history.
        OR: [
          { NOT: { extraWorkStartDate: null } },
          { id: { startsWith: "HIST-" } },
        ],
      },
      select: { employeeEmail: true, days: true },
    }),
  ]);

  const creditsByEmail = new Map<string, CompOffCredit[]>();
  for (const row of creditRows) {
    const credit = rowToCompOffCredit(row);
    const list = creditsByEmail.get(credit.employeeEmail) ?? [];
    list.push(credit);
    creditsByEmail.set(credit.employeeEmail, list);
  }
  const explicitByEmail = new Map<string, number>();
  for (const row of leaveRows) {
    const email = row.employeeEmail.toLowerCase();
    explicitByEmail.set(
      email,
      (explicitByEmail.get(email) ?? 0) + row.days.toNumber()
    );
  }

  const result = new Map<string, CompOffSummary>();
  for (const email of lowered) {
    result.set(
      email,
      summarizeCompOff(
        creditsByEmail.get(email) ?? [],
        explicitByEmail.get(email) ?? 0
      )
    );
  }
  return result;
}

// Spend `days` from this employee's accepted credits, oldest work date
// first. Runs inside the caller's transaction so the status change and the
// consumption commit together; returns false when the balance no longer
// covers the request (someone else spent it first).
export async function consumeCompOffCredits(
  tx: Prisma.TransactionClient,
  email: string,
  days: number
): Promise<boolean> {
  const rows = await tx.compOffCredit.findMany({
    where: { employeeEmail: email.toLowerCase(), status: "accepted" },
    orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
  });
  const plan = planFifoConsumption(rows.map(rowToCompOffCredit), days);
  if (!plan) return false;
  for (const step of plan) {
    await tx.compOffCredit.update({
      where: { id: step.id },
      data: { consumedDays: step.consumedDays },
    });
  }
  return true;
}

// Final-approve a balance-drawn compensatory leave and spend the credits it
// draws on, in one transaction. Returns false (changing nothing) when the
// balance no longer covers it — another approval got there first.
export async function approveWithCompOffConsumption(
  leaveId: string,
  employeeEmail: string,
  days: number,
  reviewedBy: string,
  comments: string
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const ok = await consumeCompOffCredits(tx, employeeEmail, days);
    if (!ok) return false;
    await tx.leave.update({
      where: { id: leaveId },
      data: {
        status: "approved",
        reviewedBy,
        reviewedOn: new Date().toISOString().split("T")[0],
        reviewerComments: comments,
      },
    });
    return true;
  });
}

// In-app fan-out for a comp-off credit — bell notifications only. Neither
// the request (recording a worked day) nor the decision (accepted/
// rejected) emails; only a *leave application* of type "compensatory"
// (via notifyRecipients, the normal leave-application flow) does — see
// project_leave_comp_off_balance: two coexisting comp-off flows, and only
// the leave-application one is meant to email (2026-09-15). Deliberately
// a sibling of notifyRecipients rather than a parameter on it: that one
// is leave-shaped all the way through, and bending it would make both
// harder to follow.
async function notifyCompOffRecipients(
  creditId: string,
  kind: Extract<NotificationKind, "comp_off_request" | "comp_off_decision">,
  actorEmail: string,
  actorName: string,
  message: string
): Promise<void> {
  const credit = await getCompOffCreditById(creditId);
  if (!credit) return;
  const employee = await getEmployeeByEmail(credit.employeeEmail);
  if (!employee) return;

  const recipients = new Set<string>();
  if (kind === "comp_off_request") {
    // Whoever can act on it: the line manager, plus HR admins (minus the
    // system automation account).
    if (employee.managerEmail) recipients.add(employee.managerEmail.toLowerCase());
    const admins = await prisma.employee.findMany({
      where: { role: "admin", email: { not: SYSTEM_ADMIN_EMAIL } },
      select: { email: true },
    });
    for (const a of admins) recipients.add(a.email.toLowerCase());
  } else {
    recipients.add(employee.email.toLowerCase());
  }

  // Nobody needs a bell entry for their own action.
  recipients.delete(actorEmail.toLowerCase());
  if (recipients.size === 0) return;

  await prisma.notification.createMany({
    data: Array.from(recipients).map((recipientEmail) => ({
      id: generateNotificationId(),
      recipientEmail,
      kind,
      creditId,
      leaveId: null,
      leaveType: "compensatory",
      employeeName: employee.name,
      commentAuthorName: actorName,
      commentPreview: message.slice(0, 140),
      isInternalNote: false,
      isSubmission: false,
      read: false,
      createdAt: new Date(),
    })),
  });
}

export async function notifyCompOffRequested(
  creditId: string,
  employeeName: string,
  actorEmail: string
): Promise<void> {
  await notifyCompOffRecipients(
    creditId,
    "comp_off_request",
    actorEmail,
    employeeName,
    `${employeeName} has recorded an additional work day and is requesting Compensatory Off credit for it.`
  );
}

export async function notifyCompOffDecided(
  creditId: string,
  status: "accepted" | "rejected",
  reviewerEmail: string,
  reviewerName: string,
  comments: string
): Promise<void> {
  const verb = status === "accepted" ? "accepted" : "rejected";
  await notifyCompOffRecipients(
    creditId,
    "comp_off_decision",
    reviewerEmail,
    reviewerName,
    `${reviewerName} has ${verb} your additional work day.${
      comments ? ` Comment: ${comments}` : ""
    }`
  );
}

// ── Internal notes (manager/admin only — never exposed to the employee) ──

export async function getInternalNotesByLeave(
  leaveId: string
): Promise<LeaveComment[]> {
  const rows = await prisma.internalNote.findMany({
    where: { leaveId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToComment);
}

export async function addInternalNote(
  leaveId: string,
  authorEmail: string,
  authorName: string,
  comment: string,
  suppressEmail = false
): Promise<LeaveComment> {
  const id = generateNoteId();
  const createdAt = new Date();
  await prisma.internalNote.create({
    data: { id, leaveId, authorEmail, authorName, comment, createdAt },
  });
  const data: LeaveComment = {
    id,
    leaveId,
    authorEmail,
    authorName,
    comment,
    createdAt: createdAt.toISOString(),
  };
  await notifyRecipients(
    leaveId,
    authorEmail,
    authorName,
    comment,
    true,
    false,
    suppressEmail
  );
  return data;
}
