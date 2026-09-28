import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCachedHolidays, refreshHolidaysCache } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Cold-start fallback: populate the cache once if it's never been written
  // (e.g. right after the migration), same pattern as the other singleton
  // caches. Every subsequent read is served from the cache row instead of
  // querying Holiday/WorkingWeekend live.
  const cached = (await getCachedHolidays()) ?? (await refreshHolidaysCache());
  return NextResponse.json(cached.data);
}
