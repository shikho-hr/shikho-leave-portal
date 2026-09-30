import { cookies } from "next/headers";
import { adminAuth } from "./firebase-admin";
import { getEmployeeByEmail, ensureSystemAdmin } from "./db";
import { isSystemAdmin } from "./system-admin";

export interface CurrentUser {
  email: string;
  name: string;
  role: string;
  employeeType: string;
  department: string;
  employeeId: string;
}

// TEMP-AUTH-TIMING: remove after measuring (durations only, no user data).
let authTimingWarm = false;

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const sessionCookie = cookies().get("session")?.value;
  if (!sessionCookie) return null;

  try {
    const t0 = performance.now();
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    const t1 = performance.now();
    if (!decoded.email) return null;

    // The HR automation account is a permanent admin — restore its row if
    // anything removed or altered it (see system-admin.ts).
    if (isSystemAdmin(decoded.email)) await ensureSystemAdmin();

    const employee = await getEmployeeByEmail(decoded.email);
    const t2 = performance.now();
    console.log(
      `[auth-timing] cold=${!authTimingWarm} verifyRevoked=${(t1 - t0).toFixed(0)}ms dbLookup=${(t2 - t1).toFixed(0)}ms region=${process.env.VERCEL_REGION}`
    );
    authTimingWarm = true;
    if (!employee || employee.status !== "active") return null;

    return {
      email: employee.email,
      name: employee.name,
      role: employee.role,
      employeeType: employee.employeeType,
      department: employee.department,
      employeeId: employee.id,
    };
  } catch {
    return null;
  }
}
