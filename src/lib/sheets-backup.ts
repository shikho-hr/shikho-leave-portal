import { JWT } from "google-auth-library";
import { LeaveRequest } from "./types";
import { COLUMNS } from "./leave-export-columns";
import { getEmployees } from "./db";

// Separate from sheets-sync.ts's read-only client (roster import) — this
// one needs write access, so it gets its own client with a broader scope
// rather than widening the roster-read client's deliberately narrow one.
function getWriteAuthClient(): JWT {
  return new JWT({
    email: process.env.FIREBASE_CLIENT_EMAIL,
    key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// A1-notation range prefixes require the sheet name in single quotes
// whenever it contains a space or other special character — quoting
// unconditionally is always valid, so there's no need to special-case
// "simple" names. Internal single quotes double up per the A1 spec.
function quoteSheetName(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

// This spreadsheet has several other tabs with real, unrelated data
// (learned the hard way — see git history / conversation), so the backup
// tab is pinned by its stable gid, never by name or position. A rename
// doesn't break this; resolved fresh on every call in case it's renamed
// again.
async function resolveTabName(
  sheetId: string,
  gid: string,
  headers: Record<string, string>
): Promise<string> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
    { headers }
  );
  if (!res.ok) {
    throw new Error(`Sheets API metadata error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    sheets?: { properties: { sheetId: number; title: string } }[];
  };
  const match = data.sheets?.find((s) => String(s.properties.sheetId) === gid);
  if (!match) {
    throw new Error(`No tab with gid ${gid} found in spreadsheet ${sheetId}`);
  }
  return match.properties.title;
}

// Overwrites the backup tab's full contents with the current leaves
// collection — a live mirror, not a dated snapshot. Clears the range first
// so a shrinking row count (e.g. after test-data cleanup) doesn't leave
// stale rows behind from a previous, longer run. Every range is scoped to
// the resolved tab name — never a bare range, which would default to
// whichever tab happens to be first in the spreadsheet.
export async function writeLeaveBackup(leaves: LeaveRequest[]): Promise<number> {
  const sheetId = process.env.LEAVE_BACKUP_SHEET_ID;
  const tabGid = process.env.LEAVE_BACKUP_TAB_GID;
  if (!sheetId) throw new Error("LEAVE_BACKUP_SHEET_ID is not set");
  if (!tabGid) throw new Error("LEAVE_BACKUP_TAB_GID is not set");

  const client = getWriteAuthClient();
  const { token } = await client.getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values`;

  const tabName = quoteSheetName(await resolveTabName(sheetId, tabGid, headers));

  const clearRes = await fetch(`${base}/${encodeURIComponent(`${tabName}!A:N`)}:clear`, {
    method: "POST",
    headers,
  });
  if (!clearRes.ok) {
    throw new Error(`Sheets API clear error: ${clearRes.status} ${await clearRes.text()}`);
  }

  const employees = await getEmployees();
  const employeeIdByEmail = new Map(
    employees.map((e) => [e.email.toLowerCase(), e.id])
  );
  const header = COLUMNS.map((c) => c.header);
  const rows = leaves.map((l) => COLUMNS.map((c) => c.get(l, employeeIdByEmail)));
  const values = [header, ...rows];

  const writeRes = await fetch(
    `${base}/${encodeURIComponent(`${tabName}!A1`)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ values }),
    }
  );
  if (!writeRes.ok) {
    throw new Error(`Sheets API write error: ${writeRes.status} ${await writeRes.text()}`);
  }

  return rows.length;
}
