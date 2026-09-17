"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import CompanyCalendarManager from "@/components/CompanyCalendarManager";
import RoleAssigner from "@/components/RoleAssigner";
import ProbationAnnualLeaveAccess from "@/components/ProbationAnnualLeaveAccess";
import { formatDate, formatDateRange } from "@/lib/leave-calculator";

interface EmployeeWithBalance {
  id: string;
  name: string;
  email: string;
  department: string;
  employeeType: string;
  contractType: string;
  joiningDate: string;
  status: string;
  balance: Record<string, number>;
}

interface LeaveRow {
  id: string;
  employeeName: string;
  employeeEmail: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  appliedOn: string;
  reviewedBy: string;
  reviewedByName?: string;
  extraWorkStartDate?: string;
  extraWorkEndDate?: string;
}

const TYPE_LABELS: Record<string, string> = {
  sick: "Sick Leave",
  casual: "Casual Leave",
  annual: "Annual Leave",
  marriage: "Marriage Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  ladies_wfh: "Monthly WFH (Ladies)",
  compassionate: "Compassionate Leave",
  compensatory: "Compensatory Off",
  wfh: "Work from Home",
  unpaid: "Unpaid Leave",
  offsite_attendance: "Off-site Attendance",
  wfh_deployment: "WFH - Deployment",
};

const LEAVE_TYPE_OPTIONS = Object.keys(TYPE_LABELS);
const TYPE_EDITABLE_STATUSES = ["pending", "manager_approved"];

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  "full-time": "Full Time",
  contractual: "Contractual",
  "part-time": "Part Time",
  freelancer: "Freelancer",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-sunrise/10 text-yellow-700",
  manager_approved: "bg-indigo-50 text-indigo-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-coral/10 text-coral",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  manager_approved: "Awaiting HR",
  approved: "Approved",
  rejected: "Rejected",
};

// Dates must be picked via the calendar UI, not typed — avoids mm/dd vs
// dd/mm ambiguity from manual keyboard entry. Tab is still allowed through
// for keyboard focus navigation.
const blockManualDateEntry = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Tab") e.preventDefault();
};
const blockDatePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
  e.preventDefault();
};

// Used for the Employee Balances tab's "Last updated" label next to the
// admin-only Refresh button.
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function AdminDashboard() {
  const { user, status } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<
    "balances" | "requests" | "calendar" | "roles" | "probationAL"
  >("balances");
  const [employees, setEmployees] = useState<EmployeeWithBalance[]>([]);
  const [allLeaves, setAllLeaves] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterLeaveType, setFilterLeaveType] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterDept, setFilterDept] = useState("all");
  const [filterEmpStatus, setFilterEmpStatus] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [showSyncErrors, setShowSyncErrors] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<{
    rowsWritten?: number;
    error?: string;
  } | null>(null);
  const [syncResult, setSyncResult] = useState<{
    employeesSynced: number;
    openingBalancesSynced: number;
    errors: string[];
  } | null>(null);
  const [changingTypeId, setChangingTypeId] = useState<string | null>(null);
  const [typeChangeError, setTypeChangeError] = useState("");
  // Admin only — when the employees fetch served balances from the cache
  // (see /api/employees' X-Cache-Computed-At header), this is when that
  // cache was last computed. Null for managers, who always get live data.
  const [balancesUpdatedAt, setBalancesUpdatedAt] = useState<string | null>(
    null
  );
  const [refreshingBalances, setRefreshingBalances] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
    if (user && user.role !== "admin" && user.role !== "manager") {
      router.replace("/dashboard");
    }
  }, [status, user, router]);

  const fetchAdminData = () => {
    return Promise.all([
      fetch("/api/employees"),
      fetch("/api/leaves?view=all").then((r) => r.json()),
    ]).then(async ([empsRes, lvs]) => {
      const emps = await empsRes.json();
      setEmployees(Array.isArray(emps) ? emps : []);
      setAllLeaves(Array.isArray(lvs) ? lvs : []);
      setBalancesUpdatedAt(empsRes.headers.get("X-Cache-Computed-At"));
      setLoading(false);
    });
  };

  const handleTypeChange = async (leaveId: string, leaveType: string) => {
    setChangingTypeId(leaveId);
    setTypeChangeError("");
    try {
      const res = await fetch(`/api/admin/leaves/${leaveId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveType }),
      });
      const data = await res.json();
      if (res.ok) {
        setAllLeaves((prev) =>
          prev.map((l) => (l.id === leaveId ? { ...l, leaveType } : l))
        );
      } else {
        setTypeChangeError(data.error || "Failed to change leave type");
      }
    } catch {
      setTypeChangeError("Network error while changing leave type");
    } finally {
      setChangingTypeId(null);
    }
  };

  useEffect(() => {
    if (user && (user.role === "admin" || user.role === "manager"))
      fetchAdminData();
  }, [user]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setShowSyncErrors(false);
    try {
      const res = await fetch("/api/admin/sync-roster", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult({
          employeesSynced: data.employeesSynced,
          openingBalancesSynced: data.openingBalancesSynced,
          errors: data.errors || [],
        });
        fetchAdminData();
      } else {
        setSyncResult({
          employeesSynced: 0,
          openingBalancesSynced: 0,
          errors: [data.error || "Sync failed"],
        });
      }
    } catch {
      setSyncResult({
        employeesSynced: 0,
        openingBalancesSynced: 0,
        errors: ["Network error during sync"],
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleBackup = async () => {
    setBackingUp(true);
    setBackupResult(null);
    try {
      const res = await fetch("/api/admin/backup-leaves", { method: "POST" });
      const data = await res.json();
      setBackupResult(
        res.ok
          ? { rowsWritten: data.rowsWritten }
          : { error: data.error || "Backup failed" }
      );
    } catch {
      setBackupResult({ error: "Network error during backup" });
    } finally {
      setBackingUp(false);
    }
  };

  const handleRefreshBalances = async () => {
    setRefreshingBalances(true);
    try {
      const res = await fetch("/api/admin/employee-balances-cache", {
        method: "POST",
      });
      if (res.ok) await fetchAdminData();
    } catch {
      // Refresh failed silently — the existing cached balances stay
      // displayed and the user can just click Refresh again.
    } finally {
      setRefreshingBalances(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const departments = [
    ...new Set(employees.map((e) => e.department).filter(Boolean)),
  ];

  const filteredEmployees = employees
    .filter(
      (e) =>
        (filterDept === "all" || e.department === filterDept) &&
        (filterEmpStatus === "all" || e.status === filterEmpStatus) &&
        (e.name.toLowerCase().includes(search.toLowerCase()) ||
          e.email.toLowerCase().includes(search.toLowerCase()) ||
          e.id.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) =>
      a.status === b.status ? 0 : a.status === "inactive" ? 1 : -1
    );

  // Mirrors filteredLeaves's own predicate as query params, so Export
  // CSV/XLSX always matches what the All Requests table currently shows
  // instead of silently dumping every request regardless of filters.
  const exportParams = new URLSearchParams();
  if (filterStatus !== "all") exportParams.set("status", filterStatus);
  if (filterLeaveType !== "all") exportParams.set("leaveType", filterLeaveType);
  if (filterDateFrom) exportParams.set("dateFrom", filterDateFrom);
  if (filterDateTo) exportParams.set("dateTo", filterDateTo);
  if (search.trim()) exportParams.set("search", search.trim());
  const exportQuery = exportParams.toString() ? `&${exportParams.toString()}` : "";

  // Looks up each row's employee ID for the All Requests table, same
  // source/placeholder rule as the Employee Balances table's ID column.
  const employeeIdByEmail = new Map(
    employees.map((e) => [e.email.toLowerCase(), e.id])
  );

  const filteredLeaves = allLeaves
    .filter(
      (l) =>
        (filterStatus === "all" || l.status === filterStatus) &&
        (filterLeaveType === "all" || l.leaveType === filterLeaveType) &&
        (!filterDateFrom || l.endDate >= filterDateFrom) &&
        (!filterDateTo || l.startDate <= filterDateTo) &&
        (l.employeeName.toLowerCase().includes(search.toLowerCase()) ||
          l.employeeEmail.toLowerCase().includes(search.toLowerCase()))
    )
    .sort(
      (a, b) =>
        new Date(b.appliedOn).getTime() - new Date(a.appliedOn).getTime()
    );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Team Details</h1>
          {user?.role === "admin" && (
            <div className="flex items-center gap-2">
              <a
                href={`/api/admin/export?format=csv${exportQuery}`}
                className="bg-white border border-gray-200 text-gray-700 text-sm font-semibold px-4 py-2 rounded-xl hover:border-indigo-300 transition-colors shadow-sm"
              >
                Export CSV
              </a>
              <a
                href={`/api/admin/export?format=xlsx${exportQuery}`}
                className="bg-white border border-gray-200 text-gray-700 text-sm font-semibold px-4 py-2 rounded-xl hover:border-indigo-300 transition-colors shadow-sm"
              >
                Export XLSX
              </a>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {syncing ? "Syncing..." : "Sync from Sheet"}
              </button>
              <button
                onClick={handleBackup}
                disabled={backingUp}
                className="bg-white border border-gray-200 text-gray-700 text-sm font-semibold px-4 py-2 rounded-xl hover:border-indigo-300 disabled:opacity-50 transition-colors shadow-sm"
              >
                {backingUp ? "Backing up..." : "Backup to Sheet"}
              </button>
            </div>
          )}
        </div>

        {backupResult && (
          <div
            className={`mb-6 p-3 rounded-xl text-sm font-medium ${
              backupResult.error
                ? "bg-coral/10 text-coral"
                : "bg-green-50 text-green-700"
            }`}
          >
            {backupResult.error
              ? backupResult.error
              : `Backed up ${(backupResult.rowsWritten ?? 0).toLocaleString()} leave record(s) to the Google Sheet.`}
          </div>
        )}

        {syncResult && (
          <div
            className={`mb-6 p-3 rounded-xl text-sm font-medium ${
              syncResult.errors.length > 0
                ? "bg-sunrise/10 text-yellow-700 border border-sunrise/20"
                : "bg-green-50 text-green-700 border border-green-200"
            }`}
          >
            <p>
              Synced {syncResult.employeesSynced.toLocaleString()} employees and{" "}
              {syncResult.openingBalancesSynced.toLocaleString()} opening balances.
              {syncResult.errors.length > 0 && (
                <>
                  {" "}
                  {syncResult.errors.length.toLocaleString()} rows skipped —{" "}
                  <button
                    type="button"
                    onClick={() => setShowSyncErrors((v) => !v)}
                    className="underline font-semibold hover:opacity-75"
                  >
                    {showSyncErrors ? "hide details" : "show details"}
                  </button>
                </>
              )}
            </p>
            {syncResult.errors.length > 0 && showSyncErrors && (
              <ul className="mt-2 list-disc list-inside max-h-64 overflow-y-auto">
                {syncResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm border-l-4 border-l-indigo-600">
            <p className="text-sm text-gray-500">Total Employees</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {employees.length.toLocaleString()}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm border-l-4 border-l-sunrise">
            <p className="text-sm text-gray-500">Pending Requests</p>
            <p className="text-2xl font-bold text-yellow-700 mt-1">
              {allLeaves.filter((l) => l.status === "pending").length.toLocaleString()}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm border-l-4 border-l-green-500">
            <p className="text-sm text-gray-500">Approved This Month</p>
            <p className="text-2xl font-bold text-green-700 mt-1">
              {
                allLeaves.filter((l) => {
                  const d = new Date(l.appliedOn);
                  const now = new Date();
                  return (
                    l.status === "approved" &&
                    d.getMonth() === now.getMonth() &&
                    d.getFullYear() === now.getFullYear()
                  );
                }).length.toLocaleString()
              }
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm border-l-4 border-l-magenta">
            <p className="text-sm text-gray-500">Total Requests</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {allLeaves.length.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setTab("balances")}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === "balances"
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-white text-gray-600 border border-gray-200 hover:border-indigo-300"
            }`}
          >
            Employee Balances
          </button>
          <button
            onClick={() => setTab("requests")}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === "requests"
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-white text-gray-600 border border-gray-200 hover:border-indigo-300"
            }`}
          >
            All Requests
          </button>
          {user?.role === "admin" && (
            <button
              onClick={() => setTab("calendar")}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                tab === "calendar"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white text-gray-600 border border-gray-200 hover:border-indigo-300"
              }`}
            >
              Company Calendar
            </button>
          )}
          {user?.role === "admin" && (
            <button
              onClick={() => setTab("roles")}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                tab === "roles"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white text-gray-600 border border-gray-200 hover:border-indigo-300"
              }`}
            >
              Role Assigner
            </button>
          )}
          {user?.role === "admin" && (
            <button
              onClick={() => setTab("probationAL")}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                tab === "probationAL"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white text-gray-600 border border-gray-200 hover:border-indigo-300"
              }`}
            >
              Probation AL Access
            </button>
          )}
        </div>

        {/* Balance cache status — admin only, and only balances are cached */}
        {user?.role === "admin" && tab === "balances" && (
          <div className="flex items-center gap-3 mb-4 text-sm">
            <button
              onClick={handleRefreshBalances}
              disabled={refreshingBalances}
              className="bg-white border border-gray-200 text-gray-700 font-semibold px-4 py-2 rounded-xl hover:border-indigo-300 disabled:opacity-50 transition-colors shadow-sm"
            >
              {refreshingBalances ? "Refreshing..." : "Refresh Balances"}
            </button>
            {balancesUpdatedAt && (
              <span className="text-gray-500">
                Last updated {formatRelativeTime(balancesUpdatedAt)}
              </span>
            )}
          </div>
        )}

        {/* Filters */}
        {tab !== "calendar" && tab !== "roles" && tab !== "probationAL" && (
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm w-64 focus:ring-2 focus:ring-indigo-500 bg-white"
          />
          {tab === "balances" && (
            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
          {tab === "balances" && (
            <select
              value={filterEmpStatus}
              onChange={(e) => setFilterEmpStatus(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="all">Active/Inactive</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          )}
          {tab === "requests" && (
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="manager_approved">Awaiting HR</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          )}
          {tab === "requests" && (
            <select
              value={filterLeaveType}
              onChange={(e) => setFilterLeaveType(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="all">All Leave Types</option>
              {LEAVE_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          )}
          {tab === "requests" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                onKeyDown={blockManualDateEntry}
                onPaste={blockDatePaste}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                aria-label="On or after"
              />
              <span className="text-gray-400 text-sm">to</span>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                onKeyDown={blockManualDateEntry}
                onPaste={blockDatePaste}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                aria-label="On or before"
              />
            </div>
          )}
        </div>
        )}

        {tab === "requests" && (
          <p className="text-sm text-gray-500 mb-4">
            {filteredLeaves.length.toLocaleString()} request
            {filteredLeaves.length === 1 ? "" : "s"}
            {filterLeaveType !== "all" &&
              ` under ${TYPE_LABELS[filterLeaveType]}`}
          </p>
        )}

        {tab === "calendar" && <CompanyCalendarManager />}
        {tab === "roles" && user?.role === "admin" && <RoleAssigner />}
        {tab === "probationAL" && user?.role === "admin" && (
          <ProbationAnnualLeaveAccess />
        )}

        {/* Balances table */}
        {tab === "balances" && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-indigo-50/50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    ID
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Dept
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Type
                  </th>
                  <th className="text-center px-3 py-3 font-semibold text-indigo-900/70">
                    SL
                  </th>
                  <th className="text-center px-3 py-3 font-semibold text-indigo-900/70">
                    CL
                  </th>
                  <th className="text-center px-3 py-3 font-semibold text-indigo-900/70">
                    AL
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredEmployees.map((emp) => (
                  <tr key={emp.email} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                      {/* Employees synced before the sheet ID was persisted
                          still carry their email as a placeholder id. */}
                      {emp.id && emp.id !== emp.email ? emp.id : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 flex items-center gap-1.5">
                        {emp.name}
                        {emp.status === "inactive" && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-500">
                            Inactive
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400">{emp.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {emp.department}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600">
                        {CONTRACT_TYPE_LABELS[emp.contractType] ||
                          emp.contractType}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center font-semibold">
                      {emp.balance?.sick ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-center font-semibold">
                      {emp.balance?.casual ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-center font-semibold">
                      {emp.contractType !== "full-time"
                        ? "—"
                        : emp.balance?.annual ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Requests table */}
        {tab === "requests" && typeChangeError && (
          <div className="mb-4 p-3 bg-coral/10 border border-coral/20 text-coral rounded-xl text-sm font-medium">
            {typeChangeError}
          </div>
        )}
        {tab === "requests" && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-indigo-50/50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    ID
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Employee
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Dates
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Days
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Applied
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Reviewed By
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredLeaves.map((l) => {
                  const empId = employeeIdByEmail.get(
                    l.employeeEmail.toLowerCase()
                  );
                  return (
                  <tr key={l.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                      {empId && empId !== l.employeeEmail ? empId : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {l.employeeName}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {TYPE_EDITABLE_STATUSES.includes(l.status) &&
                      user?.role === "admin" ? (
                        <select
                          value={l.leaveType}
                          disabled={changingTypeId === l.id}
                          onChange={(e) =>
                            handleTypeChange(l.id, e.target.value)
                          }
                          className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white disabled:opacity-50"
                        >
                          {LEAVE_TYPE_OPTIONS.map((type) => (
                            <option key={type} value={type}>
                              {TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        TYPE_LABELS[l.leaveType] || l.leaveType
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDateRange(l.startDate, l.endDate)}
                      {l.leaveType === "compensatory" &&
                        l.extraWorkStartDate &&
                        l.extraWorkEndDate && (
                          <span className="block text-xs font-normal text-gray-400">
                            Worked: {formatDate(l.extraWorkStartDate)} –{" "}
                            {formatDate(l.extraWorkEndDate)}
                          </span>
                        )}
                    </td>
                    <td className="px-4 py-3">{l.days}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          STATUS_COLORS[l.status] || ""
                        }`}
                      >
                        {STATUS_LABELS[l.status] || l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(l.appliedOn)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {l.reviewedByName || l.reviewedBy || "—"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
