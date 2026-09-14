// Copy every application table from one Postgres database to another.
//
// Built for the production cutover: the hr.portal@shikho.com Neon project is
// a brand-new, empty database, and the data that should become production's
// starting point lives in the old personal-account Neon project (the
// `db-migration` branch — historical leave import, balance snapshots, the
// current 133-active roster). pg_dump/pg_restore aren't installed on this
// machine, so this does the same job over the Neon HTTP driver.
//
// Usage (from leave-portal/):
//   SOURCE_URL="postgresql://..." TARGET_URL="postgresql://..." \
//     npx tsx scripts/copy-postgres.ts            # dry run: counts only
//   SOURCE_URL=... TARGET_URL=... npx tsx scripts/copy-postgres.ts --commit
//   SOURCE_URL=... TARGET_URL=... npx tsx scripts/copy-postgres.ts --commit --truncate
//
// Prerequisites on the TARGET:
//   1. Run `prisma migrate deploy` against it first (DATABASE_URL_UNPOOLED
//      pointed at the target) so every table and `_prisma_migrations` exist.
//      This script copies DATA only — never schema, never migration history.
//   2. Every table must be empty, unless --truncate is passed (which wipes
//      all application tables on the target first, CASCADE).
//
// Safety:
//   - Only ever READS from SOURCE_URL. Refuses to run if the two URLs share a
//     host (guards against copying a database onto itself).
//   - Without --commit nothing is written; it prints per-table source/target
//     counts so the numbers can be sanity-checked first.
//   - Tables are copied in foreign-key order. Employee is self-referencing
//     (managerEmail -> email), so it's inserted with managerEmail NULL first
//     and patched in a second pass — Prisma's FK is not deferrable, so a
//     chunked insert could otherwise hit a manager who's in a later chunk.
//   - Verifies every table's row count matches at the end and exits non-zero
//     if any don't.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Foreign-key order: parents before children.
const TABLES = [
  "Employee",
  "Holiday",
  "WorkingWeekend",
  "OpeningBalance",
  "BalanceSnapshot",
  "EmployeeBalanceCache",
  "Leave",
  "LeaveComment",
  "InternalNote",
  "Notification",
] as const;

const CHUNK = 200;

type Sql = NeonQueryFunction<false, false>;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function count(sql: Sql, table: string): Promise<number> {
  const [{ count }] = await sql.query(`select count(*)::int as count from "${table}"`);
  return count as number;
}

async function tableExists(sql: Sql, table: string): Promise<boolean> {
  const rows = await sql.query(
    `select 1 from pg_tables where schemaname='public' and tablename=$1`,
    [table],
  );
  return rows.length > 0;
}

async function columns(sql: Sql, table: string): Promise<string[]> {
  const rows = await sql.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name=$1 order by ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name as string);
}

// Every column is read as its Postgres TEXT representation ("2026-01-14",
// "5.0", "{...}") and written back as an untyped parameter, which Postgres
// casts to the destination column's type. This is what pg_dump does and it
// sidesteps the driver's JS type parsing entirely — a `date` parsed into a
// JS Date at local midnight and re-serialised in UTC would shift by a day
// on a UTC+6 machine.
async function readRows(sql: Sql, table: string, cols: string[]): Promise<Record<string, string | null>[]> {
  const select = cols.map((c) => `"${c}"::text as "${c}"`).join(", ");
  return (await sql.query(`select ${select} from "${table}"`)) as Record<string, string | null>[];
}

async function insertRows(
  sql: Sql,
  table: string,
  cols: string[],
  rows: Record<string, string | null>[],
  overrides: Record<string, string | null> = {},
): Promise<void> {
  if (rows.length === 0) return;
  const colList = cols.map((c) => `"${c}"`).join(", ");
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params: (string | null)[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = cols.map((c) => {
        params.push(c in overrides ? overrides[c] : row[c]);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await sql.query(`insert into "${table}" (${colList}) values ${tuples.join(", ")}`, params);
  }
}

async function main() {
  const commit = process.argv.includes("--commit");
  const truncate = process.argv.includes("--truncate");
  const sourceUrl = need("SOURCE_URL");
  const targetUrl = need("TARGET_URL");

  const sourceHost = new URL(sourceUrl).host;
  const targetHost = new URL(targetUrl).host;
  if (sourceHost.replace("-pooler", "") === targetHost.replace("-pooler", "")) {
    throw new Error(`SOURCE and TARGET point at the same host (${sourceHost}) — refusing.`);
  }
  console.log(`source: ${sourceHost}`);
  console.log(`target: ${targetHost}`);
  console.log(`mode:   ${commit ? "COMMIT" : "dry run"}${truncate ? " + truncate target" : ""}\n`);

  const source = neon(sourceUrl);
  const target = neon(targetUrl);

  // Preflight: target must have the schema, and be empty unless --truncate.
  const missing: string[] = [];
  const nonEmpty: string[] = [];
  console.log("table                    source  target");
  for (const t of TABLES) {
    const srcCount = await count(source, t);
    if (!(await tableExists(target, t))) {
      missing.push(t);
      console.log(`${t.padEnd(24)} ${String(srcCount).padStart(6)}  MISSING`);
      continue;
    }
    const tgtCount = await count(target, t);
    if (tgtCount > 0) nonEmpty.push(t);
    console.log(`${t.padEnd(24)} ${String(srcCount).padStart(6)}  ${tgtCount}`);
  }
  console.log();
  if (missing.length) {
    throw new Error(
      `Target is missing tables: ${missing.join(", ")}. Run \`prisma migrate deploy\` against it first.`,
    );
  }
  if (nonEmpty.length && !truncate) {
    throw new Error(
      `Target already has rows in: ${nonEmpty.join(", ")}. Re-run with --truncate to wipe them first.`,
    );
  }
  if (!commit) {
    console.log("Dry run only — re-run with --commit to copy.");
    return;
  }

  if (truncate && nonEmpty.length) {
    const list = TABLES.map((t) => `"${t}"`).join(", ");
    await target.query(`truncate table ${list} cascade`);
    console.log("Truncated target tables.\n");
  }

  for (const t of TABLES) {
    const cols = await columns(source, t);
    const rows = await readRows(source, t, cols);
    if (t === "Employee") {
      await insertRows(target, t, cols, rows, { managerEmail: null });
      const withManager = rows.filter((r) => r.managerEmail);
      for (let i = 0; i < withManager.length; i += CHUNK) {
        const chunk = withManager.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const tuples = chunk.map((r) => {
          params.push(r.email, r.managerEmail);
          return `($${params.length - 1}, $${params.length})`;
        });
        await target.query(
          `update "Employee" e set "managerEmail" = v.manager_email
             from (values ${tuples.join(", ")}) as v(email, manager_email)
            where e.email = v.email`,
          params,
        );
      }
    } else {
      await insertRows(target, t, cols, rows);
    }
    console.log(`copied ${t.padEnd(22)} ${rows.length}`);
  }

  console.log("\nVerifying counts...");
  let mismatched = false;
  for (const t of TABLES) {
    const [s, g] = await Promise.all([count(source, t), count(target, t)]);
    const ok = s === g;
    if (!ok) mismatched = true;
    console.log(`${ok ? "ok  " : "FAIL"} ${t.padEnd(22)} ${s} -> ${g}`);
  }
  if (mismatched) {
    console.error("\nRow counts differ — inspect before using the target.");
    process.exit(1);
  }
  console.log("\nDone. Target matches source.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
