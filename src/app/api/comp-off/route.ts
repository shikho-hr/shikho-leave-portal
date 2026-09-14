import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  createCompOffCredit,
  getCompOffCredits,
  getCompOffSummary,
  getEmployeeByEmail,
  getLeavesByEmployee,
  notifyCompOffRequested,
} from "@/lib/db";
import {
  WORK_DATE_ALREADY_USED,
  round,
  workDateUsage,
  wouldExceedWorkDate,
} from "@/lib/comp-off";
import { isSystemAdmin } from "@/lib/system-admin";

// The signed-in employee's banked additional work days, for the
// Compensatory Off card's pop-up.
export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [credits, summary] = await Promise.all([
      getCompOffCredits(user.email),
      getCompOffSummary(user.email),
    ]);
    return NextResponse.json({
      summary,
      credits: credits
        // A fully spent credit is history, not balance — keep the pop-up
        // about what's still available or still being decided.
        .filter((c) => c.status !== "rejected")
        .map((c) => ({
          ...c,
          remaining: round(c.days - c.consumedDays),
        })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch compensatory off" },
      { status: 500 }
    );
  }
}

// Record an additional work day. Creates a pending credit and notifies the
// line manager and HR admins, who accept or reject it.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isSystemAdmin(user.email))
    return NextResponse.json(
      { error: "The HR Portal system admin cannot record work days." },
      { status: 403 }
    );

  try {
    const body = await req.json();
    const workDate = String(body.workDate || "").slice(0, 10);
    const days = Number(body.days);
    const reason = String(body.reason || "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return NextResponse.json(
        { error: "Please pick the date you worked." },
        { status: 400 }
      );
    }
    if (days !== 1 && days !== 0.5) {
      return NextResponse.json(
        { error: "Record either a full day or a half day." },
        { status: 400 }
      );
    }
    if (!reason) {
      return NextResponse.json(
        { error: "Please say what you worked on." },
        { status: 400 }
      );
    }
    // A future work date can't have happened yet.
    if (workDate > new Date().toISOString().split("T")[0]) {
      return NextResponse.json(
        { error: "That date is in the future." },
        { status: 400 }
      );
    }

    const employee = await getEmployeeByEmail(user.email);
    if (!employee)
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    // Same gate as getAvailableLeaveTypes: only full-time staff get
    // Compensatory Off at all, so only they can bank days for it.
    if (employee.contractType !== "full-time") {
      return NextResponse.json(
        { error: "Compensatory Off is only available to full-time employees." },
        { status: 403 }
      );
    }

    // The one rule both comp-off flows share: a work date can never be
    // claimed twice, half days excepted while the total stays within a day.
    const [credits, leaves] = await Promise.all([
      getCompOffCredits(user.email),
      getLeavesByEmployee(user.email),
    ]);
    if (wouldExceedWorkDate(workDateUsage(credits, leaves), workDate, days)) {
      return NextResponse.json(
        { error: WORK_DATE_ALREADY_USED },
        { status: 400 }
      );
    }

    const id = await createCompOffCredit({
      employeeEmail: user.email,
      workDate,
      days,
      reason,
    });
    await notifyCompOffRequested(id, employee.name, user.email);

    return NextResponse.json({ id, message: "Sent for approval" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to record the work day" },
      { status: 500 }
    );
  }
}
