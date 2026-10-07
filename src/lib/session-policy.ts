// Weekly forced sign-out. Everyone's session dies at Friday 00:00 Dhaka time
// (Friday is the weekend for every employee, Saturday workers included), so
// nobody is cut off mid-task. Stateless: a session counts only if the person
// actually signed in after the most recent cutoff — no cron, no DB.

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FRIDAY = 5;

// Epoch ms of the most recent Friday 00:00 in Dhaka time.
export function lastWeeklyCutoff(now = Date.now()): number {
  const dhaka = now + DHAKA_OFFSET_MS;
  const startOfDay = Math.floor(dhaka / DAY_MS) * DAY_MS;
  const dow = new Date(startOfDay).getUTCDay();
  const daysSinceFriday = (dow - FRIDAY + 7) % 7;
  return startOfDay - daysSinceFriday * DAY_MS - DHAKA_OFFSET_MS;
}

// True when a sign-in at `authTimeSec` (Firebase auth_time, seconds) predates
// the latest weekly cutoff and must be asked to sign in again.
export function isSessionExpiredByPolicy(authTimeSec: number): boolean {
  return authTimeSec * 1000 < lastWeeklyCutoff();
}

// A new session may only be minted from a fresh sign-in; otherwise the
// browser's still-signed-in Firebase user would silently renew it and the
// weekly sign-out would never be noticed.
export const FRESH_SIGN_IN_WINDOW_SEC = 5 * 60;
