import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getLeaveById, getEmployeeByEmail, updateLeaveType } from "@/lib/db";
import { HALF_DAY_ELIGIBLE_TYPES } from "@/lib/leave-calculator";
import { LeaveType } from "@/lib/types";

const ELIGIBLE_STATUSES = ["pending", "manager_approved"];
const ALL_LEAVE_TYPES: LeaveType[] = [
  "sick",
  "casual",
  "annual",
  "marriage",
  "maternity",
  "paternity",
  "ladies_wfh",
  "compassionate",
  "compensatory",
  "wfh",
  "unpaid",
];

// Admin-only correction of a request's leave type. Deliberately separate
// from the manager-or-admin status-change route (src/app/api/leaves/[id]/
// route.ts) — different permission model and a narrower validity window
// (only pending/manager_approved, so approved balance math never shifts
// retroactively).
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { leaveType } = await req.json();
    if (!ALL_LEAVE_TYPES.includes(leaveType)) {
      return NextResponse.json(
        { error: `Invalid leave type "${leaveType}"` },
        { status: 400 }
      );
    }

    const leave = await getLeaveById(params.id);
    if (!leave) {
      return NextResponse.json(
        { error: "Leave request not found" },
        { status: 404 }
      );
    }
    if (!ELIGIBLE_STATUSES.includes(leave.status)) {
      return NextResponse.json(
        {
          error:
            "Leave type can only be changed while a request is pending or awaiting HR approval.",
        },
        { status: 400 }
      );
    }

    const employee = await getEmployeeByEmail(leave.employeeEmail);
    if (!employee) {
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 }
      );
    }

    // Structural compatibility only — balance sufficiency is deliberately
    // not re-checked, since correcting into a type that had insufficient
    // balance under the original classification is exactly what this is for.
    if (leave.halfDayPeriod && !HALF_DAY_ELIGIBLE_TYPES.includes(leaveType)) {
      return NextResponse.json(
        {
          error:
            "Half-day is only available for sick, casual, and annual leave.",
        },
        { status: 400 }
      );
    }
    if (leaveType === "maternity" && employee.gender !== "female") {
      return NextResponse.json(
        { error: "Maternity leave is only available to female employees." },
        { status: 400 }
      );
    }
    if (leaveType === "paternity" && employee.gender !== "male") {
      return NextResponse.json(
        { error: "Paternity leave is only available to male employees." },
        { status: 400 }
      );
    }
    if (leaveType === "ladies_wfh" && employee.gender !== "female") {
      return NextResponse.json(
        {
          error: "Monthly WFH for Ladies is only available to female employees.",
        },
        { status: 400 }
      );
    }

    await updateLeaveType(params.id, leaveType);

    return NextResponse.json({ message: "Leave type updated", leaveType });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update leave type" },
      { status: 500 }
    );
  }
}
