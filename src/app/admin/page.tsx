"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import { formatDate } from "@/lib/leave-calculator";

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

export default function AdminDashboard() {
  const { user, status } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<"balances" | "requests">("balances");
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
  const [syncResult, setSyncResult] = useState<{
    employeesSynced: number;
    holidaysSynced: number;
    openingBalancesSynced: number;
    errors: string[];
  } | null>(null);
  const [changingTypeId, setChangingTypeId] = useState<string | null>(null);
  const [typeChangeError, setTypeChangeError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
    if (user && user.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [status, user, router]);

  const fetchAdminData = () => {
    Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch("/api/leaves?view=all").then((r) => r.json()),
    ]).then(([emps, lvs]) => {
      setEmployees(Array.isArray(emps) ? emps : []);
      setAllLeaves(Array.isArray(lvs) ? lvs : []);
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
    if (user && user.role === "admin") fetchAdminData();
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
          holidaysSynced: data.holidaysSynced,
          openingBalancesSynced: data.openingBalancesSynced,
          errors: data.errors || [],
        });
        fetchAdminData();
      } else {
        setSyncResult({
          employeesSynced: 0,
          holidaysSynced: 0,
          openingBalancesSynced: 0,
          errors: [data.error || "Sync failed"],
        });
      }
    } catch {
      setSyncResult({
        employeesSynced: 0,
        holidaysSynced: 0,
        openingBalancesSynced: 0,
        errors: ["Network error during sync"],
      });
    } finally {
      setSyncing(false);
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
          e.email.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) =>
      a.status === b.status ? 0 : a.status === "inactive" ? 1 : -1
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
          <h1 className="text-2xl font-bold text-gray-900">
            Admin Dashboard
          </h1>
          <div className="flex items-center gap-2">
            <a
              href="/api/admin/export?format=csv"
              className="bg-white border border-gray-200 text-gray-700 text-sm font-semibold px-4 py-2 rounded-xl hover:border-indigo-300 transition-colors shadow-sm"
            >
              Export CSV
            </a>
            <a
              href="/api/admin/export?format=xlsx"
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
          </div>
        </div>

        {syncResult && (
          <div
            className={`mb-6 p-3 rounded-xl text-sm font-medium ${
              syncResult.errors.length > 0
                ? "bg-sunrise/10 text-yellow-700 border border-sunrise/20"
                : "bg-green-50 text-green-700 border border-green-200"
            }`}
          >
            <p>
              Synced {syncResult.employeesSynced} employees,{" "}
              {syncResult.holidaysSynced} holidays, and{" "}
              {syncResult.openingBalancesSynced} opening balances.
              {syncResult.errors.length > 0 && (
                <>
                  {" "}
                  {syncResult.errors.length} rows skipped —{" "}
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
              {employees.length}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm border-l-4 border-l-sunrise">
            <p className="text-sm text-gray-500">Pending Requests</p>
            <p className="text-2xl font-bold text-yellow-700 mt-1">
              {allLeaves.filter((l) => l.status === "pending").length}
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
                }).length
              }
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm border-l-4 border-l-magenta">
            <p className="text-sm text-gray-500">Total Requests</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {allLeaves.length}
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
        </div>

        {/* Filters */}
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
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                aria-label="On or after"
              />
              <span className="text-gray-400 text-sm">to</span>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                aria-label="On or before"
              />
            </div>
          )}
        </div>

        {tab === "requests" && (
          <p className="text-sm text-gray-500 mb-4">
            {filteredLeaves.length} request
            {filteredLeaves.length === 1 ? "" : "s"}
            {filterLeaveType !== "all" &&
              ` under ${TYPE_LABELS[filterLeaveType]}`}
          </p>
        )}

        {/* Balances table */}
        {tab === "balances" && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-indigo-50/50 border-b border-gray-100">
                <tr>
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
                  <tr key={emp.id} className="hover:bg-gray-50/50">
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
                {filteredLeaves.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {l.employeeName}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {TYPE_EDITABLE_STATUSES.includes(l.status) ? (
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
                      {formatDate(l.startDate)} — {formatDate(l.endDate)}
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
                      {l.reviewedBy || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
