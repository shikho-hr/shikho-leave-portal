import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getEmployeesByManager,
  getApprovedLeavesGroupedByEmployees,
  getAllOpeningBalances,
  getAllBalanceSnapshots,
  getCompOffSummaries,
  getCachedEmployeeBalances,
  refreshEmployeeBalanceCache,
  getCachedRoster,
  refreshRosterCache,
} from "@/lib/db";
import { calculateBalance } from "@/lib/leave-calculator";

export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (user.role !== "admin" && user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    if (user.role === "admin") {
      // Both the employee list and its full-company balance computation
      // (full leaves scan + per-employee calculateBalance) are served from
      // roster-sync-refreshed caches instead of recomputed on every
      // request — see refreshRosterCache/refreshEmployeeBalanceCache in
      // db.ts, refreshed by "Sync from Sheet" (manual + ~15-day cron) and
      // by direct admin edits that bypass sync (role/probation changes).
      let rosterCache = await getCachedRoster();
      if (!rosterCache) {
        // Cold start (e.g. right after deploy/migration, before the first
        // sync) — compute once and populate so this isn't stuck empty.
        rosterCache = await refreshRosterCache();
      }
      const employees = rosterCache.data;
      let cache = await getCachedEmployeeBalances();
      if (!cache) {
        // Cold start (e.g. right after deploy, before the first nightly
        // run) — compute once and populate the cache so subsequent
        // requests are fast without waiting for the cron.
        cache = await refreshEmployeeBalanceCache();
      }
      const enriched = employees.map((emp) => ({
        ...emp,
        balance: cache!.data[emp.email],
      }));
      return NextResponse.json(enriched, {
        headers: { "X-Cache-Computed-At": cache.computedAt.toISOString() },
      });
    }

    // Manager: always live — reportee-scoped and already cheap.
    const employees = (await getEmployeesByManager(user.email)).filter(
      (e) => e.status === "active"
    );
    const [approvedByEmail, openingBalances, snapshots, compOff] =
      await Promise.all([
        getApprovedLeavesGroupedByEmployees(employees.map((e) => e.email)),
        getAllOpeningBalances(),
        getAllBalanceSnapshots(),
        getCompOffSummaries(employees.map((e) => e.email)),
      ]);

    const enriched = employees.map((emp) => {
      const approved = approvedByEmail.get(emp.email) || [];
      const balance = calculateBalance(
        emp,
        approved,
        openingBalances.get(emp.email),
        snapshots.get(emp.email),
        undefined,
        undefined,
        compOff.get(emp.email.toLowerCase())
      );
      return {
        ...emp,
        balance: balance.remaining,
      };
    });

    return NextResponse.json(enriched);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch employees" },
      { status: 500 }
    );
  }
}
