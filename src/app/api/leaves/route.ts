import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getLeavesByEmployee,
  getPendingLeavesForManager,
  getLeaveRequests,
  createLeaveRequest,
  getEmployeeByEmail,
  getApprovedLeavesByEmployee,
  getLeavesAwaitingHR,
  addComment,
  getHolidays,
  getOpeningBalance,
  getBalanceSnapshot,
} from "@/lib/db";
import {
  calculateBalance,
  validateLeaveRequest,
  calculateLeaveDays,
  REASON_OPTIONAL_TYPES,
  MIN_REASON_LENGTH,
} from "@/lib/leave-calculator";
import { LeaveType, HalfDayPeriod } from "@/lib/types";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view"); // "my" | "pending" | "hr" | "all"

  try {
    if (view === "pending") {
      const leaves = await getPendingLeavesForManager(user.email);
      return NextResponse.json(leaves);
    }

    if (view === "hr" && user.role === "admin") {
      const leaves = await getLeavesAwaitingHR();
      return NextResponse.json(leaves);
    }

    if (view === "all" && user.role === "admin") {
      const leaves = await getLeaveRequests();
      return NextResponse.json(leaves);
    }

    // Default: my leaves
    const leaves = await getLeavesByEmployee(user.email);
    return NextResponse.json(leaves);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch leaves" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { leaveType, startDate, endDate, reason } = body;
    const halfDayPeriod = body.halfDayPeriod as HalfDayPeriod | undefined;

    if (
      !leaveType ||
      !startDate ||
      !endDate ||
      (!reason && !REASON_OPTIONAL_TYPES.includes(leaveType as LeaveType))
    ) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    if (
      !REASON_OPTIONAL_TYPES.includes(leaveType as LeaveType) &&
      (reason as string).trim().length < MIN_REASON_LENGTH
    ) {
      return NextResponse.json(
        { error: "Please elaborate the reason properly" },
        { status: 400 }
      );
    }

    const employee = await getEmployeeByEmail(user.email);
    if (!employee)
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 }
      );

    // Days are always computed server-side from the dates — never trust a
    // client-submitted number — excluding the weekend and holidays.
    const holidays = await getHolidays();
    const days = calculateLeaveDays(
      startDate,
      endDate,
      halfDayPeriod,
      holidays.map((h) => h.date)
    );

    // Validate balance
    const approved = await getApprovedLeavesByEmployee(user.email);
    const allLeaves = await getLeavesByEmployee(user.email);
    const openingBalance = await getOpeningBalance(user.email);
    const snapshot = await getBalanceSnapshot(user.email);
    const balance = calculateBalance(
      employee,
      approved,
      openingBalance || undefined,
      snapshot || undefined
    );
    const validation = validateLeaveRequest(
      employee,
      balance,
      leaveType as LeaveType,
      days,
      halfDayPeriod,
      allLeaves
    );

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const id = await createLeaveRequest({
      employeeEmail: user.email,
      employeeName: employee.name,
      leaveType,
      startDate,
      endDate,
      days,
      halfDayPeriod,
      reason,
      status: "pending",
      appliedOn: new Date().toISOString().split("T")[0],
    });

    // Auto-add the reason as the first comment (skip if left blank for a
    // reason-optional type, to avoid creating an empty comment)
    if (reason) {
      await addComment(id, user.email, employee.name, reason);
    }

    return NextResponse.json({ id, message: "Leave request submitted" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to submit leave request" },
      { status: 500 }
    );
  }
}
