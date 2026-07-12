import { cookies } from "next/headers";
import { adminAuth } from "./firebase-admin";
import { getEmployeeByEmail } from "./db";

export interface CurrentUser {
  email: string;
  name: string;
  role: string;
  employeeType: string;
  department: string;
  employeeId: string;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const sessionCookie = cookies().get("session")?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    if (!decoded.email) return null;

    const employee = await getEmployeeByEmail(decoded.email);
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
