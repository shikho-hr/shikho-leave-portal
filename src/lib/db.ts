import { adminDb } from "./firebase-admin";
import {
  Employee,
  LeaveRequest,
  LeaveComment,
  LeaveType,
  Holiday,
  OpeningBalance,
  BalanceSnapshot,
} from "./types";

const employeesCol = adminDb.collection("employees");
const leavesCol = adminDb.collection("leaves");
const commentsCol = adminDb.collection("leaveComments");
const internalNotesCol = adminDb.collection("internalNotes");
const holidaysCol = adminDb.collection("holidays");
const openingBalancesCol = adminDb.collection("openingBalances");
const balanceSnapshotsCol = adminDb.collection("balanceSnapshots");

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

  const snap = await leavesCol
    .where("status", "==", "pending")
    .where("employeeEmail", "in", reporteeEmails.slice(0, 30))
    .get();
  return snap.docs.map((d) => d.data() as LeaveRequest);
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
  comment: string
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
  return data;
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
  return data;
}
