import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getProbationAnnualLeaveApprovedEmployees } from "@/lib/db";

// Team Details' "Probation AL Access" tab default view — everyone
// currently granted the exception AND still on probation. See
// getProbationAnnualLeaveApprovedEmployees in db.ts for why this list
// needs no cleanup once someone's probation ends.
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const employees = await getProbationAnnualLeaveApprovedEmployees();
  return NextResponse.json(employees);
}
