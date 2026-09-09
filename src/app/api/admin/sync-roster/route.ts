import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  fetchEmployeesFromSheet,
  fetchHolidaysFromSheet,
  fetchOpeningBalancesFromSheet,
} from "@/lib/sheets-sync";
import {
  upsertEmployeesFromSheet,
  upsertHolidaysFromSheet,
  upsertOpeningBalancesFromSheet,
} from "@/lib/db";

async function runSync() {
  const [employeeResult, holidayResult, balanceResult] = await Promise.all([
    fetchEmployeesFromSheet(),
    fetchHolidaysFromSheet(),
    fetchOpeningBalancesFromSheet(),
  ]);

  // Opening balances reference employees by email (foreign key in
  // Postgres, unlike Firestore) — employees must be written first, so this
  // can no longer run as a single Promise.all like the other two.
  await upsertEmployeesFromSheet(employeeResult.employees);
  await Promise.all([
    upsertHolidaysFromSheet(holidayResult.holidays),
    upsertOpeningBalancesFromSheet(balanceResult.balances),
  ]);

  return NextResponse.json({
    employeesSynced: employeeResult.employees.length,
    holidaysSynced: holidayResult.holidays.length,
    openingBalancesSynced: balanceResult.balances.length,
    errors: [
      ...employeeResult.errors,
      ...holidayResult.errors,
      ...balanceResult.errors,
    ],
  });
}

// Triggered by the "Sync from Sheet" button on the Admin page.
export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return await runSync();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

// Triggered by Vercel Cron, which has no browser session to check.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await runSync();
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
