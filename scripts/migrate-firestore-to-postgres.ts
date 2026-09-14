// One-off Firestore -> Postgres data migration.
//
// Run with: npm run migrate:firestore
//
// Idempotent (every write is an upsert on the record's original Firestore
// doc ID), so it's safe to re-run — e.g. once now against the db-migration
// branch, and once more right before the production cutover to catch any
// writes made in between. Only reads from Firestore; never writes back to
// it or deletes anything there.
//
// Writes happen in dependency order (foreign keys, unlike Firestore,
// actually enforce this): Employees -> Holidays/OpeningBalances/
// BalanceSnapshots -> Leaves -> LeaveComments/InternalNotes -> Notifications.
//
// Leaves/comments/notes/notifications are written directly via Prisma, NOT
// through db.ts's createLeaveRequest/addComment/addInternalNote — those
// generate fresh IDs and (for comments/notes) fan out real notifications
// and emails, neither of which historical data migration should do.
//
// Every FK-dependent collection is filtered against its parent's migrated
// ID set before writing — Firestore never enforced these relationships, so
// a handful of historical records can reference an email/leaveId that no
// longer exists. Orphans are skipped (not fatal) and reported by name/id
// so a human can decide whether they need fixing upstream.

// Needs both the Firebase Admin credentials (source: Firestore) and
// DATABASE_URL (destination: Postgres) — both live in .env.local, not the
// root .env (which is Prisma-CLI-only). Run this script with
// `--env-file=.env.local` (see package.json's "migrate:firestore" script)
// rather than a dotenv import here — firebase-admin.ts reads
// process.env.* at module-load time, and static imports are hoisted above
// any config()-style call in this file, so it would run too late.
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "../src/lib/firebase-admin";
import { prisma } from "../src/lib/prisma";

const adminDb = getFirestore(getAdminApp());
import {
  upsertEmployeesFromSheet,
  createHoliday,
  upsertOpeningBalancesFromSheet,
  upsertBalanceSnapshots,
} from "../src/lib/db";
import {
  Employee,
  LeaveRequest,
  LeaveComment,
  Holiday,
  OpeningBalance,
  BalanceSnapshot,
  Notification,
} from "../src/lib/types";

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function toDate(s: string): Date {
  return new Date(s);
}
function toDateOrNull(s: string | undefined | null): Date | null {
  return s ? new Date(s) : null;
}

function reportOrphans<T>(label: string, orphaned: T[], describe: (item: T) => string) {
  if (orphaned.length === 0) return;
  console.warn(
    `${label}: SKIPPING ${orphaned.length} orphaned record(s): ${orphaned
      .map(describe)
      .join(", ")}`
  );
}

async function migrateEmployees() {
  const snap = await adminDb.collection("employees").get();
  const employees = snap.docs.map((d) => d.data() as Employee);
  await upsertEmployeesFromSheet(employees);
  console.log(`Employees: migrated ${employees.length}`);
  return {
    firestoreCount: employees.length,
    migratedCount: employees.length,
    emails: new Set(employees.map((e) => e.email.toLowerCase())),
  };
}

async function migrateHolidays() {
  const snap = await adminDb.collection("holidays").get();
  const holidays = snap.docs.map((d) => d.data() as Holiday);
  // Holidays are admin-managed directly now (not sheet-synced), but this
  // migration is a one-time historical import, not an ongoing sync — write
  // whatever pre-existing holidays Firestore has via the same admin CRUD
  // function the app itself now uses.
  await Promise.all(holidays.map((h) => createHoliday(h.date, h.name)));
  console.log(`Holidays: migrated ${holidays.length}`);
  return { firestoreCount: holidays.length, migratedCount: holidays.length };
}

async function migrateOpeningBalances(employeeEmails: Set<string>) {
  const snap = await adminDb.collection("openingBalances").get();
  const all = snap.docs.map((d) => d.data() as OpeningBalance);
  const valid = all.filter((b) => employeeEmails.has(b.email.toLowerCase()));
  reportOrphans(
    "Opening balances",
    all.filter((b) => !employeeEmails.has(b.email.toLowerCase())),
    (b) => b.email
  );
  await upsertOpeningBalancesFromSheet(valid);
  console.log(`Opening balances: migrated ${valid.length}`);
  return { firestoreCount: all.length, migratedCount: valid.length };
}

async function migrateBalanceSnapshots(employeeEmails: Set<string>) {
  const snap = await adminDb.collection("balanceSnapshots").get();
  const all = snap.docs.map((d) => d.data() as BalanceSnapshot);
  const valid = all.filter((s) => employeeEmails.has(s.email.toLowerCase()));
  reportOrphans(
    "Balance snapshots",
    all.filter((s) => !employeeEmails.has(s.email.toLowerCase())),
    (s) => s.email
  );
  await upsertBalanceSnapshots(valid);
  console.log(`Balance snapshots: migrated ${valid.length}`);
  return { firestoreCount: all.length, migratedCount: valid.length };
}

async function migrateLeaves(employeeEmails: Set<string>) {
  const snap = await adminDb.collection("leaves").get();
  const all = snap.docs.map((d) => d.data() as LeaveRequest);
  const valid = all.filter((l) => employeeEmails.has(l.employeeEmail.toLowerCase()));
  reportOrphans(
    "Leaves",
    all.filter((l) => !employeeEmails.has(l.employeeEmail.toLowerCase())),
    (l) => `${l.id} (${l.employeeEmail})`
  );

  for (const batch of chunk(valid, 200)) {
    await Promise.all(
      batch.map((leave) => {
        const data = {
          employeeEmail: leave.employeeEmail.toLowerCase(),
          employeeName: leave.employeeName,
          leaveType: leave.leaveType,
          startDate: toDate(leave.startDate),
          endDate: toDate(leave.endDate),
          days: leave.days,
          daysByYear: leave.daysByYear || {},
          halfDayPeriod: leave.halfDayPeriod ?? null,
          extraWorkStartDate: toDateOrNull(leave.extraWorkStartDate),
          extraWorkEndDate: toDateOrNull(leave.extraWorkEndDate),
          reason: leave.reason,
          status: leave.status,
          appliedOn: toDate(leave.appliedOn),
          reviewedBy: leave.reviewedBy ?? "",
          reviewedOn: leave.reviewedOn ?? "",
          reviewerComments: leave.reviewerComments ?? "",
          rejectedByRole: leave.rejectedByRole ?? null,
        };
        return prisma.leave.upsert({
          where: { id: leave.id },
          create: { id: leave.id, ...data },
          update: data,
        });
      })
    );
  }
  console.log(`Leaves: migrated ${valid.length}`);
  return {
    firestoreCount: all.length,
    migratedCount: valid.length,
    leaveIds: new Set(valid.map((l) => l.id)),
  };
}

async function migrateLeaveComments(leaveIds: Set<string>) {
  const snap = await adminDb.collection("leaveComments").get();
  const all = snap.docs.map((d) => d.data() as LeaveComment);
  const valid = all.filter((c) => leaveIds.has(c.leaveId));
  reportOrphans(
    "Leave comments",
    all.filter((c) => !leaveIds.has(c.leaveId)),
    (c) => `${c.id} (leave ${c.leaveId})`
  );

  for (const batch of chunk(valid, 200)) {
    await Promise.all(
      batch.map((c) => {
        const data = {
          leaveId: c.leaveId,
          authorEmail: c.authorEmail,
          authorName: c.authorName,
          comment: c.comment,
          createdAt: toDate(c.createdAt),
        };
        return prisma.leaveComment.upsert({
          where: { id: c.id },
          create: { id: c.id, ...data },
          update: data,
        });
      })
    );
  }
  console.log(`Leave comments: migrated ${valid.length}`);
  return { firestoreCount: all.length, migratedCount: valid.length };
}

async function migrateInternalNotes(leaveIds: Set<string>) {
  const snap = await adminDb.collection("internalNotes").get();
  const all = snap.docs.map((d) => d.data() as LeaveComment);
  const valid = all.filter((n) => leaveIds.has(n.leaveId));
  reportOrphans(
    "Internal notes",
    all.filter((n) => !leaveIds.has(n.leaveId)),
    (n) => `${n.id} (leave ${n.leaveId})`
  );

  for (const batch of chunk(valid, 200)) {
    await Promise.all(
      batch.map((n) => {
        const data = {
          leaveId: n.leaveId,
          authorEmail: n.authorEmail,
          authorName: n.authorName,
          comment: n.comment,
          createdAt: toDate(n.createdAt),
        };
        return prisma.internalNote.upsert({
          where: { id: n.id },
          create: { id: n.id, ...data },
          update: data,
        });
      })
    );
  }
  console.log(`Internal notes: migrated ${valid.length}`);
  return { firestoreCount: all.length, migratedCount: valid.length };
}

async function migrateNotifications(employeeEmails: Set<string>, leaveIds: Set<string>) {
  const snap = await adminDb.collection("notifications").get();
  const all = snap.docs.map((d) => d.data() as Notification);
  // Notification.leaveId became optional when Compensatory Off credit
  // notifications were added (they carry a creditId instead), but every
  // Firestore-era notification is leave-scoped — a row without one here is
  // corrupt and belongs in the orphan report.
  const hasLeave = (n: Notification): n is Notification & { leaveId: string } =>
    Boolean(n.leaveId) && leaveIds.has(n.leaveId!);
  const valid = all.filter(
    (n) => employeeEmails.has(n.recipientEmail.toLowerCase()) && hasLeave(n)
  );
  reportOrphans(
    "Notifications",
    all.filter(
      (n) => !employeeEmails.has(n.recipientEmail.toLowerCase()) || !hasLeave(n)
    ),
    (n) => `${n.id} (recipient ${n.recipientEmail}, leave ${n.leaveId ?? "none"})`
  );

  for (const batch of chunk(valid, 200)) {
    await Promise.all(
      batch.map((n) => {
        const data = {
          recipientEmail: n.recipientEmail.toLowerCase(),
          leaveId: n.leaveId,
          leaveType: n.leaveType,
          employeeName: n.employeeName,
          commentAuthorName: n.commentAuthorName,
          commentPreview: n.commentPreview,
          isInternalNote: n.isInternalNote,
          isSubmission: n.isSubmission,
          read: n.read,
          createdAt: toDate(n.createdAt),
        };
        return prisma.notification.upsert({
          where: { id: n.id },
          create: { id: n.id, ...data },
          update: data,
        });
      })
    );
  }
  console.log(`Notifications: migrated ${valid.length}`);
  return { firestoreCount: all.length, migratedCount: valid.length };
}

async function verifyCounts(expectedMigrated: Record<string, number>) {
  const [
    employeeCount,
    holidayCount,
    openingBalanceCount,
    balanceSnapshotCount,
    leaveCount,
    commentCount,
    noteCount,
    notificationCount,
  ] = await Promise.all([
    prisma.employee.count(),
    prisma.holiday.count(),
    prisma.openingBalance.count(),
    prisma.balanceSnapshot.count(),
    prisma.leave.count(),
    prisma.leaveComment.count(),
    prisma.internalNote.count(),
    prisma.notification.count(),
  ]);

  const actual: Record<string, number> = {
    employees: employeeCount,
    holidays: holidayCount,
    openingBalances: openingBalanceCount,
    balanceSnapshots: balanceSnapshotCount,
    leaves: leaveCount,
    leaveComments: commentCount,
    internalNotes: noteCount,
    notifications: notificationCount,
  };

  console.log(
    "\n── Count parity (records this run intended to migrate, excluding reported orphans, vs. Postgres row count) ──"
  );
  let allMatch = true;
  for (const key of Object.keys(expectedMigrated)) {
    const match = expectedMigrated[key] === actual[key];
    if (!match) allMatch = false;
    console.log(
      `${match ? "OK  " : "MISMATCH"} ${key}: expected=${expectedMigrated[key]} Postgres=${actual[key]}`
    );
  }
  if (!allMatch) {
    throw new Error(
      "Count mismatch detected — investigate before trusting this branch's data (this is separate from, and on top of, any orphan-skip warnings above)."
    );
  }
  console.log("All counts match.");
}

async function main() {
  console.log(`Migrating into DB: ${process.env.NEON_BRANCH ?? "(unknown branch)"}\n`);

  const employees = await migrateEmployees();
  const [holidays, openingBalances, balanceSnapshots] = await Promise.all([
    migrateHolidays(),
    migrateOpeningBalances(employees.emails),
    migrateBalanceSnapshots(employees.emails),
  ]);
  const leaves = await migrateLeaves(employees.emails);
  const [comments, notes] = await Promise.all([
    migrateLeaveComments(leaves.leaveIds),
    migrateInternalNotes(leaves.leaveIds),
  ]);
  const notifications = await migrateNotifications(employees.emails, leaves.leaveIds);

  const totalOrphans =
    employees.firestoreCount -
      employees.migratedCount +
      (holidays.firestoreCount - holidays.migratedCount) +
      (openingBalances.firestoreCount - openingBalances.migratedCount) +
      (balanceSnapshots.firestoreCount - balanceSnapshots.migratedCount) +
      (leaves.firestoreCount - leaves.migratedCount) +
      (comments.firestoreCount - comments.migratedCount) +
      (notes.firestoreCount - notes.migratedCount) +
      (notifications.firestoreCount - notifications.migratedCount);

  await verifyCounts({
    employees: employees.migratedCount,
    holidays: holidays.migratedCount,
    openingBalances: openingBalances.migratedCount,
    balanceSnapshots: balanceSnapshots.migratedCount,
    leaves: leaves.migratedCount,
    leaveComments: comments.migratedCount,
    internalNotes: notes.migratedCount,
    notifications: notifications.migratedCount,
  });

  if (totalOrphans > 0) {
    console.log(
      `\n${totalOrphans} total orphaned record(s) were skipped across all collections — see warnings above. Migration otherwise complete.`
    );
  } else {
    console.log("\nMigration complete, zero orphans.");
  }
}

main()
  .catch((err) => {
    console.error("\nMIGRATION FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
