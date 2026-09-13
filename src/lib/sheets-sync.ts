import { JWT } from "google-auth-library";
import {
  Employee,
  EmployeeType,
  Gender,
  ContractType,
  OpeningBalance,
  LeaveBalance,
} from "./types";

const EMPLOYEES_RANGE = "Employees!A:N";
const OPENING_BALANCES_RANGE = "OpeningBalances!A:K";

const EMPLOYEE_TYPES: EmployeeType[] = ["tele-sales", "non-tele-sales"];
const STATUSES = ["active", "inactive"];
const GENDERS: Gender[] = ["male", "female"];
const CONTRACT_TYPES: ContractType[] = [
  "full-time",
  "contractual",
  "part-time",
  "freelancer",
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_MANAGER_MARKERS = new Set(["-", "n/a", "na", "none", "--"]);

// Sheet values like "Full Time" / "part time" get normalized to the
// hyphenated enum form — emails are already lowercased the same way, no
// reason to make the admin retype contract type in a different casing
// convention than what the source CSV already used ("Full Time" etc).
function normalizeContractType(raw: string): ContractType | null {
  const normalized = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return CONTRACT_TYPES.includes(normalized as ContractType)
    ? (normalized as ContractType)
    : null;
}
// Deliberately strict: emails become Firestore document IDs, which reject
// "/" — a value like "n/a" would otherwise silently corrupt the doc path
// and crash the whole sync (all tabs share one Promise.all).
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

const MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// Employee date columns (joiningDate, probationEndDate, fullTimeEffectiveDate)
// are parsed elsewhere with date-fns' parseISO(), which silently returns an
// Invalid Date for anything that isn't yyyy-MM-dd — and Google Sheets often
// returns a date cell as "2-Jan-2024" (its own default display format) via
// the Sheets API rather than whatever ISO string was typed. Normalize that
// common shape here instead of quietly corrupting every entitlement/
// probation calculation downstream.
function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (DATE_RE.test(trimmed)) return trimmed;

  const m = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const [, day, monAbbr, yearRaw] = m;
  const month = MONTH_ABBR[monAbbr.toLowerCase()];
  if (!month) return null;
  const year =
    yearRaw.length === 2
      ? Number(yearRaw) < 50
        ? `20${yearRaw}`
        : `19${yearRaw}`
      : yearRaw;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}
const LEAVE_TYPES: (keyof LeaveBalance)[] = [
  "sick",
  "casual",
  "annual",
  "marriage",
  "maternity",
  "paternity",
  "compassionate",
  "compensatory",
  "wfh",
  "unpaid",
];

function getAuthClient(): JWT {
  return new JWT({
    email: process.env.FIREBASE_CLIENT_EMAIL,
    key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

async function fetchSheetValues(range: string): Promise<string[][]> {
  const sheetId = process.env.EMPLOYEE_SHEET_ID;
  if (!sheetId) throw new Error("EMPLOYEE_SHEET_ID is not set");

  const client = getAuthClient();
  const { token } = await client.getAccessToken();

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
    range
  )}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Sheets API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { values?: string[][] };
  return data.values || [];
}

// ── Employees ──────────────────────────────────────────────────

export interface EmployeeSyncResult {
  employees: Employee[];
  errors: string[];
}

export async function fetchEmployeesFromSheet(): Promise<EmployeeSyncResult> {
  const values = await fetchSheetValues(EMPLOYEES_RANGE);
  if (values.length === 0) return { employees: [], errors: [] };

  const [header, ...rows] = values;
  const colIndex = (key: string) =>
    header.findIndex((h) => h?.trim() === key);
  const get = (row: string[], key: string) =>
    (row[colIndex(key)] || "").trim();

  const employees: Employee[] = [];
  const errors: string[] = [];

  rows.forEach((row, i) => {
    const rowNum = i + 2; // account for header row + 1-indexing
    const email = get(row, "email").toLowerCase();
    if (!email) return; // skip blank rows
    if (!EMAIL_RE.test(email)) {
      errors.push(`Row ${rowNum}: invalid email "${email}"`);
      return;
    }

    const employeeType = get(row, "employeeType").toLowerCase() as EmployeeType;
    const status = get(row, "status").toLowerCase();
    const genderRaw = get(row, "gender").toLowerCase();
    const gender = (genderRaw === "m" ? "male" : genderRaw === "f" ? "female" : genderRaw) as Gender;

    if (!EMPLOYEE_TYPES.includes(employeeType)) {
      errors.push(
        `Row ${rowNum} (${email}): invalid employeeType "${employeeType}"`
      );
      return;
    }
    if (!STATUSES.includes(status)) {
      errors.push(`Row ${rowNum} (${email}): invalid status "${status}"`);
      return;
    }
    if (!GENDERS.includes(gender)) {
      errors.push(`Row ${rowNum} (${email}): invalid gender "${gender}"`);
      return;
    }

    const contractType = normalizeContractType(get(row, "contract type"));
    if (!contractType) {
      errors.push(
        `Row ${rowNum} (${email}): invalid contract type "${get(row, "contract type")}"`
      );
      return;
    }

    // joiningDate drives every accrual/pro-ration formula — reject the row
    // rather than silently feeding parseISO() a date it'll choke on.
    const joiningDateRaw = get(row, "joiningDate");
    const joiningDate = normalizeDate(joiningDateRaw);
    if (joiningDate === null) {
      errors.push(
        `Row ${rowNum} (${email}): invalid joiningDate "${joiningDateRaw}", expected YYYY-MM-DD or D-MMM-YYYY`
      );
      return;
    }

    // probationEndDate/fullTimeEffectiveDate are optional fallback fields —
    // an unparseable value is left blank (with a warning) rather than
    // rejecting the whole row, same as a bad managerEmail.
    const probationEndDateRaw = get(row, "probationEndDate");
    const probationEndDate = normalizeDate(probationEndDateRaw);
    if (probationEndDate === null) {
      errors.push(
        `Row ${rowNum} (${email}): invalid probationEndDate "${probationEndDateRaw}", left blank`
      );
    }

    const fullTimeEffectiveDateRaw = get(row, "fullTimeEffectiveDate");
    const fullTimeEffectiveDate = normalizeDate(fullTimeEffectiveDateRaw);
    if (fullTimeEffectiveDate === null) {
      errors.push(
        `Row ${rowNum} (${email}): invalid fullTimeEffectiveDate "${fullTimeEffectiveDateRaw}", left blank`
      );
    }

    const managerEmailRaw = get(row, "managerEmail").toLowerCase();
    const managerEmail = EMAIL_RE.test(managerEmailRaw) ? managerEmailRaw : "";
    // "-", "n/a", "none" etc. are deliberate "no manager" markers (founders,
    // top-of-org roles) — not a data error worth flagging every sync.
    const isDeliberateBlank = NO_MANAGER_MARKERS.has(managerEmailRaw);
    if (managerEmailRaw && !managerEmail && !isDeliberateBlank) {
      errors.push(
        `Row ${rowNum} (${email}): managerEmail "${managerEmailRaw}" doesn't look like an email, left blank`
      );
    }

    employees.push({
      id: get(row, "id"),
      name: get(row, "name"),
      email,
      joiningDate,
      designation: get(row, "designation"),
      department: get(row, "department"),
      employeeType,
      managerEmail,
      probationEndDate: probationEndDate || "",
      // Role is admin-managed directly in the app now (Team Details' "Role
      // Assigner" tab), never sheet-synced — this value is only used as
      // the default for a genuinely new employee, and ignored entirely for
      // an existing one. See db.ts's upsertEmployeesFromSheet.
      role: "employee",
      status: status as Employee["status"],
      fullTimeEffectiveDate: fullTimeEffectiveDate || "",
      gender,
      contractType,
      // Same reasoning as role above — admin-managed only, ignored by
      // upsertEmployeesFromSheet entirely; this value is never read.
      probationAnnualLeaveApproved: false,
    });
  });

  return { employees, errors };
}

// Holidays and working weekends used to sync from Sheet tabs here, but are
// now managed directly in the app (Team Details' "Company Calendar" tab) to
// avoid having two sources of truth for the same list — see
// src/lib/db.ts's createHoliday/createWorkingWeekend.

// ── Opening / carry-forward balances ───────────────────────────

export interface OpeningBalanceSyncResult {
  balances: OpeningBalance[];
  errors: string[];
}

export async function fetchOpeningBalancesFromSheet(): Promise<OpeningBalanceSyncResult> {
  // The OpeningBalances tab is optional — if it hasn't been created yet,
  // treat that as "no opening balances" rather than failing the whole sync
  // (which would otherwise also break the Employees/Holidays sync bundled
  // with it, since all three run together).
  let values: string[][];
  try {
    values = await fetchSheetValues(OPENING_BALANCES_RANGE);
  } catch {
    return { balances: [], errors: [] };
  }
  if (values.length === 0) return { balances: [], errors: [] };

  const [header, ...rows] = values;
  const colIndex = (key: string) =>
    header.findIndex((h) => h?.trim() === key);
  const get = (row: string[], key: string) =>
    (row[colIndex(key)] || "").trim();

  const balances: OpeningBalance[] = [];
  const errors: string[] = [];

  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const email = get(row, "email").toLowerCase();
    if (!email) return; // skip blank rows
    if (!EMAIL_RE.test(email)) {
      errors.push(`Row ${rowNum}: invalid email "${email}"`);
      return;
    }

    const balance: OpeningBalance = { email };
    for (const type of LEAVE_TYPES) {
      const raw = get(row, type);
      const num = parseFloat(raw);
      balance[type] = Number.isFinite(num) ? num : 0;
    }
    balances.push(balance);
  });

  return { balances, errors };
}
