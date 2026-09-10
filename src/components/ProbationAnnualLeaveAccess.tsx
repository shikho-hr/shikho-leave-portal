"use client";

import { useEffect, useState } from "react";

interface EmployeeRow {
  email: string;
  name: string;
  designation: string;
  department: string;
  contractType: string;
  probationEndDate: string;
  probationAnnualLeaveApproved: boolean;
}

function isOnProbationNow(probationEndDate: string): boolean {
  return !!probationEndDate && new Date(probationEndDate) > new Date();
}

// Admin-granted exception letting one specific full-time employee select
// Annual Leave while still on probation (normally blocked entirely — see
// getAvailableLeaveTypes/validateLeaveRequest in leave-calculator.ts).
// Granting only unlocks the option in their own Apply Leave dropdown; they
// still self-apply and it still goes through the normal manager/HR
// approval — this tab never creates or approves a leave itself.
export default function ProbationAnnualLeaveAccess() {
  const [allEmployees, setAllEmployees] = useState<EmployeeRow[]>([]);
  const [granted, setGranted] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingEmail, setUpdatingEmail] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/employees").then((r) => r.json()),
      fetch("/api/admin/probation-annual-leave").then((r) => r.json()),
    ])
      .then(([all, grantedList]) => {
        setAllEmployees(Array.isArray(all) ? all : []);
        setGranted(Array.isArray(grantedList) ? grantedList : []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const setApproval = async (email: string, approved: boolean) => {
    setUpdatingEmail(email);
    setError("");
    try {
      const res = await fetch(`/api/admin/employees/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probationAnnualLeaveApproved: approved }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setUpdatingEmail(null);
    }
  };

  const query = search.trim().toLowerCase();
  const searching = query.length >= 2;
  const results = searching
    ? allEmployees
        .filter(
          (e) =>
            e.email.toLowerCase().includes(query) ||
            e.name.toLowerCase().includes(query)
        )
        .slice(0, 50)
    : [];

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
        <h3 className="font-semibold text-gray-900 mb-1">Probation AL Access</h3>
        <p className="text-sm text-gray-500 mb-4">
          Grant a specific full-time, on-probation employee permission to select Annual
          Leave in their own Apply Leave form. They still apply themselves and it still
          goes through the normal manager/HR approval — granting only unlocks the option.
          Their balance can go negative once used, since they aren&apos;t entitled to it
          yet.
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
            <ul className="divide-y divide-gray-100">
              {results.map((e) => {
                const eligible =
                  e.contractType === "full-time" && isOnProbationNow(e.probationEndDate);
                return (
                  <li key={e.email} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{e.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {e.email} &middot; {e.designation}
                      </p>
                      {!eligible && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Not eligible — must be full-time and currently on probation.
                        </p>
                      )}
                    </div>
                    {e.probationAnnualLeaveApproved ? (
                      <button
                        onClick={() => setApproval(e.email, false)}
                        disabled={updatingEmail === e.email}
                        className="bg-white border border-gray-200 text-coral text-sm font-semibold px-4 py-2 rounded-xl hover:border-coral/40 disabled:opacity-50 transition-colors shrink-0"
                      >
                        Revoke
                      </button>
                    ) : (
                      <button
                        onClick={() => setApproval(e.email, true)}
                        disabled={!eligible || updatingEmail === e.email}
                        className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shrink-0"
                      >
                        Grant
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Currently granted, still on probation ({granted.length})
            </p>
            <ul className="divide-y divide-gray-100">
              {granted.length === 0 ? (
                <li className="text-sm text-gray-400 py-2">None.</li>
              ) : (
                granted.map((e) => (
                  <li key={e.email} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{e.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {e.email} &middot; probation ends{" "}
                        {new Date(e.probationEndDate).toLocaleDateString("en-US", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <button
                      onClick={() => setApproval(e.email, false)}
                      disabled={updatingEmail === e.email}
                      className="bg-white border border-gray-200 text-coral text-sm font-semibold px-4 py-2 rounded-xl hover:border-coral/40 disabled:opacity-50 transition-colors shrink-0"
                    >
                      Revoke
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
