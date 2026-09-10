"use client";

import { useEffect, useState } from "react";

interface EmployeeRow {
  email: string;
  name: string;
  designation: string;
  department: string;
  role: "employee" | "manager" | "admin";
  status: "active" | "inactive";
}

const ROLE_LABELS: Record<string, string> = {
  employee: "Employee",
  manager: "Manager",
  admin: "Admin",
};

// Every employee defaults to "Employee" on creation (see
// upsertEmployeesFromSheet in src/lib/db.ts) — this tab is the only place
// that changes it afterward, never the Sheet sync.
export default function RoleAssigner() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingEmail, setUpdatingEmail] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/employees")
      .then((r) => r.json())
      .then((data) => setEmployees(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  const changeRole = async (email: string, role: string) => {
    setUpdatingEmail(email);
    setError("");
    const previous = employees;
    // Optimistic update — reverted below if the request fails.
    setEmployees((prev) =>
      prev.map((e) => (e.email === email ? { ...e, role: role as EmployeeRow["role"] } : e))
    );
    try {
      const res = await fetch(`/api/admin/employees/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update role");
      }
    } catch (err) {
      setEmployees(previous);
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setUpdatingEmail(null);
    }
  };

  const query = search.trim().toLowerCase();
  const searching = query.length >= 2;
  const results = searching
    ? employees
        .filter(
          (e) =>
            e.email.toLowerCase().includes(query) ||
            e.name.toLowerCase().includes(query)
        )
        .slice(0, 50)
    : [];

  const byName = (a: EmployeeRow, b: EmployeeRow) => a.name.localeCompare(b.name);
  // Someone who's left keeps whatever role they had (role isn't reset on
  // deactivation), but they shouldn't clutter the "who currently has this
  // role" overview — they still show up fine via search if needed.
  const admins = employees
    .filter((e) => e.role === "admin" && e.status === "active")
    .sort(byName);
  const managers = employees
    .filter((e) => e.role === "manager" && e.status === "active")
    .sort(byName);

  const renderRow = (e: EmployeeRow) => (
    <li key={e.email} className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{e.name}</p>
        <p className="text-xs text-gray-500 truncate">
          {e.email} &middot; {e.designation}
        </p>
      </div>
      <select
        value={e.role}
        disabled={updatingEmail === e.email}
        onChange={(ev) => changeRole(e.email, ev.target.value)}
        className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white shrink-0 disabled:opacity-50"
      >
        {Object.entries(ROLE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </li>
  );

  if (loading) {
    return <p className="text-sm text-gray-500">Loading employees...</p>;
  }

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm font-medium bg-coral/10 text-coral">
          {error}
        </div>
      )}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <h3 className="font-semibold text-gray-900 mb-1">Role Assigner</h3>
        <p className="text-sm text-gray-500 mb-4">
          Search by email (or name) to find an employee and change their role. Everyone
          starts as &quot;Employee&quot; by default.
        </p>
        <input
          type="text"
          placeholder="Search by email address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm w-full max-w-md focus:ring-2 focus:ring-indigo-500 bg-white mb-4"
        />

        {query.length > 0 && !searching && (
          <p className="text-sm text-gray-400">Keep typing — at least 2 characters.</p>
        )}

        {searching ? (
          <>
            {results.length === 0 && (
              <p className="text-sm text-gray-400">No matching employees.</p>
            )}
            <ul className="divide-y divide-gray-100">{results.map(renderRow)}</ul>
          </>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Admins ({admins.length})
              </p>
              <ul className="divide-y divide-gray-100">
                {admins.length === 0 ? (
                  <li className="text-sm text-gray-400 py-2">None.</li>
                ) : (
                  admins.map(renderRow)
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Managers ({managers.length})
              </p>
              <ul className="divide-y divide-gray-100">
                {managers.length === 0 ? (
                  <li className="text-sm text-gray-400 py-2">None.</li>
                ) : (
                  managers.map(renderRow)
                )}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
