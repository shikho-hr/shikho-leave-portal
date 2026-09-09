import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getLeaveRequests } from "@/lib/db";
import { writeLeaveBackup } from "@/lib/sheets-backup";

async function runBackup() {
  const leaves = await getLeaveRequests();
  const rowsWritten = await writeLeaveBackup(leaves);
  return NextResponse.json({ rowsWritten });
}

// Triggered by the "Backup to Sheet" button on the Team Details page.
export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return await runBackup();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Backup failed" }, { status: 500 });
  }
}

// Triggered by Vercel Cron, which has no browser session to check.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await runBackup();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Backup failed" }, { status: 500 });
  }
}
