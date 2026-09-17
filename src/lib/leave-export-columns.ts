import { LeaveRequest } from "./types";

// Shared column definition for anything that exports the full leaves
// collection in tabular form — the CSV/XLSX download (api/admin/export)
// and the Google Sheet backup (sheets-backup.ts) both use this, so the two
// surfaces can never drift out of sync with each other.
//
// `employeeIdByEmail` is keyed by lowercased email — same lookup source
// and "—" placeholder rule (for employees whose sheet ID was never
// persisted, who still carry their email as an id) as the ID columns on
// Team Details' Employee Balances / All Requests tables.
export const COLUMNS: {
  header: string;
  get: (l: LeaveRequest, employeeIdByEmail: Map<string, string>) => string | number;
}[] = [
  {
    header: "Employee ID",
    get: (l, employeeIdByEmail) => {
      const id = employeeIdByEmail.get(l.employeeEmail.toLowerCase());
      return id && id !== l.employeeEmail ? id : "—";
    },
  },
  { header: "Employee Name", get: (l) => l.employeeName },
  { header: "Employee Email", get: (l) => l.employeeEmail },
  { header: "Leave Type", get: (l) => l.leaveType },
  { header: "Half Day", get: (l) => l.halfDayPeriod || "" },
  { header: "Start Date", get: (l) => l.startDate },
  { header: "End Date", get: (l) => l.endDate },
  { header: "Days", get: (l) => l.days },
  { header: "Reason", get: (l) => l.reason },
  { header: "Status", get: (l) => l.status },
  { header: "Applied On", get: (l) => l.appliedOn },
  { header: "Reviewed By", get: (l) => l.reviewedBy },
  { header: "Reviewed On", get: (l) => l.reviewedOn },
  { header: "Reviewer Comments", get: (l) => l.reviewerComments },
];
