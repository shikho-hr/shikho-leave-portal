import { adminDb } from "./firebase-admin";
import {
  Employee,
  LeaveRequest,
  LeaveComment,
  LeaveType,
  Holiday,
  OpeningBalance,
  BalanceSnapshot,
  Notification,
} from "./types";

const employeesCol = adminDb.collection("employees");
const leavesCol = adminDb.collection("leaves");
const commentsCol = adminDb.collection("leaveComments");
const internalNotesCol = adminDb.collection("internalNotes");
const holidaysCol = adminDb.collection("holidays");
const openingBalancesCol = adminDb.collection("openingBalances");
const balanceSnapshotsCol = adminDb.collection("balanceSnapshots");
const notificationsCol = adminDb.collection("notifications");

// ── Employees ──────────────────────────────────────────────────

// Returns every employee regardless of status — callers that only want
// active ones (e.g. manager-reportee lookups) filter client-side. The one
// current caller is the admin-only /api/employees route, which needs to
// show inactive employees too.
export async function getEmployees(): Promise<Employee[]> {
  const snap = await employeesCol.get();
  return snap.docs.map((d) => d.data() as Employee);
}

export async function getEmployeeByEmail(
  email: string
): Promise<Employee | null> {
  const doc = await employeesCol.doc(email.toLowerCase()).get();
  return doc.exists ? (doc.data() as Employee) : null;
}

// Resolves a small set of reviewer emails to display names, for showing
// "Reviewed by <name>" instead of a raw email (History tab, Team Details'
// "Reviewed By" column). Cheap — usually just the handful of managers/HR
// who've actually reviewed something — via direct doc gets rather than a
// collection query, since doc ID is already the lowercase email.
export async function getEmployeeNamesByEmails(
  emails: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))
  );
  const docs = await Promise.all(
    unique.map((email) => employeesCol.doc(email).get())
  );
  const map = new Map<string, string>();
  docs.forEach((doc, i) => {
    if (doc.exists) map.set(unique[i], (doc.data() as Employee).name);
  });
  return map;
}

// Resolves a small set of employee emails to departments for the analytics
// view — leave docs don't carry a department, so it's joined in from the
// employee doc. Direct doc gets (doc ID = lowercase email), same reasoning
// as getEmployeeNamesByEmails: cost scales with the handful of employees on
// leave that week, not the whole roster.
export async function getEmployeeDepartmentsByEmails(
  emails: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))
  );
  const docs = await Promise.all(
    unique.map((email) => employeesCol.doc(email).get())
  );
  const map = new Map<string, string>();
  docs.forEach((doc, i) => {
    if (doc.exists) map.set(unique[i], (doc.data() as Employee).department);
  });
  return map;
}

export async function getEmployeesByManager(
  managerEmail: string
): Promise<Employee[]> {
  const snap = await employeesCol
    .where("managerEmail", "==", managerEmail.toLowerCase())
    .get();
  return snap.docs.map((d) => d.data() as Employee);
}

// Upsert employees pulled from the Google Sheet roster (doc ID = lowercase
// email). Chunked at Firestore's 500-writes-per-batch limit.
export async function upsertEmployeesFromSheet(
  employees: Employee[]
): Promise<void> {
  for (let i = 0; i < employees.length; i += 500) {
    const chunk = employees.slice(i, i + 500);
    const batch = adminDb.batch();
    for (const emp of chunk) {
      batch.set(employeesCol.doc(emp.email.toLowerCase()), emp);
    }
    await batch.commit();
  }
}

// ── Holidays ───────────────────────────────────────────────────

export async function getHolidays(): Promise<Holiday[]> {
  const snap = await holidaysCol.get();
  return snap.docs.map((d) => d.data() as Holiday);
}

// Membership check for a specific handful of dates (doc ID = the date
// string) — direct doc gets instead of scanning the whole collection.
// Returns the subset of the given dates that are holidays.
export async function getHolidaysByDates(
  dates: string[]
): Promise<Set<string>> {
  const docs = await Promise.all(dates.map((d) => holidaysCol.doc(d).get()));
  return new Set(docs.filter((d) => d.exists).map((d) => d.id));
}

// Upsert holidays pulled from the Google Sheet roster (doc ID = the date
// string, so re-syncing the same date naturally dedupes).
export async function upsertHolidaysFromSheet(
  holidays: Holiday[]
): Promise<void> {
  for (let i = 0; i < holidays.length; i += 500) {
    const chunk = holidays.slice(i, i + 500);
    const batch = adminDb.batch();
    for (const holiday of chunk) {
      batch.set(holidaysCol.doc(holiday.date), holiday);
    }
    await batch.commit();
  }
}

// ── Opening / carry-forward balances ────────────────────────────

export async function getOpeningBalance(
  email: string
): Promise<OpeningBalance | null> {
  const doc = await openingBalancesCol.doc(email.toLowerCase()).get();
  return doc.exists ? (doc.data() as OpeningBalance) : null;
}

// Upsert opening balances pulled from the Google Sheet roster (doc ID =
// lowercase email). Chunked at Firestore's 500-writes-per-batch limit.
export async function upsertOpeningBalancesFromSheet(
  balances: OpeningBalance[]
): Promise<void> {
  for (let i = 0; i < balances.length; i += 500) {
    const chunk = balances.slice(i, i + 500);
    const batch = adminDb.batch();
    for (const balance of chunk) {
      batch.set(openingBalancesCol.doc(balance.email.toLowerCase()), balance);
    }
    await batch.commit();
  }
}

// One collection read instead of one read-attempt per employee — used by
// the admin balances table, which otherwise pays a Firestore read for every
// employee even when most have no opening balance at all.
export async function getAllOpeningBalances(): Promise<
  Map<string, OpeningBalance>
> {
  const snap = await openingBalancesCol.get();
  return new Map(
    snap.docs.map((d) => [d.id, d.data() as OpeningBalance])
  );
}

// ── Historical balance snapshots (one-time import) ──────────────

export async function getBalanceSnapshot(
  email: string
): Promise<BalanceSnapshot | null> {
  const doc = await balanceSnapshotsCol.doc(email.toLowerCase()).get();
  return doc.exists ? (doc.data() as BalanceSnapshot) : null;
}

// Used only by the one-off CSV import script, not by any sync route.
export async function upsertBalanceSnapshots(
  snapshots: BalanceSnapshot[]
): Promise<void> {
  for (let i = 0; i < snapshots.length; i += 500) {
    const chunk = snapshots.slice(i, i + 500);
    const batch = adminDb.batch();
    for (const snapshot of chunk) {
      batch.set(balanceSnapshotsCol.doc(snapshot.email.toLowerCase()), snapshot);
    }
    await batch.commit();
  }
}

// One collection read instead of one read-attempt per employee — same
// reasoning as getAllOpeningBalances().
export async function getAllBalanceSnapshots(): Promise<
  Map<string, BalanceSnapshot>
> {
  const snap = await balanceSnapshotsCol.get();
  return new Map(snap.docs.map((d) => [d.id, d.data() as BalanceSnapshot]));
}

// ── Leave Requests ─────────────────────────────────────────────

export async function getLeaveRequests(): Promise<LeaveRequest[]> {
  const snap = await leavesCol.orderBy("appliedOn", "desc").get();
  return snap.docs.map((d) => d.data() as LeaveRequest);
}

export async function getLeaveById(
  leaveId: string
): Promise<LeaveRequest | null> {
  const doc = await leavesCol.doc(leaveId).get();
  return doc.exists ? (doc.data() as LeaveRequest) : null;
}

export async function getLeavesByEmployee(
  email: string
): Promise<LeaveRequest[]> {
  const snap = await leavesCol
    .where("employeeEmail", "==", email.toLowerCase())
    .orderBy("appliedOn", "desc")
    .get();
  return snap.docs.map((d) => d.data() as LeaveRequest);
}

export async function getLeavesByStatus(
  status: string
): Promise<LeaveRequest[]> {
  const snap = await leavesCol
    .where("status", "==", status)
    .orderBy("appliedOn", "desc")
    .get();
  return snap.docs.map((d) => d.data() as LeaveRequest);
}

export async function getPendingLeavesForManager(
  managerEmail: string
): Promise<LeaveRequest[]> {
  const reportees = await getEmployeesByManager(managerEmail);
  const reporteeEmails = reportees.map((e) => e.email);
  if (reporteeEmails.length === 0) return [];

  // Chunked (not reporteeEmails.slice(0, 30)) so a manager with 30+
  // reportees doesn't silently lose part of their team's queue — same
  // pattern as getLeavesByEmployees. Sorted in memory rather than via
  // .orderBy() to avoid needing a new composite index for "in" + orderBy on
  // a different field.
  const results = await Promise.all(
    chunk30(reporteeEmails).map((c) =>
      leavesCol.where("status", "==", "pending").where("employeeEmail", "in", c).get()
    )
  );
  return results
    .flatMap((snap) => snap.docs.map((d) => d.data() as LeaveRequest))
    .sort(
      (a, b) => new Date(b.appliedOn).getTime() - new Date(a.appliedOn).getTime()
    );
}

// Leaves awaiting HR approval (non-tele-sales, manager already approved)
export async function getLeavesAwaitingHR(): Promise<LeaveRequest[]> {
  const snap = await leavesCol
    .where("status", "==", "manager_approved")
    .orderBy("appliedOn", "desc")
    .get();
  return snap.docs.map((d) => d.data() as LeaveRequest);
}

export async function createLeaveRequest(
  leave: Omit<
    LeaveRequest,
    "id" | "reviewedBy" | "reviewedOn" | "reviewerComments"
  >
) {
  const id = `LV-${Date.now()}`;
  await leavesCol.doc(id).set({
    id,
    employeeEmail: leave.employeeEmail.toLowerCase(),
    employeeName: leave.employeeName,
    leaveType: leave.leaveType,
    startDate: leave.startDate,
    endDate: leave.endDate,
    days: leave.days,
    daysByYear: leave.daysByYear || {},
    ...(leave.halfDayPeriod ? { halfDayPeriod: leave.halfDayPeriod } : {}),
    ...(leave.extraWorkStartDate
      ? { extraWorkStartDate: leave.extraWorkStartDate }
      : {}),
    ...(leave.extraWorkEndDate
      ? { extraWorkEndDate: leave.extraWorkEndDate }
      : {}),
    reason: leave.reason,
    status: leave.status,
    appliedOn: leave.appliedOn,
    reviewedBy: "",
    reviewedOn: "",
    reviewerComments: "",
  });
  return id;
}

export async function updateLeaveStatus(
  leaveId: string,
  status: "manager_approved" | "approved" | "rejected",
  reviewedBy: string,
  comments: string,
  rejectedByRole?: "manager" | "admin"
) {
  await leavesCol.doc(leaveId).update({
    status,
    reviewedBy,
    reviewedOn: new Date().toISOString().split("T")[0],
    reviewerComments: comments,
    ...(rejectedByRole ? { rejectedByRole } : {}),
  });
}

// Admin-only correction of a request's leave type — the route calling this
// already restricts it to pending/manager_approved requests.
export async function updateLeaveType(leaveId: string, leaveType: LeaveType) {
  await leavesCol.doc(leaveId).update({ leaveType });
}

// ── Approved leaves for balance calculation ────────────────────

export async function getApprovedLeavesByEmployee(
  email: string
): Promise<LeaveRequest[]> {
  const snap = await leavesCol
    .where("employeeEmail", "==", email.toLowerCase())
    .where("status", "==", "approved")
    .get();
  return snap.docs.map((d) => d.data() as LeaveRequest);
}

// Firestore's "in" operator caps at 30 values — chunk larger lists (e.g. a
// manager with a big team) and merge results, so nobody silently drops off.
function chunk30(items: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < items.length; i += 30) chunks.push(items.slice(i, i + 30));
  return chunks;
}

// Leaves for a specific set of employees (e.g. a manager's direct reportees)
// — used by the Team Details page's "All Requests" tab for managers, so
// they never trigger a full company-wide leaves scan.
export async function getLeavesByEmployees(
  emails: string[]
): Promise<LeaveRequest[]> {
  if (emails.length === 0) return [];
  const results = await Promise.all(
    chunk30(emails).map((c) => leavesCol.where("employeeEmail", "in", c).get())
  );
  return results
    .flatMap((snap) => snap.docs.map((d) => d.data() as LeaveRequest))
    .sort(
      (a, b) => new Date(b.appliedOn).getTime() - new Date(a.appliedOn).getTime()
    );
  // Sorted in memory rather than via .orderBy() — combining "in" with an
  // orderBy on a different field would need a new composite index; this
  // avoids that entirely.
}

// Same idea as getAllApprovedLeavesGroupedByEmployee(), but scoped to a
// specific set of employees — used for a manager's team balance instead of
// the whole company's approved leaves.
export async function getApprovedLeavesGroupedByEmployees(
  emails: string[]
): Promise<Map<string, LeaveRequest[]>> {
  if (emails.length === 0) return new Map();
  const results = await Promise.all(
    chunk30(emails).map((c) =>
      leavesCol.where("employeeEmail", "in", c).where("status", "==", "approved").get()
    )
  );
  const grouped = new Map<string, LeaveRequest[]>();
  results.forEach((snap) =>
    snap.docs.forEach((d) => {
      const leave = d.data() as LeaveRequest;
      grouped.set(leave.employeeEmail, [
        ...(grouped.get(leave.employeeEmail) || []),
        leave,
      ]);
    })
  );
  return grouped;
}

// One query for every approved leave company-wide, grouped by employee —
// used by the admin balances table instead of querying per employee (which
// costs a read for every employee even ones with zero approved leaves).
export async function getAllApprovedLeavesGroupedByEmployee(): Promise<
  Map<string, LeaveRequest[]>
> {
  const snap = await leavesCol.where("status", "==", "approved").get();
  const grouped = new Map<string, LeaveRequest[]>();
  snap.docs.forEach((d) => {
    const leave = d.data() as LeaveRequest;
    const list = grouped.get(leave.employeeEmail) || [];
    list.push(leave);
    grouped.set(leave.employeeEmail, list);
  });
  return grouped;
}

// Approved leaves whose date range overlaps [rangeStart, rangeEnd] — used
// by the analytics weekday chart. Multi-field range query (needs the
// (status, endDate, startDate) composite index in firestore.indexes.json —
// deploy it or this throws). String comparison is safe: dates are
// "YYYY-MM-DD". Reads only overlapping docs, so it stays cheap even after
// the historical import grows the collection.
export async function getApprovedLeavesOverlapping(
  rangeStart: string,
  rangeEnd: string
): Promise<LeaveRequest[]> {
  const snap = await leavesCol
    .where("status", "==", "approved")
    .where("startDate", "<=", rangeEnd)
    .where("endDate", ">=", rangeStart)
    .get();
  return snap.docs.map((d) => d.data() as LeaveRequest);
}

// ── Leave Comments ─────────────────────────────────────────────

export async function getCommentsByLeave(
  leaveId: string
): Promise<LeaveComment[]> {
  const snap = await commentsCol
    .where("leaveId", "==", leaveId)
    .orderBy("createdAt", "asc")
    .get();
  return snap.docs.map((d) => d.data() as LeaveComment);
}

export async function addComment(
  leaveId: string,
  authorEmail: string,
  authorName: string,
  comment: string,
  isSubmission = false
): Promise<LeaveComment> {
  const id = `CMT-${Date.now()}`;
  const data: LeaveComment = {
    id,
    leaveId,
    authorEmail,
    authorName,
    comment,
    createdAt: new Date().toISOString(),
  };
  await commentsCol.doc(id).set(data);
  await notifyRecipients(leaveId, authorEmail, authorName, comment, false, isSubmission);
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
// notification failing to send shouldn't block the comment itself.
async function notifyRecipients(
  leaveId: string,
  authorEmail: string,
  authorName: string,
  commentText: string,
  isInternalNote: boolean,
  isSubmission = false
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

  const adminSnap = await employeesCol.where("role", "==", "admin").get();
  adminSnap.docs.forEach((d) =>
    recipients.add((d.data() as Employee).email.toLowerCase())
  );

  recipients.delete(authorEmail.toLowerCase());
  if (recipients.size === 0) return;

  const batch = adminDb.batch();
  const createdAt = new Date().toISOString();
  recipients.forEach((recipientEmail) => {
    const notifId = `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const notification: Notification = {
      id: notifId,
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
    };
    batch.set(notificationsCol.doc(notifId), notification);
  });
  await batch.commit();
}

// ── Notifications ───────────────────────────────────────────────
// No orderBy in the query (avoids needing a composite index that then has
// to be manually deployed — see the HR-approval index gotcha already hit
// once in production); sorted in memory instead. Scoped to one recipient's
// own notifications, not a collection-wide scan, so this stays cheap.

export async function getNotificationsForUser(
  email: string,
  limitCount = 30
): Promise<Notification[]> {
  const snap = await notificationsCol
    .where("recipientEmail", "==", email.toLowerCase())
    .get();
  return snap.docs
    .map((d) => d.data() as Notification)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, limitCount);
}

export async function getNotificationById(
  id: string
): Promise<Notification | null> {
  const doc = await notificationsCol.doc(id).get();
  return doc.exists ? (doc.data() as Notification) : null;
}

export async function markNotificationRead(id: string): Promise<void> {
  await notificationsCol.doc(id).update({ read: true });
}

// ── Internal notes (manager/admin only — never exposed to the employee) ──

export async function getInternalNotesByLeave(
  leaveId: string
): Promise<LeaveComment[]> {
  const snap = await internalNotesCol
    .where("leaveId", "==", leaveId)
    .orderBy("createdAt", "asc")
    .get();
  return snap.docs.map((d) => d.data() as LeaveComment);
}

export async function addInternalNote(
  leaveId: string,
  authorEmail: string,
  authorName: string,
  comment: string
): Promise<LeaveComment> {
  const id = `NOTE-${Date.now()}`;
  const data: LeaveComment = {
    id,
    leaveId,
    authorEmail,
    authorName,
    comment,
    createdAt: new Date().toISOString(),
  };
  await internalNotesCol.doc(id).set(data);
  await notifyRecipients(leaveId, authorEmail, authorName, comment, true);
  return data;
}
