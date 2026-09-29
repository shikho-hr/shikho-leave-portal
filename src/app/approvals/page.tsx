"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import CommentThread from "@/components/CommentThread";
import InternalNoteThread from "@/components/InternalNoteThread";
import Toast from "@/components/Toast";
import CompOffApprovalQueue from "@/components/CompOffApprovalQueue";
import { formatDate, formatDateRange, isResolvedLeaveStatus } from "@/lib/leave-calculator";

interface PendingLeave {
  id: string;
  employeeName: string;
  employeeEmail: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  halfDayPeriod?: "first_half" | "second_half";
  extraWorkStartDate?: string;
  extraWorkEndDate?: string;
  reason: string;
  status: string;
  appliedOn: string;
  reviewedBy?: string;
  reviewedByName?: string;
  rejectedByRole?: "manager" | "admin";
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  manager_approved: "Awaiting HR",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-sunrise/10 text-yellow-700",
  manager_approved: "bg-indigo-50 text-indigo-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-coral/10 text-coral",
};

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
  offsite_attendance: "Off-site Attendance",
  wfh_deployment: "WFH - Deployment",
};

const HALF_DAY_LABELS: Record<string, string> = {
  first_half: "First half",
  second_half: "Second half",
};

const LEAVE_TYPE_OPTIONS = Object.keys(TYPE_LABELS);

// Matches LEAVE_REQUESTS_PAGE_SIZE in src/lib/db.ts (display-only constant —
// db.ts is server-only and can't be imported into a client component).
const HISTORY_PAGE_SIZE = 50;

// Local calendar date as YYYY-MM-DD (toISOString would give the UTC date,
// which is the wrong day for the first hours of the morning in Dhaka).
function todayLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Dates must be picked via the calendar UI, not typed — avoids mm/dd vs
// dd/mm ambiguity from manual keyboard entry. Tab is still allowed through
// for keyboard focus navigation.
const blockManualDateEntry = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Tab") e.preventDefault();
};
const blockDatePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
  e.preventDefault();
};

// Collapsible section header for the HR tab's two status groups — e.g.
// "Manager approved (2)".
function GroupHeader({
  title,
  count,
  open,
  onToggle,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-3 hover:border-gray-300 transition-colors font-semibold text-gray-900"
    >
      <svg
        className={`w-4 h-4 text-gray-400 transition-transform ${
          open ? "rotate-90" : ""
        }`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5l7 7-7 7"
        />
      </svg>
      {title} ({count})
    </button>
  );
}

export default function Approvals() {
  return (
    <Suspense fallback={null}>
      <ApprovalsContent />
    </Suspense>
  );
}

function ApprovalsContent() {
  const { user, status } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"pending" | "hr" | "compoff" | "history">("pending");
  const [compOffCount, setCompOffCount] = useState(0);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pendingLeaves, setPendingLeaves] = useState<PendingLeave[]>([]);
  const [hrLeaves, setHrLeaves] = useState<PendingLeave[]>([]);
  const [historyLeaves, setHistoryLeaves] = useState<PendingLeave[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  // Last History query actually sent — lets the tab skip refetching when you
  // switch away and back with nothing changed, and lets an approve/reject
  // mark it stale (null) so the next visit picks up the new status.
  const historyKeyRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "danger";
  } | null>(null);
  // History filters. The default view is today's leave requests (leave dates
  // overlapping today); anything else is picked here and only takes effect
  // when Apply Changes is clicked, so nothing fetches while you're editing.
  const [filterLeaveType, setFilterLeaveType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState(todayLocal);
  const [filterDateTo, setFilterDateTo] = useState(todayLocal);
  const [appliedHistoryFilters, setAppliedHistoryFilters] = useState(() => ({
    leaveType: "all",
    status: "all",
    dateFrom: todayLocal(),
    dateTo: todayLocal(),
  }));
  // HR tab groups: both are actionable (HR can approve/reject at either
  // stage) — "Manager approved" starts open since it's usually more urgent;
  // "Awaiting manager" starts collapsed as a soft nudge to let the manager
  // see it first, without blocking HR from acting on it directly.
  const [hrGroupOpen, setHrGroupOpen] = useState({
    approved: true,
    pending: false,
  });

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
    if (user && user.role !== "manager" && user.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [status, user, router]);

  // Deep-link from a "new submission" notification: ?tab=pending jumps
  // straight to the right queue, ?highlight=<leaveId> briefly flashes that
  // specific card so it's obvious which one the notification was about.
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (
      tabParam === "pending" ||
      tabParam === "hr" ||
      tabParam === "compoff" ||
      tabParam === "history"
    ) {
      setTab(tabParam);
    }

    const highlight = searchParams.get("highlight");
    if (!highlight) return;
    setHighlightedId(highlight);
    const scrollTimer = setTimeout(() => {
      document
        .getElementById(`leave-${highlight}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    const clearTimer = setTimeout(() => setHighlightedId(null), 3000);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [searchParams]);

  const fetchPending = () =>
    fetch("/api/leaves?view=pending")
      .then((r) => r.json())
      .then((data) => setPendingLeaves(Array.isArray(data) ? data : []));

  // History — every request this manager/HR can see, at any stage, so
  // approved/rejected requests don't just disappear once actioned. Filtered
  // and paginated server-side (50/page) rather than pulling the whole table.
  const historyQuery = () => {
    const params = new URLSearchParams({
      view: "all",
      page: String(historyPage),
    });
    const f = appliedHistoryFilters;
    if (f.leaveType !== "all") params.set("leaveType", f.leaveType);
    if (f.status !== "all") params.set("status", f.status);
    if (f.dateFrom) params.set("dateFrom", f.dateFrom);
    if (f.dateTo) params.set("dateTo", f.dateTo);
    return params.toString();
  };

  const fetchHistory = () => {
    const query = historyQuery();
    historyKeyRef.current = query;
    setHistoryLoading(true);
    return fetch(`/api/leaves?${query}`)
      .then((r) => r.json())
      .then((data) => {
        setHistoryLeaves(Array.isArray(data.rows) ? data.rows : []);
        setHistoryTotal(typeof data.total === "number" ? data.total : 0);
      })
      .finally(() => setHistoryLoading(false));
  };

  // Loads the History tab the first time it's opened (not on page load), and
  // again only when Apply Changes / the page actually changes the query.
  useEffect(() => {
    if (!user || tab !== "history") return;
    if (historyKeyRef.current === historyQuery()) return;
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tab, appliedHistoryFilters, historyPage]);

  const handleApplyHistoryFilters = () => {
    setAppliedHistoryFilters({
      leaveType: filterLeaveType,
      status: filterStatus,
      dateFrom: filterDateFrom,
      dateTo: filterDateTo,
    });
    setHistoryPage(1);
  };

  const fetchHr = () =>
    fetch("/api/leaves?view=hr")
      .then((r) => r.json())
      .then((data) => setHrLeaves(Array.isArray(data) ? data : []));

  const fetchLeaves = () => {
    const fetches: Promise<void>[] = [fetchPending()];
    if (isAdmin) fetches.push(fetchHr());
    Promise.all(fetches).then(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    fetchLeaves();
    // No polling — this page otherwise only fetches once on load, so a
    // request submitted or actioned by someone else while you're sitting on
    // this page won't show up until the Refresh button is clicked (Neon
    // usage-limit fix: this used to hit the database every 30s).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Scoped to whichever tab is showing, not the whole page — no point
  // re-fetching all three leave views plus the comp-off queue when you're
  // only looking at one of them.
  const [refreshKey, setRefreshKey] = useState(0);
  const handleRefresh = () => {
    if (tab === "pending") fetchPending();
    else if (tab === "hr" && isAdmin) fetchHr();
    else if (tab === "history") fetchHistory();
    else if (tab === "compoff") setRefreshKey((k) => k + 1);
  };

  const handleAction = async (
    leaveId: string,
    action: "approved" | "rejected"
  ) => {
    if (action === "rejected" && !comments[leaveId]?.trim()) {
      setErrors((e) => ({
        ...e,
        [leaveId]: "A comment is required when rejecting a leave request.",
      }));
      return;
    }

    setErrors((e) => {
      const next = { ...e };
      delete next[leaveId];
      return next;
    });
    setActionId(leaveId);
    try {
      const res = await fetch(`/api/leaves/${leaveId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: action,
          comments: comments[leaveId] || "",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPendingLeaves((prev) => prev.filter((l) => l.id !== leaveId));
        setHrLeaves((prev) => prev.filter((l) => l.id !== leaveId));
        setComments((c) => {
          const next = { ...c };
          delete next[leaveId];
          return next;
        });
        // Mark History stale so the just-actioned request shows its new
        // status there the next time that tab is opened, instead of
        // refetching a tab that isn't even on screen.
        historyKeyRef.current = null;
        // Tell the Navbar's pending-count badge to refresh immediately —
        // it otherwise only fetches once on mount and has no other way to
        // know this action just happened.
        window.dispatchEvent(new Event("leave-request-updated"));
        setToast({
          message:
            action === "approved"
              ? "Leave request approved"
              : "Leave request rejected",
          type: action === "approved" ? "success" : "danger",
        });
      } else {
        setErrors((e) => ({
          ...e,
          [leaveId]: data.error || "Failed to update leave",
        }));
        setToast({
          message: data.error || "Failed to update leave request",
          type: "danger",
        });
      }
    } catch {
      setErrors((e) => ({
        ...e,
        [leaveId]: "Network error. Please try again.",
      }));
      setToast({
        message: "Network error — leave request not updated",
        type: "danger",
      });
    } finally {
      setActionId(null);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  // Actionable (manager_approved) cards float above the read-only
  // "Awaiting manager" ones — appliedOn order still applies within each
  // group, but HR shouldn't have to scroll past pending ones to find what
  // they can actually act on.
  const sortedHrLeaves = [...hrLeaves].sort((a, b) => {
    const rank = (l: PendingLeave) => (l.status === "manager_approved" ? 0 : 1);
    return rank(a) - rank(b);
  });
  // The HR tab renders these as two separate collapsible groups rather than
  // one flat list — appliedOn order (newest first) is preserved within each
  // since sortedHrLeaves is already ordered that way.
  const hrApprovedLeaves = sortedHrLeaves.filter(
    (l) => l.status === "manager_approved"
  );
  const hrPendingLeaves = sortedHrLeaves.filter((l) => l.status === "pending");

  const currentLeaves =
    tab === "pending"
      ? pendingLeaves
      : tab === "hr"
      ? sortedHrLeaves
      : historyLeaves;
  const approveLabel = tab === "hr" ? "Approve (Final)" : "Approve";
  // HR can act on any request as soon as it's submitted — no longer gated
  // on the manager stage — so every request in the HR-visible list counts
  // toward the tab badge.
  const hrActionableCount = hrLeaves.length;

  // History is already filtered and paged by the database (see
  // historyQuery), so there's nothing left to filter client-side.
  const filteredLeaves = currentLeaves;
  const historyTotalPages = Math.max(
    1,
    Math.ceil(historyTotal / HISTORY_PAGE_SIZE)
  );

  // Shared card renderer — used for the flat Manager Approval/History lists
  // and for both grouped lists on the HR tab.
  const renderCard = (leave: PendingLeave) => (
    <div
      key={leave.id}
      id={`leave-${leave.id}`}
      className={`bg-white rounded-2xl border p-5 shadow-sm transition-colors duration-700 ${
        highlightedId === leave.id
          ? "border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-300"
          : "border-gray-100"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <p className="font-semibold text-gray-900">{leave.employeeName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === "hr" &&
            (leave.status === "manager_approved" ? (
              <span className="text-xs text-indigo-700 bg-indigo-50 px-2 py-1 rounded-lg font-medium">
                Manager approved
              </span>
            ) : (
              <span className="text-xs text-yellow-700 bg-sunrise/10 px-2 py-1 rounded-lg font-medium">
                Awaiting manager
              </span>
            ))}
          <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">
            Applied {formatDate(leave.appliedOn)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-[1fr_1.4fr_0.6fr_2fr] items-center gap-x-6 gap-y-3 text-sm mb-4">
        <div>
          <p className="text-gray-400 text-xs uppercase tracking-wide">
            Type
          </p>
          <p className="font-medium mt-0.5">
            {TYPE_LABELS[leave.leaveType] || leave.leaveType}
            {leave.halfDayPeriod && (
              <span className="block text-xs font-normal text-gray-400">
                {HALF_DAY_LABELS[leave.halfDayPeriod]}
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-xs uppercase tracking-wide">
            Dates
          </p>
          <p className="font-medium mt-0.5">
            {formatDateRange(leave.startDate, leave.endDate)}
            {leave.leaveType === "compensatory" &&
              leave.extraWorkStartDate &&
              leave.extraWorkEndDate && (
                <span className="block text-xs font-normal text-gray-400">
                  Worked: {formatDate(leave.extraWorkStartDate)} –{" "}
                  {formatDate(leave.extraWorkEndDate)}
                </span>
              )}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-xs uppercase tracking-wide">
            Days
          </p>
          <p className="font-medium mt-0.5">{leave.days}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs uppercase tracking-wide">
            Reason
          </p>
          <p className="font-medium mt-0.5">{leave.reason}</p>
        </div>
      </div>

      {/* Comment thread */}
      <CommentThread
        leaveId={leave.id}
        currentUserEmail={user?.email || ""}
        locked={isResolvedLeaveStatus(leave.status)}
      />

      {/* Internal notes — manager/admin only, employee never sees this */}
      <InternalNoteThread
        leaveId={leave.id}
        currentUserEmail={user?.email || ""}
        locked={isResolvedLeaveStatus(leave.status)}
      />

      {tab === "history" ? (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
          <span
            className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              STATUS_COLORS[leave.status] || ""
            }`}
          >
            {STATUS_LABELS[leave.status] || leave.status}
            {leave.status === "rejected" &&
              leave.rejectedByRole &&
              ` (by ${leave.rejectedByRole === "admin" ? "HR" : "Manager"})`}
          </span>
          {leave.reviewedBy && (
            <span className="text-xs text-gray-400">
              Reviewed by {leave.reviewedByName || leave.reviewedBy}
            </span>
          )}
        </div>
      ) : (
        /* Action buttons */
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mt-4 pt-3 border-t border-gray-100">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Add comment (required if rejecting)"
              value={comments[leave.id] || ""}
              onChange={(e) => {
                setComments((c) => ({
                  ...c,
                  [leave.id]: e.target.value,
                }));
                setErrors((err) => {
                  const next = { ...err };
                  delete next[leave.id];
                  return next;
                });
              }}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 bg-gray-50/50"
            />
            {errors[leave.id] && (
              <p className="text-xs text-coral mt-1">{errors[leave.id]}</p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => handleAction(leave.id, "approved")}
              disabled={actionId === leave.id}
              className="flex-1 sm:flex-none bg-green-600 text-white text-sm font-semibold px-5 py-2 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {approveLabel}
            </button>
            <button
              onClick={() => handleAction(leave.id, "rejected")}
              disabled={actionId === leave.id}
              className="flex-1 sm:flex-none bg-coral text-white text-sm font-semibold px-5 py-2 rounded-xl hover:opacity-90 disabled:opacity-50 transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Leave Requests
          </h1>
          <button
            onClick={handleRefresh}
            className="bg-white border border-gray-200 text-gray-700 text-sm font-semibold px-4 py-2 rounded-xl hover:border-indigo-300 transition-colors shadow-sm"
          >
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setTab("pending")}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === "pending"
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-white text-gray-600 border border-gray-200 hover:border-indigo-300"
            }`}
          >
            Manager Approval
            {pendingLeaves.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 bg-white/20 text-xs font-bold rounded-full">
                {pendingLeaves.length}
              </span>
            )}
          </button>
          {isAdmin && (
            <button
              onClick={() => setTab("hr")}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                tab === "hr"
                  ? "bg-magenta text-white shadow-sm"
                  : "bg-white text-gray-600 border border-gray-200 hover:border-magenta/50"
              }`}
            >
              HR Approval
              {hrActionableCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 bg-white/20 text-xs font-bold rounded-full">
                  {hrActionableCount}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => setTab("compoff")}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === "compoff"
                ? "bg-sunrise text-white shadow-sm"
                : "bg-white text-gray-600 border border-gray-200 hover:border-sunrise/60"
            }`}
          >
            Comp Off Approval
            {compOffCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 bg-white/20 text-xs font-bold rounded-full">
                {compOffCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("history")}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === "history"
                ? "bg-gray-800 text-white shadow-sm"
                : "bg-white text-gray-600 border border-gray-200 hover:border-gray-400"
            }`}
          >
            History
          </button>
        </div>

        {tab === "hr" && (
          <p className="text-sm text-gray-500 mb-4">
            Every leave request appears here as soon as it's submitted, so
            you can follow along or leave an HR-only note early. You can
            approve or reject once the manager has reviewed it.
          </p>
        )}

        {/* Filters — History only; Manager/HR Approval are queues, not
            something worth filtering down */}
        {tab === "history" && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
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
          <div className="flex flex-wrap items-center gap-2">
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
          <button
            onClick={handleApplyHistoryFilters}
            className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Apply Changes
          </button>
        </div>
        )}

        {tab === "compoff" ? (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Additional work days your team has recorded. Accepting one adds
              it to their Compensatory Off balance; rejecting adds nothing.
            </p>
            <CompOffApprovalQueue
              onCountChange={setCompOffCount}
              onToast={(message, type) => setToast({ message, type })}
              refreshKey={refreshKey}
            />
          </>
        ) : tab === "history" && historyLoading ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400 shadow-sm">
            Loading...
          </div>
        ) : filteredLeaves.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400 shadow-sm">
            {tab === "pending"
              ? "No pending leave requests"
              : tab === "hr"
              ? "No requests awaiting HR approval"
              : "No leave requests match these filters"}
          </div>
        ) : tab === "hr" ? (
          <div className="space-y-4">
            {hrApprovedLeaves.length > 0 && (
              <div>
                <GroupHeader
                  title="Manager approved"
                  count={hrApprovedLeaves.length}
                  open={hrGroupOpen.approved}
                  onToggle={() =>
                    setHrGroupOpen((s) => ({ ...s, approved: !s.approved }))
                  }
                />
                {hrGroupOpen.approved && (
                  <div className="space-y-4 mt-4">
                    {hrApprovedLeaves.map(renderCard)}
                  </div>
                )}
              </div>
            )}
            {hrPendingLeaves.length > 0 && (
              <div>
                <GroupHeader
                  title="Awaiting manager"
                  count={hrPendingLeaves.length}
                  open={hrGroupOpen.pending}
                  onToggle={() =>
                    setHrGroupOpen((s) => ({ ...s, pending: !s.pending }))
                  }
                />
                {hrGroupOpen.pending && (
                  <div className="space-y-4 mt-4">
                    {hrPendingLeaves.map(renderCard)}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">{filteredLeaves.map(renderCard)}</div>
        )}

        {tab === "history" && historyTotal > HISTORY_PAGE_SIZE && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-gray-500">
              Showing {(historyPage - 1) * HISTORY_PAGE_SIZE + 1}–
              {Math.min(historyPage * HISTORY_PAGE_SIZE, historyTotal)} of{" "}
              {historyTotal.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                disabled={historyPage <= 1 || historyLoading}
                className="bg-white border border-gray-200 text-gray-700 font-semibold px-3 py-1.5 rounded-xl hover:border-indigo-300 disabled:opacity-50 transition-colors shadow-sm"
              >
                Previous
              </button>
              <span className="text-gray-500">
                Page {historyPage} of {historyTotalPages}
              </span>
              <button
                onClick={() =>
                  setHistoryPage((p) => Math.min(historyTotalPages, p + 1))
                }
                disabled={historyPage >= historyTotalPages || historyLoading}
                className="bg-white border border-gray-200 text-gray-700 font-semibold px-3 py-1.5 rounded-xl hover:border-indigo-300 disabled:opacity-50 transition-colors shadow-sm"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
