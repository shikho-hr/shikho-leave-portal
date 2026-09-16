import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { getLeaveRequests } from "@/lib/db";
import { LeaveRequest } from "@/lib/types";
import { COLUMNS } from "@/lib/leave-export-columns";

function toCsv(leaves: LeaveRequest[]): string {
  const escape = (val: string | number) => {
    const s = String(val ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = COLUMNS.map((c) => escape(c.header)).join(",");
  const rows = leaves.map((l) =>
    COLUMNS.map((c) => escape(c.get(l))).join(",")
  );
  return [header, ...rows].join("\r\n");
}

function toXlsx(leaves: LeaveRequest[]): Buffer {
  const data = leaves.map((l) =>
    Object.fromEntries(COLUMNS.map((c) => [c.header, c.get(l)]))
  );
  const worksheet = XLSX.utils.json_to_sheet(data, {
    header: COLUMNS.map((c) => c.header),
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Leaves");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const format = req.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const status = req.nextUrl.searchParams.get("status") || "all";
  const leaveType = req.nextUrl.searchParams.get("leaveType") || "all";
  const dateFrom = req.nextUrl.searchParams.get("dateFrom") || "";
  const dateTo = req.nextUrl.searchParams.get("dateTo") || "";
  const search = (req.nextUrl.searchParams.get("search") || "").toLowerCase();

  const allLeaves = await getLeaveRequests();
  // Same predicate as the All Requests table on Team Details, so an
  // export always matches whatever's currently filtered on screen.
  const leaves = allLeaves.filter(
    (l) =>
      (status === "all" || l.status === status) &&
      (leaveType === "all" || l.leaveType === leaveType) &&
      (!dateFrom || l.endDate >= dateFrom) &&
      (!dateTo || l.startDate <= dateTo) &&
      (!search ||
        l.employeeName.toLowerCase().includes(search) ||
        l.employeeEmail.toLowerCase().includes(search))
  );
  const filename = `leave-requests-${new Date().toISOString().split("T")[0]}.${format}`;

  if (format === "xlsx") {
    return new NextResponse(new Uint8Array(toXlsx(leaves)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return new NextResponse(toCsv(leaves), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
