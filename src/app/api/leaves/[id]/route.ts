import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  updateLeaveStatus,
  getLeaveById,
  getEmployeeByEmail,
  addComment,
} from "@/lib/db";
import { isSingleStageApproval } from "@/lib/leave-calculator";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const leave = await getLeaveById(params.id);
    if (!leave) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isOwner =
      leave.employeeEmail.toLowerCase() === user.email.toLowerCase();
    const isAdmin = user.role === "admin";
    let isManager = false;
    if (!isOwner && !isAdmin && user.role === "manager") {
      const employee = await getEmployeeByEmail(leave.employeeEmail);
      isManager =
        employee?.managerEmail?.toLowerCase() === user.email.toLowerCase();
    }

    if (!isOwner && !isAdmin && !isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(leave);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch leave" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = user.role;
  if (role !== "manager" && role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { status, comments } = body;

    if (!status || !["approved", "rejected"].includes(status)) {
      return NextResponse.json(
        { error: "Status must be 'approved' or 'rejected'" },
        { status: 400 }
      );
    }

    if (status === "rejected" && !comments?.trim()) {
      return NextResponse.json(
        { error: "A comment is required when rejecting a leave request" },
        { status: 400 }
      );
    }

    // Get the leave request to check current status and employee type
    const leave = await getLeaveById(params.id);
    if (!leave) {
      return NextResponse.json(
        { error: "Leave request not found" },
        { status: 404 }
      );
    }

    // Get the employee to check their type
    const employee = await getEmployeeByEmail(leave.employeeEmail);
    if (!employee) {
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 }
      );
    }

    // Determine the new status based on approval flow
    let newStatus: "manager_approved" | "approved" | "rejected" = status;

    // Monthly WFH for Ladies only ever needs manager approval, regardless of
    // employeeType — HR sign-off is skipped entirely for this leave type.
    const isSingleStage = isSingleStageApproval(
      employee.employeeType,
      leave.leaveType
    );

    if (status === "approved") {
      if (!isSingleStage) {
        // Two-stage approval for non-tele-sales
        if (leave.status === "pending" && role === "manager") {
          // Manager approves → goes to HR
          newStatus = "manager_approved";
        } else if (leave.status === "pending" && role === "admin") {
          // Admin can approve directly from pending (skip manager step)
          newStatus = "approved";
        } else if (leave.status === "manager_approved" && role === "admin") {
          // HR/Admin gives final approval
          newStatus = "approved";
        } else if (leave.status === "manager_approved" && role === "manager") {
          return NextResponse.json(
            { error: "This leave is awaiting HR approval" },
            { status: 400 }
          );
        } else {
          return NextResponse.json(
            { error: "Invalid status transition" },
            { status: 400 }
          );
        }
      } else {
        // Single-stage: tele-sales employees (any leave type), or Monthly
        // WFH for Ladies (any employee type) — manager approval is final.
        // Also allows an admin to finish off a leave already sitting at
        // manager_approved from before this rule applied to it.
        if (leave.status !== "pending" && leave.status !== "manager_approved") {
          return NextResponse.json(
            { error: "This leave has already been processed" },
            { status: 400 }
          );
        }
        newStatus = "approved";
      }
    }

    // Rejection can happen at any pending/manager_approved stage
    if (status === "rejected") {
      if (leave.status !== "pending" && leave.status !== "manager_approved") {
        return NextResponse.json(
          { error: "This leave has already been processed" },
          { status: 400 }
        );
      }
      newStatus = "rejected";
    }

    await updateLeaveStatus(
      params.id,
      newStatus,
      user.email,
      comments || "",
      newStatus === "rejected" ? (role as "manager" | "admin") : undefined
    );

    // Auto-add a comment for the action
    const actionLabel =
      newStatus === "manager_approved"
        ? "Manager approved — awaiting HR approval"
        : newStatus === "approved"
        ? "Approved"
        : "Rejected";
    const autoComment = comments
      ? `${actionLabel}: ${comments}`
      : actionLabel;
    await addComment(
      params.id,
      user.email,
      user.name || user.email,
      autoComment
    );

    return NextResponse.json({
      message:
        newStatus === "manager_approved"
          ? "Leave forwarded to HR for final approval"
          : `Leave ${newStatus} successfully`,
      newStatus,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update leave" },
      { status: 500 }
    );
  }
}
