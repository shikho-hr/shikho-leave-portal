import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Exported (not just adminAuth) so one-off scripts that need Firestore
// directly - e.g. scripts/migrate-firestore-to-postgres.ts, re-run right
// before the production cutover - can build their own client via
// getFirestore(getAdminApp()) without this module exporting an adminDb
// that the live app itself no longer uses (it's fully on Postgres).
export function getAdminApp(): App {
  if (getApps().length) return getApps()[0];

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const adminApp = getAdminApp();

export const adminAuth = getAuth(adminApp);
