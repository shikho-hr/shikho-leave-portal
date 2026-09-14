# Shikho Leave Portal — Production Setup (hr.portal@shikho.com accounts)

Production lives in the **hr.portal@shikho.com** GitHub, Neon, and Vercel
accounts — nothing production-related goes in any personal account. This is
the step-by-step runbook for standing it up. `SETUP-GUIDE.md` covers the
generic first-time setup; this file is specifically the cutover from the
current staging/personal-account setup to real production.

## Status — executed 2026-09-14

| Placeholder | Actual value |
|---|---|
| `<GH_USER>` | `shikho-hr` |
| `<PROD_REPO>` | `shikho-leave-portal` → https://github.com/shikho-hr/shikho-leave-portal (private, default branch `main`) |
| `<NEON_PROJECT_ID>` | `muddy-bird-16918294` (org `org-sweet-meadow-86470378`, host `ep-rapid-mud-b3k7e84f`) |
| `<VERCEL_PROJECT>` | `shikho-leave-portal` on team `hr-shikho` (`prj_nkqFX7rTRtKbWo2u0fL5qqV7AAev`) → https://shikho-leave-portal.vercel.app |

Done: steps 0–3 (schema applied, data copied and verified, 4 test leaves
removed on production only, all 18 env vars set, framework = Next.js,
deployment protection off, first production deploy live and answering 200).

Also done 2026-09-14 (user clicks): Vercel ↔ GitHub connected (`git connect`
from the CLI fails until the hr.portal Vercel account has a GitHub Login
Connection — dashboard: Account Settings → Authentication), and
`shikho-leave-portal.vercel.app` added to Firebase Auth's authorized domains.
Git auto-deploy verified: a push to `main` produced a READY production
deployment in under a minute.

**Commit-author rule (Hobby plan):** Vercel silently sets a git-triggered
deployment to `BLOCKED` (no build, no log, CLI shows `UNKNOWN`) when the
commit's GitHub author isn't the account connected to the project. Commits
authored as `Julkar-niem` were blocked; `leave-portal/.git/config` now has
`user.name = Shikho HR`, `user.email = hr.portal@shikho.com` (repo-local),
which GitHub attributes to `shikho-hr`, and those deploy. Anyone else
pushing to `main` must either commit with that identity or be added to
the Vercel team.

Still open:
- `LEAVE_EMAILS_ENABLED` is `false`; flip when ready (step 5).
- Sign-in / balances / backup not yet click-tested on production (step 5).
- Retire the old Firestore-era deployment (step 6).
- Local `.env.local` still points at `db-migration` (staging DB) — correct,
  leave it. The gitignored `.vercel/` link now points at the *production*
  project; to work on staging again run `vercel link` against
  `shikho-leave-portal-staging` (personal team) first, or the staging
  project deploys go to production by mistake.
- `vercel env pull` returns `""` for every var on this project even though
  they're typed Encrypted — verify values through the build log / live
  behaviour instead, not through `pull`.

---

Placeholders used below:

| Placeholder | Meaning | Notes |
|---|---|---|
| `<GH_USER>` | the hr.portal GitHub username | |
| `<PROD_REPO>` | GitHub repo name for production | |
| `<NEON_PROJECT_ID>` | the new Neon project's ID | shown in the Neon console URL / `npx neon projects list` |
| `<VERCEL_PROJECT>` | Vercel project name | its stable URL becomes `https://<VERCEL_PROJECT>.vercel.app` |

Current state as of 2026-09-13 (what we're moving *from*):

- Code: `Julkar-niem/shikho-leave-portal`, branch `staging` — this is the
  Postgres/Prisma version and is what production should run.
- Data: Neon project `tiny-bonus-58122066` (personal account), branch
  `db-migration` — has the historical leave import, balance snapshots, and
  the 133-active roster. Shared live by local dev and the staging site.
- The *old* production portal (Firestore, unidentified Vercel account) is
  still running and untouched.

---

## 0. Sign the CLIs into the hr.portal accounts (you, in your own terminal)

All three CLIs on this machine are currently signed into personal accounts
(`gh` → Julkar-niem, `vercel` → jntapos-2213, `neon` → julkar.niem). Logging
in needs a browser OAuth round-trip, so this has to be done by hand. Open a
**fresh** PowerShell window (see the Windows CLI gotchas — stale PATH and
execution policy bite here every time) and run:

```bash
gh auth login
```
Pick GitHub.com → HTTPS → "Login with a web browser", and sign in as the
hr.portal account. `gh` keeps both accounts; make hr.portal the active one:

```bash
gh auth switch --user <GH_USER>
```

```bash
vercel logout
```
```bash
vercel login
```
(sign in as hr.portal in the browser it opens)

```bash
npx neon auth
```
(this also opens a browser — sign in as hr.portal)

Confirm before going any further — every one of these must show the
hr.portal identity, not the personal one:

```bash
gh auth status
```
```bash
vercel whoami
```
```bash
npx neon me
```

The gitignored link files `leave-portal/.vercel/project.json` and
`leave-portal/.neon` still point at the personal-account projects; they get
re-linked in steps 2 and 5.

---

## 1. GitHub — create the production repo and push the code

From `leave-portal/` (the git repo root):

```bash
gh repo create <PROD_REPO> --private --description "Shikho Leave Portal (production)"
```
```bash
git remote add prod https://github.com/<GH_USER>/<PROD_REPO>.git
```
```bash
git push prod staging:main
```

That publishes the current `staging` branch (the Postgres version) as the
new repo's `main`, which becomes Vercel's Production Branch. Day-to-day
after cutover: test on `staging` (old repo/site) first, then
`git push prod staging:main` to release.

Recommendation, your call: long-term it's simpler to keep **one** repo under
hr.portal with `main` = production and `staging` = staging, and move the
staging Vercel project there too. Nothing below depends on that decision.

---

## 2. Neon — create the production database and load it

### 2a. Create the project (hr.portal account, Singapore region like the current one)

```bash
npx neon projects create --name <PROD_REPO> --region-id aws-ap-southeast-1
```
(or Neon console → New Project). Then re-link the local checkout:

```bash
npx neon link --project-id <NEON_PROJECT_ID> -y
```

Get both connection strings — the app uses the pooled one, Prisma
migrations use the direct one:

```bash
npx neon connection-string --project-id <NEON_PROJECT_ID> --pooled
```
```bash
npx neon connection-string --project-id <NEON_PROJECT_ID>
```

### 2b. Apply the schema

```powershell
$env:DATABASE_URL_UNPOOLED="<direct URL from 2a>"; npx prisma migrate deploy
```

Expected output: `4 migrations found`, all applied. Setting the variable in
the shell first beats the value `prisma.config.ts` loads from `.env`.

### 2c. Clean up test data on the source first

`db-migration` still holds test leave applications on
`julkar.niem@shikho.com` from email testing (pending/rejected sick and
annual leaves). Delete the ones that aren't real before copying — Neon
console → SQL Editor, **on the `db-migration` branch** (check the
breadcrumb; the `staging` child branch is a different database).

### 2d. Copy the data

`scripts/copy-postgres.ts` copies every application table in foreign-key
order (pg_dump isn't installed here). Source is `db-migration`'s pooled
`DATABASE_URL` from `.env.local`; target is the new project's pooled URL.
Dry run first — it prints per-table counts and writes nothing:

```powershell
$env:SOURCE_URL="<db-migration pooled URL>"; $env:TARGET_URL="<new pooled URL>"; npx tsx scripts/copy-postgres.ts
```

Then for real:

```powershell
$env:SOURCE_URL="<db-migration pooled URL>"; $env:TARGET_URL="<new pooled URL>"; npx tsx scripts/copy-postgres.ts --commit
```

Source counts on 2026-09-13 (yours will differ slightly after 2c and any
further activity, but should be in this neighbourhood):

| Table | Rows |
|---|---|
| Employee | 1781 (133 active) |
| Leave | 1471 |
| BalanceSnapshot | 559 |
| Notification | 28 |
| LeaveComment | 10 |
| Holiday | 5 |
| InternalNote | 1 |
| EmployeeBalanceCache | 1 |
| OpeningBalance | 0 |
| WorkingWeekend | 0 |

The script verifies every table's count matches at the end and exits
non-zero if not. `--truncate` wipes the target first if a copy has to be
redone.

### 2e. Catch up anything written in the OLD Firestore portal since 2026-09-09 — decide first

`npm run migrate:firestore` is idempotent and was designed to be re-run
right before cutover to pick up leaves/comments created in the old portal
after the first migration. **But** it upserts *every* collection including
`BalanceSnapshot`, and the 2026-09-12 historical import wrote newer
snapshot values on `db-migration` than Firestore has — a blind full re-run
against the new database would overwrite those. Options:

- If nobody has used the old portal since 2026-09-09: skip this step.
- Otherwise: run only the leaves / comments / notes / notifications portion
  (ask Claude to run it restricted, with `DATABASE_URL` pointed at the new
  pooled URL), never the snapshot portion.

---

## 3. Vercel — create the production project

Use the **dashboard import**, not `vercel project add` — CLI-created projects
default to Framework Preset "Other" and serve raw 404s.

1. vercel.com (signed in as hr.portal) → Add New → Project → Import
   `<GH_USER>/<PROD_REPO>`.
2. Framework Preset: Next.js (auto-detected). Root Directory: leave as the
   repo root. Production Branch: `main` (default).
3. **Add every environment variable below before the first deploy** — env
   vars are baked in at build time, so anything added later needs a
   redeploy. Environment: Production. Use the dashboard, or after
   `vercel link` use the equals form for every value:

   ```bash
   vercel env add NAME production --value="VALUE"
   ```
   (the space form `--value "VALUE"` silently breaks on values starting
   with `-`, which `FIREBASE_PRIVATE_KEY` does.)

4. Deploy. Then Settings → Deployment Protection → turn **off** Vercel
   Authentication, or nobody without a Vercel login can open the site.
5. The three daily crons in `vercel.json` (roster sync 03:00 UTC, leave
   backup 03:15, balance cache 03:30) register automatically. They call the
   routes with `CRON_SECRET`.

### Environment variables (Production)

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | real "Shikho Leave Portal" Firebase project — same as `.env.local` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | same as `.env.local` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | same as `.env.local` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | same as `.env.local` |
| `FIREBASE_PROJECT_ID` | production service account — same as `.env.local` |
| `FIREBASE_CLIENT_EMAIL` | same as `.env.local` |
| `FIREBASE_PRIVATE_KEY` | same as `.env.local`, full PEM with `\n` sequences |
| `EMPLOYEE_SHEET_ID` | real Employees sheet — same as `.env.local` |
| `LEAVE_BACKUP_SHEET_ID` | same as `.env.local` |
| `LEAVE_BACKUP_TAB_GID` | same as `.env.local` (`1154152111`) |
| `CRON_SECRET` | **generate a fresh random string** — do not reuse staging's |
| `DATABASE_URL` | new Neon project, **pooled** URL (step 2a) |
| `DATABASE_URL_UNPOOLED` | new Neon project, **direct** URL (step 2a) — the build runs `prisma migrate deploy` with it |
| `GMAIL_USER` | `hr.portal@shikho.com` — same as `.env.local` |
| `GMAIL_APP_PASSWORD` | same as `.env.local` |
| `MAIL_FROM` | same as `.env.local` |
| `APP_BASE_URL` | `https://<VERCEL_PROJECT>.vercel.app` — the stable alias, never a per-deployment hash URL |
| `LEAVE_EMAILS_ENABLED` | `false` for the first deploy; flip to `true` once sign-in and balances are verified |

Do **not** set: `NEXT_PUBLIC_ENV` (only turns on the staging banner),
`LEAVE_EMAILS_SKIP_HR_FOR_TESTING` (test-only, must never exist in
production).

Generate the new `CRON_SECRET`:

```powershell
-join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

---

## 4. Firebase — authorize the new domain (console click, real project)

Firebase Console → project **Shikho Leave Portal** (the real one, not
`-demo`) → Authentication → Settings → Authorized domains → Add
`<VERCEL_PROJECT>.vercel.app`. Without this Google sign-in fails with a
generic "Sign-in was cancelled or failed" — the real error code is
swallowed, so check this list first if sign-in breaks.

Nothing else on the Firebase side changes: the real project's Sheets API,
service-account sheet sharing, and Auth setup have been running for months.
Firestore in that project is no longer read by the app at all.

---

## 5. Verify

1. Open `https://<VERCEL_PROJECT>.vercel.app`, sign in as an admin.
2. Dashboard loads with balances; Team Details shows the 133 active
   employees; "Refresh Balances" succeeds; "Backup to Sheet" succeeds.
3. Vercel → project → Logs: no runtime errors on `/api/*`.
4. Next morning: confirm the three crons ran (Vercel → Cron Jobs tab, and
   the backup sheet has a fresh timestamp).
5. Then set `LEAVE_EMAILS_ENABLED=true` and redeploy (Deployments →
   Redeploy) if notifications are wanted from day one.

---

## 6. After cutover

- Announce the new URL; take the old Firestore-era deployment offline (or
  point people away from it). Leave the old Firestore data alone as a
  backup — nothing deletes it.
- Keep `.env.local` pointed at `db-migration`, **not** at production —
  local dev and staging keep sharing the staging database. Only the Vercel
  production project should ever hold the production `DATABASE_URL`.
- Onboarding more people is unchanged: set `status=Active` in the
  Employees sheet, then sync (nightly cron or the "Sync from Sheet" button).
