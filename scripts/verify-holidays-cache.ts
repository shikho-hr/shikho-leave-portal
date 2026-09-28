// One-off check that the new HolidaysCache mirrors live Holiday/
// WorkingWeekend data, same idea as verify-comp-off.ts. Safe to run against
// any environment — read-only aside from populating/refreshing the cache row
// itself, which is exactly what the app does on every write anyway.
//
// Usage: npx tsx --env-file=.env.local scripts/verify-holidays-cache.ts

import {
  computeHolidaysData,
  getCachedHolidays,
  refreshHolidaysCache,
} from "../src/lib/db";

async function main() {
  console.log(`host ${new URL(process.env.DATABASE_URL!).host.split(".")[0]}\n`);

  const live = await computeHolidaysData();
  const { data: refreshed, computedAt } = await refreshHolidaysCache();
  const cached = await getCachedHolidays();

  console.log("live holidays:", live.dates.length, "working weekends:", live.workingWeekendDates.length);
  console.log("computedAt:", computedAt.toISOString());

  const matches =
    JSON.stringify(live) === JSON.stringify(refreshed) &&
    JSON.stringify(live) === JSON.stringify(cached?.data);
  console.log(matches ? "\nMATCH — cache mirrors live data." : "\nMISMATCH!");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
