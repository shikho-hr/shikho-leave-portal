import { prisma } from "./prisma";
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
} from "./types";
import {
  generateLeaveId,
  generateCommentId,
  generateNoteId,
  generateNotificationId,
} from "./ids";
import { LEAVE_TYPE_LABELS, formatDateRange } from "./leave-calculator";
import { sendMail } from "./mailer";

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
  leaveId: string;
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
    leaveId: row.leaveId,
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
  const rows = await prisma.employee.findMany();
  return rows.map(rowToEmployee);
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
export async function upsertEmployeesFromSheet(
  employees: Employee[]
): Promise<void> {
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
          role: emp.role,
          status: emp.status,
          fullTimeEffectiveDate: strToDate(emp.fullTimeEffectiveDate),
          gender: emp.gender || null,
          contractType: emp.contractType,
        };
        return prisma.employee.upsert({
          where: { email },
          create: { email, id: email, ...shared },
          update: shared,
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

// Upsert holidays pulled from the Google Sheet roster (re-syncing the same
// date naturally dedupes, since date is the primary key).
export async function upsertHolidaysFromSheet(
  holidays: Holiday[]
): Promise<void> {
  for (const batch of chunk(holidays, 200)) {
    await Promise.all(
      batch.map((holiday) =>
        prisma.holiday.upsert({
          where: { date: strToDateRequired(holiday.date) },
          create: { date: strToDateRequired(holiday.date), name: holiday.name },
          update: { name: holiday.name },
        })
      )
    );
  }
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
  return rows.map(rowToComment);
}

export async function addComment(
  leaveId: string,
  authorEmail: string,
  authorName: string,
  comment: string,
  isSubmission = false,
  suppressEmail = false
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
    suppressEmail
  );
  return data;
}

// Fans a comment/note out to everyone with a stake in the leave it's on —
// minus whoever wrote it, so nobody gets notified about their own message.
// Regular comments go to the employee, their manager, and every HR/admin.
// Internal notes go to the manager and HR/admins only — the employee is
// deliberately never a recipient, matching internalNotes' own visibility
// rule ("never exposed to the employee"). isSubmission marks the one
// special case: the reason auto-added as a leave's first comment, which
// reads to recipients as "X submitted a new leave request" rather than
// "X commented" — same recipients/mechanics as a regular comment, just a
// different notification framing. Best-effort: a missing leave/employee
// record just means fewer recipients, never a thrown error, since a
// notification failing to send shouldn't block the comment itself. Also
// emails the same recipients (see sendMail() in mailer.ts — itself
// best-effort and gated behind LEAVE_EMAILS_ENABLED), unless suppressEmail
// is set — used for approval/forward auto-comments, which must never email
// per the "never on approval" rule.
async function notifyRecipients(
  leaveId: string,
  authorEmail: string,
  authorName: string,
  commentText: string,
  isInternalNote: boolean,
  isSubmission = false,
  suppressEmail = false
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

  // No status filter here, deliberately — matches prior behavior exactly
  // (every employee with role "admin" is notified, active or not).
  const admins = await prisma.employee.findMany({
    where: { role: "admin" },
    select: { email: true },
  });
  admins.forEach((a) => recipients.add(a.email.toLowerCase()));

  recipients.delete(authorEmail.toLowerCase());
  if (recipients.size === 0) return;

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

  if (suppressEmail) return;

  const typeLabel = LEAVE_TYPE_LABELS[leave.leaveType] || leave.leaveType;
  const subjectPrefix = isSubmission
    ? "New leave request"
    : isInternalNote
    ? "Internal note"
    : "New comment";
  const verbPhrase = isSubmission
    ? "submitted a new request for"
    : isInternalNote
    ? "added an internal note on"
    : "commented on";
  const dateRange = formatDateRange(leave.startDate, leave.endDate);
  const link = `${process.env.APP_BASE_URL || ""}/dashboard`;

  const text = `${authorName} ${verbPhrase} ${leave.employeeName}'s ${typeLabel} request (${dateRange}, ${leave.days} day(s)).\n\n"${commentText}"\n\nView in the Leave Portal: ${link}`;
  const html = `<p><strong>${authorName}</strong> ${verbPhrase} <strong>${leave.employeeName}'s ${typeLabel}</strong> request (${dateRange}, ${leave.days} day(s)).</p><p>${commentText}</p><p><a href="${link}">View in the Leave Portal</a></p>`;

  // Every email about this leave shares one root Message-ID so mail clients
  // thread them into a single conversation. The submission email originates
  // the thread; everything after it replies into that root.
  const rootMessageId = `<leave-${leaveId}@shikho.com>`;

  await sendMail({
    to: Array.from(recipients),
    subject: `${subjectPrefix} — ${leave.employeeName}'s ${typeLabel}`,
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
