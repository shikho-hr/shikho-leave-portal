import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getEmployeeByEmail,
  getApprovedLeavesByEmployee,
  getOpeningBalance,
  getBalanceSnapshot,
  getCompOffSummary,
  getCachedAvailableLeaveTypes,
  refreshAvailableLeaveTypesCache,
} from "@/lib/db";
import { calculateBalance, isOnProbation } from "@/lib/leave-calculator";

export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const employee = await getEmployeeByEmail(user.email);
    if (!employee)
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 }
      );

    const approvedLeaves = await getApprovedLeavesByEmployee(user.email);
    const openingBalance = await getOpeningBalance(user.email);
    const snapshot = await getBalanceSnapshot(user.email);
    const compOff = await getCompOffSummary(user.email);
    const balance = calculateBalance(
      employee,
      approvedLeaves,
      openingBalance || undefined,
      snapshot || undefined,
      undefined,
      undefined,
      compOff
    );

    // The Leave Type dropdown's options come from the roster-sync-refreshed
    // cache (see db.ts) instead of being recomputed live on every page
    // load — cold start (e.g. right after the migration, before the first
    // sync) computes and populates it once so the dropdown isn't empty.
    let leaveTypesCache = await getCachedAvailableLeaveTypes();
    if (!leaveTypesCache) {
      leaveTypesCache = await refreshAvailableLeaveTypesCache();
    }
    const availableTypes = leaveTypesCache.data[employee.email] || [];

    return NextResponse.json({
      balance,
      // The Compensatory Off card and the apply form both need more than
      // the single remaining number (pending credits, and whether to hide
      // the additional-work-date inputs).
      compOff,
      availableTypes,
      employee: {
        name: employee.name,
        designation: employee.designation,
        department: employee.department,
        employeeType: employee.employeeType,
        onProbation: isOnProbation(employee, new Date()),
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch balance" },
      { status: 500 }
    );
  }
}
