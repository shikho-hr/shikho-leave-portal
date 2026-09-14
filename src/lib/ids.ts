import { nanoid } from "nanoid";

// Same human-readable prefixed scheme as before (LV-/CMT-/NOTE-/NOTIF-,
// visible in the UI), but every ID now carries a random suffix rather than
// a bare timestamp — Date.now() alone can collide under concurrent writes,
// and a Postgres primary-key violation on a real collision would fail the
// request outright instead of silently overwriting, like Firestore did.
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${nanoid(8)}`;
}

export function generateLeaveId(): string {
  return generateId("LV");
}

export function generateCommentId(): string {
  return generateId("CMT");
}

export function generateNoteId(): string {
  return generateId("NOTE");
}

export function generateNotificationId(): string {
  return generateId("NOTIF");
}

export function generateCompOffCreditId(): string {
  return generateId("CO");
}

// Used only by the one-off historical leave import script — distinct
// prefix for traceability/reversibility, same collision-safe shape as the
// organic generators above (not the old sequential HIST-001-style test
// junk that predates this).
export function generateHistoricalLeaveId(): string {
  return generateId("HIST");
}
