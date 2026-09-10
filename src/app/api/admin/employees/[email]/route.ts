import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getEmployeeByEmail,
  updateEmployeeRole,
  setProbationAnnualLeaveApproval,
} from "@/lib/db";
import { isOnProbation } from "@/lib/leave-calculator";
import { Role } from "@/lib/types";

const ROLES: Role[] = ["employee", "manager", "admin"];

// Admin-only employee edits — Team Details' "Role Assigner" and
// "Probation AL Access" tabs both PATCH through here, one optional field
// each in the body. Deliberately separate from the roster sync
// (upsertEmployeesFromSheet in db.ts touches neither field), so this is
// the only path that changes them.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { email: string } }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const email = decodeURIComponent(params.email);
  const body = await req.json();

  try {
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role)) {
        return NextResponse.json(
          { error: `Invalid role "${body.role}"` },
          { status: 400 }
        );
      }
      await updateEmployeeRole(email, body.role);
      return NextResponse.json({ email, role: body.role });
    }

    if (body.probationAnnualLeaveApproved !== undefined) {
      const approved = Boolean(body.probationAnnualLeaveApproved);
      if (approved) {
        const employee = await getEmployeeByEmail(email);
        if (!employee) {
          return NextResponse.json(
            { error: "Employee not found" },
            { status: 404 }
          );
        }
        if (employee.contractType !== "full-time") {
          return NextResponse.json(
            {
              error:
                "This exception only applies to full-time employees.",
            },
            { status: 400 }
          );
        }
        if (!isOnProbation(employee, new Date())) {
          return NextResponse.json(
            { error: "This employee isn't currently on probation." },
            { status: 400 }
          );
        }
      }
      await setProbationAnnualLeaveApproval(email, approved);
      return NextResponse.json({ email, probationAnnualLeaveApproved: approved });
    }

    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update employee" },
      { status: 500 }
    );
  }
}
