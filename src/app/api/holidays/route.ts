import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getHolidays } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const holidays = await getHolidays();
  return NextResponse.json({ dates: holidays.map((h) => h.date) });
}
