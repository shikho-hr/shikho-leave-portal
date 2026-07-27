import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getApprovedLeavesOverlapping,
  getHolidaysByDates,
  getEmployeeDepartmentsByEmails,
} from "@/lib/db";
import { addDays, format, parseISO, startOfWeek } from "date-fns";

// Weekday analytics for the management view: expands approved leaves into
// one row per employee per covered working day (Sun–Thu; Fri/Sat is the
// company weekend) so the client can aggregate and filter in memory.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Admin-only, deliberately stricter than /api/employees — this exposes
  // company-wide data across all departments.
  if (user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekStartParam = searchParams.get("weekStart");
  if (!weekStartParam || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartParam)) {
    return NextResponse.json(
      { error: "weekStart must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    // Snap whatever date was sent to its Sunday, so the client can pass any
    // day and always get a consistent Sun–Thu working week back.
    const sunday = startOfWeek(parseISO(weekStartParam), { weekStartsOn: 0 });
    const days = Array.from({ length: 5 }, (_, i) =>
      format(addDays(sunday, i), "yyyy-MM-dd")
    );

    const [leaves, holidaySet] = await Promise.all([
      getApprovedLeavesOverlapping(days[0], days[4]),
      getHolidaysByDates(days),
    ]);

    const departments = await getEmployeeDepartmentsByEmails(
      leaves.map((l) => l.employeeEmail)
    );

    const rows: {
      date: string;
      employeeEmail: string;
      employeeName: string;
      department: string;
      leaveType: string;
    }[] = [];
    for (const date of days) {
      // A holiday consumes no leave (same semantics as splitDaysByYear), so
      // nobody counts as "on leave" that day.
      if (holidaySet.has(date)) continue;
      for (const leave of leaves) {
        if (leave.startDate <= date && date <= leave.endDate) {
          rows.push({
            date,
            employeeEmail: leave.employeeEmail,
            employeeName: leave.employeeName,
            department: departments.get(leave.employeeEmail) || "",
            leaveType: leave.leaveType,
          });
        }
      }
    }

    return NextResponse.json({
      weekStart: days[0],
      days,
      holidays: days.filter((d) => holidaySet.has(d)),
      rows,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to load analytics" },
      { status: 500 }
    );
  }
}
