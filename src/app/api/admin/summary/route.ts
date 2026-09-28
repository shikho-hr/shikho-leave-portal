import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { computeAdminSummary } from "@/lib/db";

// Team Details' 4 summary cards. Company-wide for admin, reportee-scoped
// for manager (same access rule as /api/employees and the rest of this
// page's data). Computed live — see computeAdminSummary()'s own comment for
// why this doesn't need a cache table.
export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const summary = await computeAdminSummary(
      user.role === "manager" ? user.email : undefined
    );
    return NextResponse.json(summary);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch summary" },
      { status: 500 }
    );
  }
}
