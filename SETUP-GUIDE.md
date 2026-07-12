# Shikho Leave Portal — Setup Guide

## 1. Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a new project (e.g. "Shikho Leave Portal")
2. You can disable Google Analytics for this project — it isn't needed

### Enable Google Sign-In

1. In the Firebase Console, go to **Build → Authentication → Get started**
2. Under **Sign-in method**, enable **Google**
3. Set a support email and save

### Create Firestore

1. Go to **Build → Firestore Database → Create database**
2. Choose **Start in production mode** (the app ships its own `firestore.rules` — see below)
3. Pick a region close to your users

### Get the web app config

1. Go to **Project settings** (gear icon) → **General** → scroll to **Your apps**
2. Click the **Web** icon (`</>`) to register a new web app (no Firebase Hosting needed)
3. Copy the config values into `.env.local` as the `NEXT_PUBLIC_FIREBASE_*` variables

### Get the Admin SDK service account key

1. Go to **Project settings → Service accounts**
2. Click **Generate new private key** — this downloads a JSON file
3. From that JSON, copy:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (keep it wrapped in quotes, keep the `\n` sequences as-is — the code converts them back to real newlines)

**Keep this JSON file private — never commit it.** It grants full admin access to your Firebase project.

### Deploy security rules & indexes (recommended)

The app only talks to Firestore through the Admin SDK on the server, so `firestore.rules` denies all direct client access. A few queries (e.g. "my leave requests, newest first") need composite indexes.

Using the [Firebase CLI](https://firebase.google.com/docs/cli):

```bash
npm install -g firebase-tools
firebase login
firebase use --add   # select your project
firebase deploy --only firestore:rules,firestore:indexes
```

If you skip this, Firestore will still work — the first time a query needs an index, it throws an error in the server logs containing a link that creates the index for you in one click (takes ~1 minute to build).

## 2. Employee Roster (Google Sheet)

The employee roster — who can sign in, and the fields the leave-balance calculator needs — lives in a Google Sheet. The app syncs it into Firestore (once daily automatically, or on demand), rather than reading the Sheet directly on every request, so sign-ins stay fast even if Sheets is briefly unavailable.

### Create the sheet

Create a Google Sheet with three tabs.

**`Employees`** tab — row 1 is a header row with these column names (any order):

`id | name | email | joiningDate | department | employeeType | managerEmail | probationEndDate | role | status | fullTimeEffectiveDate | gender | contract type`

| Column | Notes |
|--------|-------|
| `id` | Employee code, e.g. `EMP-001` |
| `name` | Full name |
| `email` | Must match the Google account used to sign in |
| `joiningDate` | `YYYY-MM-DD` |
| `department` | |
| `employeeType` | `tele-sales` or `non-tele-sales` — this is the department/track label, no longer what decides leave entitlement (see `contract type` below) |
| `managerEmail` | Used to find direct reports for approvals |
| `probationEndDate` | `YYYY-MM-DD` |
| `role` | `employee`, `manager`, or `admin` |
| `status` | `active` or `inactive` — set to `inactive` to revoke portal access |
| `fullTimeEffectiveDate` | Only needed if someone *converted* to Full Time partway through — marks the date their entitlement switches to the full formula. Leave blank if they were Full Time from their joining date, or if they're not Full Time at all |
| `gender` | `male` or `female` — gates maternity leave to female employees and paternity leave to male employees |
| `contract type` | `Full Time`, `Contractual`, `Part Time`, or `Freelancer` (case/spacing don't matter, e.g. `full-time` also works) — **this is what decides entitlement**: `Full Time` gets the full 14 sick/10 casual/pro-rated annual formula (from `fullTimeEffectiveDate`, or `joiningDate` if that's blank); `Contractual`/`Part Time` get 1 sick + 1 casual per month worked, no annual leave; `Freelancer` gets zero entitlement across every leave type (no leave types are even offered on the Apply Leave page) — regardless of `employeeType`. A Tele-Sales employee who's Full Time from day one should have `employeeType = tele-sales` and `contract type = Full Time` |

Emails don't need to be typed in lowercase — the sync lowercases them automatically.

**`Holidays`** tab — row 1 is a header row with these columns:

`date | name`

| Column | Notes |
|--------|-------|
| `date` | `YYYY-MM-DD` |
| `name` | e.g. `Independence Day` (optional, just a label) |

These dates, plus every Friday and Saturday (the company weekend), are excluded when the app counts leave days.

**Important — force the `date` column to plain text.** If Sheets auto-detects the column as a date, the API can return it reformatted (e.g. per the spreadsheet's locale) and it may not come back as `YYYY-MM-DD`, silently syncing the wrong date. Before typing dates, select the column → **Format → Number → Plain text**, or prefix each entry with an apostrophe (`'2026-08-08`) to force it to stay literal text.

**`OpeningBalances`** tab — row 1 is a header row with `email` plus one column per leave type:

`email | sick | casual | annual | marriage | maternity | paternity | compassionate | compensatory | wfh | unpaid`

Each leave-type column is a number of days to add on top of what the app already computes for that employee — e.g. leave carried over from before the portal existed, or a manual HR correction. Leave a cell blank for `0`. This tab is optional — if you don't need opening balances yet, skip it; the sync just treats a missing tab as "no adjustments."

### Give the app access to the sheet

1. Enable the **Google Sheets API**: in [console.cloud.google.com](https://console.cloud.google.com), select the same project as your Firebase project (Firebase projects are backed by a GCP project of the same name), go to **APIs & Services → Library**, search "Google Sheets API", and enable it.
2. Share the Sheet (the **Share** button, top right) with your Firebase service account's email — that's the `client_email` value from the service account JSON you downloaded earlier (looks like `firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com`). **Viewer** access is enough.
3. Copy the Sheet's ID from its URL (`https://docs.google.com/spreadsheets/d/THIS_PART/edit`) into `.env.local` as `EMPLOYEE_SHEET_ID`.
4. Generate a random string for `CRON_SECRET` in `.env.local` (e.g. `openssl rand -base64 32`) — this lets the scheduled sync authenticate without a login session.

### Bootstrap the first admin

You need one working login before you can use the in-app sync button. In the Firebase Console, go to **Firestore Database → Start collection**, create an `employees` collection, and manually add **one** document for yourself: document ID = your email (lowercase), with `role: "admin"`, `status: "active"`, `gender` set correctly, and `contractType: "full-time"` (note: the Firestore field is `contractType`, camelCase, unlike the sheet's `contract type` column), plus the other fields from the table above. Everyone else will come from the Sheet sync.

### Running the sync

- **On demand:** log in as that admin, go to the **Admin** page, click **Sync from Sheet**. It syncs the `Employees`, `Holidays`, and `OpeningBalances` tabs together and reports how many rows of each synced, plus any rows it skipped (e.g. a typo in `employeeType` or a badly formatted date).
- **Automatically:** `vercel.json` schedules a daily sync via Vercel Cron (`0 3 * * *` UTC). This requires `CRON_SECRET` to be set as an environment variable in Vercel. Vercel's free/Hobby plan only allows once-daily cron jobs — the manual sync button covers cases where you need it sooner.

Removing a row from the sheet does **not** delete that employee from Firestore — set their `status` to `inactive` and sync instead. Removing a holiday row also doesn't delete it from Firestore (harmless — a stale future holiday just needs manual cleanup in Firestore if you actually remove one).

### Exporting leave data

The Admin page has **Export CSV** and **Export XLSX** buttons that download every leave request (employee, type, dates, days, status, reviewer, etc.) — no setup needed, they're just admin-only download links.

## 3. Environment Variables

Copy `.env.local.example` to `.env.local` and fill in the values from the steps above.

## 4. Local Development

```bash
cd leave-portal
npm install
npm run dev
```

Open `http://localhost:3000`

## 5. Deploy to Vercel

1. Push the `leave-portal` folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import the repo
3. Set the **Root Directory** to `leave-portal` (if it's in a subfolder)
4. Add all environment variables from `.env.local` to Vercel (Settings → Environment Variables), including `EMPLOYEE_SHEET_ID` and `CRON_SECRET`
   - For `FIREBASE_PRIVATE_KEY`, paste the full value including the `\n` sequences and the surrounding quotes exactly as they appear in `.env.local`
5. Deploy — Vercel will pick up the daily sync schedule from `vercel.json` automatically

Back in the Firebase Console, go to **Authentication → Settings → Authorized domains** and add your Vercel domain (`your-app.vercel.app`) so Google sign-in works in production.

## Troubleshooting

**"Sign-in was cancelled or failed":** Check that the Vercel/production domain is added under Authentication → Settings → Authorized domains in Firebase.

**"Access denied. Your account is not a registered employee":** The signed-in Google account's email must exist as a document ID (lowercase) in the `employees` collection with `status: "active"`.

**A query fails with a Firestore index error:** Click the link in the error message to auto-create the missing composite index, or run `firebase deploy --only firestore:indexes` after checking `firestore.indexes.json` covers it.

**"Invalid PEM formatted message" or Admin SDK init errors:** Usually means `FIREBASE_PRIVATE_KEY` lost its `\n` escaping when pasted somewhere — copy it fresh from the service account JSON file.

**Sheet sync fails with a 403 from the Sheets API:** The Sheet isn't shared with the service account email, or the Sheets API isn't enabled on the GCP project — see "Give the app access to the sheet" above.

**Sheet sync reports 0 synced:** Check the tab is named exactly `Employees` and the header row matches the documented column names exactly.
