import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  fetchEmployeesFromSheet,
  fetchOpeningBalancesFromSheet,
} from "@/lib/sheets-sync";
import { upsertEmployeesFromSheet, upsertOpeningBalancesFromSheet } from "@/lib/db";

// Holidays and working weekends are managed directly in the app (Team
// Details' "Company Calendar" tab), not synced from the Sheet — see
// src/app/api/admin/holidays/route.ts and .../working-weekends/route.ts.
// Keeping them out of this sync avoids ever having two sources of truth
// for the same list.
async function runSync() {
  const [employeeResult, balanceResult] = await Promise.all([
    fetchEmployeesFromSheet(),
    fetchOpeningBalancesFromSheet(),
  ]);

  // Opening balances reference employees by email (foreign key in
  // Postgres, unlike Firestore) — employees must be written first, so this
  // can no longer run as a single Promise.all.
  await upsertEmployeesFromSheet(employeeResult.employees);
  await upsertOpeningBalancesFromSheet(balanceResult.balances);

  return NextResponse.json({
    employeesSynced: employeeResult.employees.length,
    openingBalancesSynced: balanceResult.balances.length,
    errors: [...employeeResult.errors, ...balanceResult.errors],
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
