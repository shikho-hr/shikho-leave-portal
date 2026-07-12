import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getEmployeeByEmail,
  getApprovedLeavesByEmployee,
  getLeavesByEmployee,
  getOpeningBalance,
  getBalanceSnapshot,
} from "@/lib/db";
import {
  calculateBalance,
  getAvailableLeaveTypes,
} from "@/lib/leave-calculator";

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
    const allLeaves = await getLeavesByEmployee(user.email);
    const openingBalance = await getOpeningBalance(user.email);
    const snapshot = await getBalanceSnapshot(user.email);
    const balance = calculateBalance(
      employee,
      approvedLeaves,
      openingBalance || undefined,
      snapshot || undefined
    );
    const availableTypes = getAvailableLeaveTypes(employee, allLeaves);

    return NextResponse.json({
      balance,
      availableTypes,
      employee: {
        name: employee.name,
        designation: employee.designation,
        department: employee.department,
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
