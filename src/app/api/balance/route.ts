import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getEmployeeByEmail,
  getApprovedLeavesByEmployee,
  getOpeningBalance,
  getBalanceSnapshot,
  getCompOffSummary,
  getCachedAvailableLeaveTypesFor,
  refreshAvailableLeaveTypesCache,
} from "@/lib/db";
import { calculateBalance, isOnProbation } from "@/lib/leave-calculator";

export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Every lookup depends only on the email, so they all run in a single
    // parallel round instead of one network round trip each (the DB is a
    // remote Neon instance, so sequential awaits dominated the latency).
    const [
      employee,
      approvedLeaves,
      openingBalance,
      snapshot,
      compOff,
      cachedTypes,
    ] = await Promise.all([
      getEmployeeByEmail(user.email),
      getApprovedLeavesByEmployee(user.email),
      getOpeningBalance(user.email),
      getBalanceSnapshot(user.email),
      getCompOffSummary(user.email),
      getCachedAvailableLeaveTypesFor(user.email),
    ]);
    if (!employee)
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 }
      );

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
    const availableTypes =
      cachedTypes ??
      (await refreshAvailableLeaveTypesCache()).data[employee.email] ??
      [];

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
