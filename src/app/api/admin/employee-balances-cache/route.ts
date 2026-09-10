import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { refreshEmployeeBalanceCache } from "@/lib/db";

// Triggered by the "Refresh" button on Admin's Employee Balances tab.
export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { computedAt } = await refreshEmployeeBalanceCache();
    return NextResponse.json({ computedAt: computedAt.toISOString() });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to refresh balance cache" },
      { status: 500 }
    );
  }
}

// Triggered by Vercel Cron, which has no browser session to check.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { computedAt } = await refreshEmployeeBalanceCache();
    return NextResponse.json({ computedAt: computedAt.toISOString() });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to refresh balance cache" },
      { status: 500 }
    );
  }
}
