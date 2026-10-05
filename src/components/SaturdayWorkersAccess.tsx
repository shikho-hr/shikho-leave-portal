"use client";

import { useEffect, useState } from "react";

interface EmployeeRow {
  email: string;
  name: string;
  designation: string;
  department: string;
  status: string;
  // Absent on roster-cache rows written before the column existed -> unmarked.
  worksSaturday?: boolean;
}

// Admin toggle for the few employees who work Saturdays. Everyone starts
// unmarked; this lists every active employee so marking someone is one click.
// For marked employees only Friday is skipped when leave days are counted
// (everyone else skips Friday AND Saturday — see isExcludedDay in
// leave-calculator.ts). It only affects requests applied for from now on;
// existing requests keep their stored day counts. The roster sheet sync never
// touches this flag.
export default function SaturdayWorkersAccess() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [onlyMarked, setOnlyMarked] = useState(false);
  const [updatingEmail, setUpdatingEmail] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = () =>
    fetch("/api/employees")
      .then((r) => r.json())
      .then((all) => setEmployees(Array.isArray(all) ? all : []))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const toggle = async (email: string, worksSaturday: boolean) => {
    setUpdatingEmail(email);
    setError("");
    try {
      const res = await fetch(`/api/admin/employees/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worksSaturday }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setEmployees((prev) =>
        prev.map((e) => (e.email === email ? { ...e, worksSaturday } : e))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setUpdatingEmail(null);
    }
  };

  const active = employees.filter((e) => e.status === "active");
  const markedCount = active.filter((e) => e.worksSaturday).length;
  const query = search.trim().toLowerCase();
  const rows = active
    .filter((e) => !onlyMarked || e.worksSaturday)
    .filter(
      (e) =>
        !query ||
        e.email.toLowerCase().includes(query) ||
        e.name.toLowerCase().includes(query)
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.worksSaturday)) - Number(Boolean(a.worksSaturday)) ||
        a.name.localeCompare(b.name)
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
        <h3 className="font-semibold text-gray-900 mb-1">Saturday Workers</h3>
        <p className="text-sm text-gray-500 mb-4">
          Everyone is unmarked by default. Mark the employees who work on Saturdays — for
          them only Friday is skipped when leave days are counted, so a Saturday counts as a
          normal working day and they can apply for leave on it. This applies to requests
          submitted from now on; existing requests keep their current day counts.
        </p>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            type="text"
            placeholder="Filter by name or email address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm w-full max-w-md focus:ring-2 focus:ring-indigo-500 bg-white"
          />
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyMarked}
              onChange={(e) => setOnlyMarked(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show marked only
          </label>
        </div>

        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          {markedCount} marked &middot; {rows.length} shown
        </p>
        <ul className="divide-y divide-gray-100">
          {rows.length === 0 ? (
            <li className="text-sm text-gray-400 py-2">No matching employees.</li>
          ) : (
            rows.map((e) => (
              <li key={e.email} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{e.name}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {e.email} &middot; {e.designation}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={Boolean(e.worksSaturday)}
                    disabled={updatingEmail === e.email}
                    onChange={(ev) => toggle(e.email, ev.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  Works Saturday
                </label>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
