import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isSystemAdmin } from "@/lib/system-admin";
import {
  getLeavesByEmployee,
  getLeavesByEmployees,
  getEmployeesByManager,
  getPendingLeavesForManager,
  getLeaveRequests,
  createLeaveRequest,
  getEmployeeByEmail,
  getEmployeeNamesByEmails,
  getApprovedLeavesByEmployee,
  getLeavesVisibleToHR,
  addComment,
  getHolidays,
  getWorkingWeekends,
  getOpeningBalance,
  getBalanceSnapshot,
  getCompOffSummary,
  getCompOffCredits,
} from "@/lib/db";
import {
  calculateBalance,
  validateLeaveRequest,
  calculateLeaveDays,
  splitDaysByYear,
  REASON_OPTIONAL_TYPES,
  MIN_REASON_LENGTH,
} from "@/lib/leave-calculator";
import { LeaveType, HalfDayPeriod, BalanceInfo, LeaveRequest } from "@/lib/types";
import { parseISO } from "date-fns";

// Attaches a display name for reviewedBy (an email) — the History tab shows
// "Reviewed by <name>", which reads far better than a raw email address.
async function withReviewerNames(leaves: LeaveRequest[]) {
  const names = await getEmployeeNamesByEmails(leaves.map((l) => l.reviewedBy));
  return leaves.map((l) => ({
    ...l,
    reviewedByName: l.reviewedBy
      ? names.get(l.reviewedBy.toLowerCase())
      : undefined,
  }));
}

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
      const leaves = await getLeavesVisibleToHR();
      return NextResponse.json(leaves);
    }

    if (view === "all" && user.role === "admin") {
      const leaves = await getLeaveRequests();
      return NextResponse.json(await withReviewerNames(leaves));
    }

    if (view === "all" && user.role === "manager") {
      const reportees = (await getEmployeesByManager(user.email)).filter(
        (e) => e.status === "active"
      );
      const leaves = await getLeavesByEmployees(reportees.map((e) => e.email));
      return NextResponse.json(await withReviewerNames(leaves));
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
  // The HR automation account isn't staff and has no balance to draw on.
  if (isSystemAdmin(user.email))
    return NextResponse.json(
      { error: "The HR Portal system admin cannot apply for leave." },
      { status: 403 }
    );

  try {
    const body = await req.json();
    const { leaveType, startDate, endDate, reason } = body;
    const halfDayPeriod = body.halfDayPeriod as HalfDayPeriod | undefined;
    const extraWorkStartDate = body.extraWorkStartDate as string | undefined;
    const extraWorkEndDate = body.extraWorkEndDate as string | undefined;

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
    // client-submitted number — excluding the weekend and holidays, unless
    // the specific date is a working-weekend override.
    const [holidays, workingWeekends] = await Promise.all([
      getHolidays(),
      getWorkingWeekends(),
    ]);
    const holidayDates = holidays.map((h) => h.date);
    const days = calculateLeaveDays(
      startDate,
      endDate,
      halfDayPeriod,
      holidayDates,
      workingWeekends,
      leaveType as LeaveType
    );

    // Validate balance — per year, since a backdated request applied for
    // after New Year's can span two calendar years (e.g. taken Dec 30 but
    // applied for Jan 2). Each year's portion is checked against that
    // year's own balance, not whichever year "today" happens to be.
    const daysByYear = splitDaysByYear(
      startDate,
      endDate,
      halfDayPeriod,
      holidayDates,
      workingWeekends,
      leaveType as LeaveType
    );
    const startYear = parseISO(startDate).getFullYear();

    const approved = await getApprovedLeavesByEmployee(user.email);
    const allLeaves = await getLeavesByEmployee(user.email);
    const openingBalance = await getOpeningBalance(user.email);
    const snapshot = await getBalanceSnapshot(user.email);
    const compOff = await getCompOffSummary(user.email);
    const compOffCredits = await getCompOffCredits(user.email);

    const balancesByYear: Record<string, BalanceInfo> = {};
    for (const yearStr of Object.keys(daysByYear)) {
      const year = Number(yearStr);
      // Probation-as-of check uses the leave's own date within that year's
      // portion, not "today" — startDate for the earlier year, endDate for
      // the (at most one) later year a request can span.
      const asOfDate = year === startYear ? parseISO(startDate) : parseISO(endDate);
      balancesByYear[yearStr] = calculateBalance(
        employee,
        approved,
        openingBalance || undefined,
        snapshot || undefined,
        year,
        asOfDate,
        compOff
      );
    }

    const validation = validateLeaveRequest(
      employee,
      balancesByYear,
      leaveType as LeaveType,
      days,
      daysByYear,
      startDate,
      halfDayPeriod,
      allLeaves,
      { startDate: extraWorkStartDate, endDate: extraWorkEndDate },
      compOffCredits
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
      daysByYear,
      halfDayPeriod,
      extraWorkStartDate,
      extraWorkEndDate,
      reason,
      status: "pending",
      appliedOn: new Date().toISOString().split("T")[0],
    });

    // Auto-add the reason as the first comment — always, even left blank
    // for a reason-optional type (Maternity/Paternity/Monthly WFH for
    // Ladies), so the employee/manager/HR submission email still goes out.
    // getComments() already strips this entry from the visible thread when
    // it's blank (matches leave.reason exactly), so an empty reason never
    // shows as a stray comment. Flagged as a submission so recipients see
    // "X submitted a new leave request" rather than a generic comment
    // notification.
    await addComment(id, user.email, employee.name, reason, true);

    return NextResponse.json({ id, message: "Leave request submitted" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to submit leave request" },
      { status: 500 }
    );
  }
}
