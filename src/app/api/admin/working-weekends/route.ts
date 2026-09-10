import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getWorkingWeekends, createWorkingWeekend } from "@/lib/db";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const dates = await getWorkingWeekends();
  return NextResponse.json(dates);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const date = (body.date || "").trim();
  if (!DATE_RE.test(date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const day = new Date(date).getUTCDay();
  if (day !== 5 && day !== 6) {
    return NextResponse.json(
      { error: "date must be a Friday or Saturday — it's already a working day otherwise" },
      { status: 400 }
    );
  }

  await createWorkingWeekend(date);
  return NextResponse.json({ date });
}
