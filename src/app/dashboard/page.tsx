"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import CommentThread from "@/components/CommentThread";
import ReasonToggle from "@/components/ReasonToggle";
import {
  formatDate,
  formatDateRange,
  isSingleStageApproval,
} from "@/lib/leave-calculator";
import { EmployeeType, LeaveType } from "@/lib/types";

interface BalanceData {
  balance: {
    entitled: Record<string, number>;
    used: Record<string, number>;
    remaining: Record<string, number>;
  };
  availableTypes: string[];
  employee: {
    name: string;
    designation: string;
    department: string;
    employeeType: EmployeeType;
  };
}

interface Leave {
  id: string;
  leaveType: string;
  extraWorkStartDate?: string;
  extraWorkEndDate?: string;
  rejectedByRole?: "manager" | "admin";
  startDate: string;
  endDate: string;
  days: number;
  daysByYear?: Record<string, number>;
  halfDayPeriod?: "first_half" | "second_half";
  reason: string;
  status: string;
  appliedOn: string;
  reviewerComments: string;
}

const TYPE_LABELS: Record<string, string> = {
  sick: "Sick Leave",
  casual: "Casual Leave",
  annual: "Annual Leave",
  marriage: "Marriage Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  ladies_wfh: "Monthly WFH (Ladies)",
  compassionate: "Compassionate",
  compensatory: "Compensatory",
  wfh: "Work from Home",
  unpaid: "Unpaid Leave",
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

// Tick/cross/dash mark for the LM's Approval / HR's Approval columns.
const APPROVAL_MARKS: Record<string, { symbol: string; className: string }> = {
  approved: { symbol: "✓", className: "text-green-500" },
  rejected: { symbol: "✗", className: "text-coral" },
  pending: { symbol: "–", className: "text-gray-400" },
};

// "pending" also covers "this stage's process already ended before
// reaching HR" (e.g. Manager rejected, or HR never participates for this
// leave type) — there's no separate mark for that, it just reads as a dash.
function getStageMarks(
  status: string,
  rejectedByRole: string | undefined,
  singleStage: boolean
): { lm: string; hr: string } {
  if (singleStage) {
    const lm =
      status === "approved"
        ? "approved"
        : status === "rejected"
        ? "rejected"
        : "pending";
    return { lm, hr: "pending" };
  }
  if (status === "pending") return { lm: "pending", hr: "pending" };
  if (status === "manager_approved") return { lm: "approved", hr: "pending" };
  if (status === "approved") return { lm: "approved", hr: "approved" };
  // rejected — default to "Manager rejected" for any legacy record that
  // predates rejectedByRole (safer than guessing HR rejected something
  // Manager never touched)
  return rejectedByRole === "admin"
    ? { lm: "approved", hr: "rejected" }
    : { lm: "rejected", hr: "pending" };
}

const STAGE_LABELS: Record<string, string> = {
  pending: "Pending",
  manager_approved: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const STAGE_COLORS: Record<string, string> = {
  Pending: "bg-sunrise/10 text-yellow-700",
  Approved: "bg-green-50 text-green-700",
  Rejected: "bg-coral/10 text-coral",
};

const HALF_DAY_LABELS: Record<string, string> = {
  first_half: "First half",
  second_half: "Second half",
};

const CARD_ACCENTS = [
  "border-l-indigo-600",
  "border-l-magenta",
  "border-l-sunrise",
  "border-l-coral",
  "border-l-indigo-400",
  "border-l-green-500",
];

// The Remaining/Taken toggle only applies to these three — Special Leave
// (Marriage, Paternity, etc.) always shows remaining balance regardless.
const GENERAL_LEAVE_TYPES = ["sick", "casual", "annual"];

// Fixed display order for Special Leave cards — filtered down to whichever
// types the employee actually has (already gender-scoped via
// getAvailableLeaveTypes), so this same order naturally yields
// Compassionate/Ladies WFH/Marriage + Maternity on a second row for women,
// and Compassionate/Marriage/Paternity with no second row for men.
const SPECIAL_LEAVE_ORDER = [
  "compassionate",
  "ladies_wfh",
  "marriage",
  "paternity",
  "maternity",
];

// Years to offer in the history dropdown — derived from years the employee
// actually has approved General Leave records in, not a fixed lookback
// window, so it naturally covers however far their history actually goes
// (and never shows an empty year with nothing to find). Current year is
// always included even with zero records yet.
function getYearOptions(leaves: Leave[]): string[] {
  const years = new Set<string>([String(new Date().getFullYear())]);
  for (const l of leaves) {
    if (!GENERAL_LEAVE_TYPES.includes(l.leaveType) || l.status !== "approved") {
      continue;
    }
    if (l.daysByYear) {
      Object.keys(l.daysByYear).forEach((y) => years.add(y));
    } else {
      years.add(l.startDate.slice(0, 4));
      years.add(l.endDate.slice(0, 4));
    }
  }
  return [
    "lifetime",
    ...Array.from(years).sort((a, b) => Number(b) - Number(a)),
  ];
}

// How many of a leave's days fall in a given year — uses the per-year split
// already recorded for requests spanning New Year's when available, since
// that's exactly what daysByYear exists for; older records without it fall
// back to a same-year check against start/end date.
function daysInYear(leave: Leave, year: string): number {
  if (year === "lifetime") return leave.days;
  if (leave.daysByYear && leave.daysByYear[year] !== undefined) {
    return leave.daysByYear[year];
  }
  if (leave.startDate.slice(0, 4) === year || leave.endDate.slice(0, 4) === year) {
    return leave.days;
  }
  return 0;
}

export default function Dashboard() {
  const { user, status } = useAuth();
  const router = useRouter();
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLeaveType, setFilterLeaveType] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [balanceView, setBalanceView] = useState<"remaining" | "taken">(
    "remaining"
  );
  const [historyType, setHistoryType] = useState("all");
  const [historyYear, setHistoryYear] = useState("lifetime");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (user) {
      Promise.all([
        fetch("/api/balance").then((r) => r.json()),
        fetch("/api/leaves?view=my").then((r) => r.json()),
      ]).then(([bal, lvs]) => {
        setBalanceData(bal);
        setLeaves(Array.isArray(lvs) ? lvs : []);
        setLoading(false);
      });
    }
  }, [user]);

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!balanceData) return null;

  const { balance, availableTypes, employee } = balanceData;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-[96rem] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Welcome, {employee.name}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {employee.designation} &middot; {employee.department}
            </p>
          </div>
          <button
            onClick={() => router.push("/apply")}
            className="bg-indigo-600 text-white text-sm font-semibold px-5 py-2.5 rounded-2xl hover:bg-indigo-700 transition-colors shadow-sm"
          >
            + Apply Leave
          </button>
        </div>

        {/* Balance cards */}
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Leave Balance ({new Date().getFullYear()})
        </h2>
        {(() => {
          const excluded = ["wfh", "unpaid", "compensatory"];
          const primaryTypes = ["sick", "casual", "annual"].filter((t) =>
            availableTypes.includes(t)
          );
          const secondaryTypes = availableTypes.filter(
            (t) => !primaryTypes.includes(t) && !excluded.includes(t)
          );
          const orderedSecondaryTypes = [
            ...SPECIAL_LEAVE_ORDER.filter((t) => secondaryTypes.includes(t)),
            ...secondaryTypes.filter((t) => !SPECIAL_LEAVE_ORDER.includes(t)),
          ];
          // Taken tab's Special Leave sits in the narrower General Leave
          // column, so it splits at 3-per-row instead of one long row.
          const specialLeaveRow1 = orderedSecondaryTypes.slice(0, 3);
          const specialLeaveRow2 = orderedSecondaryTypes.slice(3);

          const renderCard = (type: string, i: number, compact = false) => {
            const usedUpThisMonth =
              type === "ladies_wfh" && (balance.remaining[type] ?? 0) === 0;
            const showTaken = balanceView === "taken";
            return (
            <div
              key={type}
              className={`bg-white rounded-2xl border border-gray-100 border-l-4 ${
                CARD_ACCENTS[i % CARD_ACCENTS.length]
              } ${compact ? "w-48 h-28 p-4" : "p-5"} shadow-sm ${
                usedUpThisMonth ? "opacity-50" : ""
              }`}
            >
              <p className="text-sm font-medium text-gray-500 mb-2 whitespace-nowrap">
                {TYPE_LABELS[type] || type}
              </p>
              <p
                className={`font-bold text-gray-900 ${
                  compact ? "text-2xl" : "text-3xl"
                }`}
              >
                {showTaken
                  ? balance.used[type] ?? 0
                  : balance.remaining[type] ?? 0}
              </p>
            </div>
            );
          };

          const yearOptions = getYearOptions(leaves);
          const historyLeaves = leaves
            .filter(
              (l) =>
                (historyType === "all"
                  ? GENERAL_LEAVE_TYPES.includes(l.leaveType)
                  : l.leaveType === historyType) &&
                l.status === "approved" &&
                daysInYear(l, historyYear) > 0
            )
            .sort(
              (a, b) =>
                new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
            );
          const historyTotal = historyLeaves.reduce(
            (sum, l) => sum + daysInYear(l, historyYear),
            0
          );

          return (
            <div className="mb-10">
              <div className="flex flex-wrap items-start justify-between gap-8">
                <div>
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <h3 className="text-lg font-bold text-gray-500">
                      General Leave
                    </h3>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setBalanceView("remaining")}
                        className={`px-4 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
                          balanceView === "remaining"
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "bg-white text-gray-600 border border-gray-200 hover:border-indigo-300"
                        }`}
                      >
                        Remaining
                      </button>
                      <button
                        onClick={() => setBalanceView("taken")}
                        className={`px-4 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
                          balanceView === "taken"
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "bg-white text-gray-600 border border-gray-200 hover:border-indigo-300"
                        }`}
                      >
                        Taken
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {primaryTypes.map((type, i) => renderCard(type, i, true))}
                  </div>

                  {balanceView === "taken" && (
                    <div className="mt-6">
                      <h3 className="text-lg font-bold text-gray-500 mb-3">
                        Special Leave
                      </h3>
                      <div className="flex flex-wrap gap-4">
                        {specialLeaveRow1.map((type, i) => renderCard(type, i, true))}
                      </div>
                      {specialLeaveRow2.length > 0 && (
                        <div className="flex flex-wrap gap-4 mt-4">
                          {specialLeaveRow2.map((type, i) => renderCard(type, i, true))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {balanceView === "remaining" && (
                  <div>
                    <h3 className="text-lg font-bold text-gray-500 mb-3">
                      Special Leave
                    </h3>
                    <div className="flex flex-wrap gap-4">
                      {orderedSecondaryTypes.map((type, i) => renderCard(type, i, true))}
                    </div>
                  </div>
                )}

                {balanceView === "taken" && (
                  <div className="flex-1 min-w-[320px]">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <select
                        value={historyType}
                        onChange={(e) => setHistoryType(e.target.value)}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                      >
                        <option value="all">All Leaves</option>
                        {primaryTypes.map((type) => (
                          <option key={type} value={type}>
                            {TYPE_LABELS[type] || type}
                          </option>
                        ))}
                      </select>
                      <select
                        value={historyYear}
                        onChange={(e) => setHistoryYear(e.target.value)}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                      >
                        {yearOptions.map((year) => (
                          <option key={year} value={year}>
                            {year === "lifetime" ? "Lifetime" : year}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="max-w-xl bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      {historyLeaves.length === 0 ? (
                        <p className="p-6 text-center text-sm text-gray-400">
                          No{" "}
                          {historyType === "all"
                            ? "leaves"
                            : TYPE_LABELS[historyType] || historyType}{" "}
                          taken
                          {historyYear === "lifetime" ? "" : ` in ${historyYear}`}
                        </p>
                      ) : (
                        <>
                          <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50/50 border-b border-gray-100">
                            {historyTotal} day{historyTotal === 1 ? "" : "s"}{" "}
                            taken
                            {historyYear === "lifetime" ? "" : ` in ${historyYear}`}
                          </div>
                          <div
                            className={`grid gap-3 px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 ${
                              historyType === "all"
                                ? "grid-cols-[0.8fr_1.2fr_1fr_0.6fr]"
                                : "grid-cols-[1.4fr_1fr_0.6fr]"
                            }`}
                          >
                            {historyType === "all" && <span>Type</span>}
                            <span>Dates</span>
                            <span>Applied On</span>
                            <span className="text-right">Days</span>
                          </div>
                          <div className="divide-y divide-gray-50">
                            {historyLeaves.map((l) => (
                              <div
                                key={l.id}
                                className={`grid gap-3 items-center px-4 py-3 text-sm ${
                                  historyType === "all"
                                    ? "grid-cols-[0.8fr_1.2fr_1fr_0.6fr]"
                                    : "grid-cols-[1.4fr_1fr_0.6fr]"
                                }`}
                              >
                                {historyType === "all" && (
                                  <span className="text-gray-600">
                                    {TYPE_LABELS[l.leaveType] || l.leaveType}
                                  </span>
                                )}
                                <span className="font-medium">
                                  {formatDateRange(l.startDate, l.endDate)}
                                </span>
                                <span className="text-gray-500">
                                  {formatDate(l.appliedOn)}
                                </span>
                                <span className="text-gray-500 text-right">
                                  {daysInYear(l, historyYear)} day
                                  {daysInYear(l, historyYear) === 1 ? "" : "s"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {balanceView === "remaining" && (
        <>
        {/* Recent requests */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-800">
            My Leave Requests
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterLeaveType}
              onChange={(e) => setFilterLeaveType(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="all">All Leave Types</option>
              {availableTypes.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type] || type}
                </option>
              ))}
            </select>
            <select
              value={filterStage}
              onChange={(e) => setFilterStage(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="all">All Stages</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
            </select>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                onKeyDown={blockManualDateEntry}
                onPaste={blockDatePaste}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                aria-label="Leave dates on or after"
              />
              <span className="text-gray-400 text-sm">to</span>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                onKeyDown={blockManualDateEntry}
                onPaste={blockDatePaste}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                aria-label="Leave dates on or before"
              />
            </div>
          </div>
        </div>

        {(() => {
          const filteredLeaves = leaves.filter((l) => {
            const stage = STAGE_LABELS[l.status] || l.status;
            return (
              (filterLeaveType === "all" || l.leaveType === filterLeaveType) &&
              (filterStage === "all" || stage === filterStage) &&
              (!filterDateFrom || l.endDate >= filterDateFrom) &&
              (!filterDateTo || l.startDate <= filterDateTo)
            );
          });

          return filteredLeaves.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400 shadow-sm">
            {leaves.length === 0
              ? "No leave requests yet"
              : "No leave requests match these filters"}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-indigo-50/50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Dates
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Applied On
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Days
                  </th>
                  <th className="text-center px-4 py-3 font-semibold text-indigo-900/70">
                    LM&apos;s Approval
                  </th>
                  <th className="text-center px-4 py-3 font-semibold text-indigo-900/70">
                    HR&apos;s Approval
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Stage
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredLeaves
                  .sort(
                    (a, b) =>
                      new Date(b.appliedOn).getTime() -
                      new Date(a.appliedOn).getTime()
                  )
                  .map((leave) => {
                    const stage = STAGE_LABELS[leave.status] || leave.status;
                    const singleStage = isSingleStageApproval(
                      employee.employeeType,
                      leave.leaveType as LeaveType
                    );
                    const marks = getStageMarks(
                      leave.status,
                      leave.rejectedByRole,
                      singleStage
                    );
                    return (
                    <Fragment key={leave.id}>
                      <tr className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium">
                          {TYPE_LABELS[leave.leaveType] || leave.leaveType}
                          {leave.halfDayPeriod && (
                            <span className="block text-xs font-normal text-gray-400">
                              {HALF_DAY_LABELS[leave.halfDayPeriod]}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {formatDateRange(leave.startDate, leave.endDate)}
                          {leave.leaveType === "compensatory" &&
                            leave.extraWorkStartDate &&
                            leave.extraWorkEndDate && (
                              <span className="block text-xs font-normal text-gray-400">
                                Worked: {formatDate(leave.extraWorkStartDate)}{" "}
                                – {formatDate(leave.extraWorkEndDate)}
                              </span>
                            )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {formatDate(leave.appliedOn)}
                        </td>
                        <td className="px-4 py-3">{leave.days}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`text-xl font-bold ${APPROVAL_MARKS[marks.lm].className}`}
                          >
                            {APPROVAL_MARKS[marks.lm].symbol}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`text-xl font-bold ${APPROVAL_MARKS[marks.hr].className}`}
                          >
                            {APPROVAL_MARKS[marks.hr].symbol}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              STAGE_COLORS[stage] || ""
                            }`}
                          >
                            {stage}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={7} className="px-4 pb-3">
                          <ReasonToggle reason={leave.reason} />
                          <CommentThread
                            leaveId={leave.id}
                            currentUserEmail={user?.email || ""}
                            hideIfEmpty
                          />
                        </td>
                      </tr>
                    </Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
          );
        })()}
        </>
        )}
      </main>
    </div>
  );
}
