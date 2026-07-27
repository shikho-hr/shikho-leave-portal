"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import CommentThread from "@/components/CommentThread";
import InternalNoteThread from "@/components/InternalNoteThread";
import Toast from "@/components/Toast";
import { formatDate, formatDateRange } from "@/lib/leave-calculator";

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
};

const HALF_DAY_LABELS: Record<string, string> = {
  first_half: "First half",
  second_half: "Second half",
};

const LEAVE_TYPE_OPTIONS = Object.keys(TYPE_LABELS);

// Dates must be picked via the calendar UI, not typed — avoids mm/dd vs
// dd/mm ambiguity from manual keyboard entry. Tab is still allowed through
// for keyboard focus navigation.
const blockManualDateEntry = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Tab") e.preventDefault();
};
const blockDatePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
  e.preventDefault();
};

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
  const [tab, setTab] = useState<"pending" | "hr" | "history">("pending");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pendingLeaves, setPendingLeaves] = useState<PendingLeave[]>([]);
  const [hrLeaves, setHrLeaves] = useState<PendingLeave[]>([]);
  const [historyLeaves, setHistoryLeaves] = useState<PendingLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "danger";
  } | null>(null);
  const [filterLeaveType, setFilterLeaveType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

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
    if (tabParam === "pending" || tabParam === "hr" || tabParam === "history") {
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
    const clearTimer = setTimeout(() => setHighlightedId(null), 1500);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [searchParams]);

  const fetchLeaves = () => {
    const fetches: Promise<void>[] = [
      fetch("/api/leaves?view=pending")
        .then((r) => r.json())
        .then((data) =>
          setPendingLeaves(Array.isArray(data) ? data : [])
        ),
      // History — every request this manager/HR can see, at any stage, so
      // approved/rejected requests don't just disappear once actioned.
      fetch("/api/leaves?view=all")
        .then((r) => r.json())
        .then((data) => setHistoryLeaves(Array.isArray(data) ? data : [])),
    ];

    if (isAdmin) {
      fetches.push(
        fetch("/api/leaves?view=hr")
          .then((r) => r.json())
          .then((data) => setHrLeaves(Array.isArray(data) ? data : []))
      );
    }

    Promise.all(fetches).then(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    fetchLeaves();
    // Polling, same as the Notification Bell and nav badge — this page
    // otherwise only ever fetches once on load, so a request submitted or
    // actioned by someone else while you're sitting on this page wouldn't
    // show up until a manual refresh.
    const interval = setInterval(fetchLeaves, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
        // Refresh History so the just-actioned request shows its new
        // status there instead of just vanishing from the queue.
        fetch("/api/leaves?view=all")
          .then((r) => r.json())
          .then((d) => setHistoryLeaves(Array.isArray(d) ? d : []));
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

  const currentLeaves =
    tab === "pending" ? pendingLeaves : tab === "hr" ? hrLeaves : historyLeaves;
  const approveLabel = tab === "hr" ? "Approve (Final)" : "Approve";

  const filteredLeaves =
    tab !== "history"
      ? currentLeaves
      : currentLeaves.filter(
          (l) =>
            (filterLeaveType === "all" || l.leaveType === filterLeaveType) &&
            (filterStatus === "all" || l.status === filterStatus) &&
            (!filterDateFrom || l.endDate >= filterDateFrom) &&
            (!filterDateTo || l.startDate <= filterDateTo)
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
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Leave Requests
        </h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-6">
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
              {hrLeaves.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 bg-white/20 text-xs font-bold rounded-full">
                  {hrLeaves.length}
                </span>
              )}
            </button>
          )}
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
            These non-tele-sales leave requests have been approved by the
            manager and need your final approval.
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
        )}

        {filteredLeaves.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400 shadow-sm">
            {currentLeaves.length > 0
              ? "No leave requests match these filters"
              : tab === "pending"
              ? "No pending leave requests"
              : tab === "hr"
              ? "No requests awaiting HR approval"
              : "No leave request activity yet"}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredLeaves.map((leave) => (
              <div
                key={leave.id}
                id={`leave-${leave.id}`}
                className={`bg-white rounded-2xl border p-5 shadow-sm transition-colors duration-700 ${
                  highlightedId === leave.id
                    ? "border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-300"
                    : "border-gray-100"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-gray-900">
                      {leave.employeeName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {tab === "hr" && (
                      <span className="text-xs text-indigo-700 bg-indigo-50 px-2 py-1 rounded-lg font-medium">
                        Manager approved
                      </span>
                    )}
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
                />

                {/* Internal notes — manager/admin only, employee never sees this */}
                <InternalNoteThread
                  leaveId={leave.id}
                  currentUserEmail={user?.email || ""}
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
                        ` (by ${
                          leave.rejectedByRole === "admin" ? "HR" : "Manager"
                        })`}
                    </span>
                    {leave.reviewedBy && (
                      <span className="text-xs text-gray-400">
                        Reviewed by {leave.reviewedByName || leave.reviewedBy}
                      </span>
                    )}
                  </div>
                ) : (
                  /* Action buttons */
                  <div className="flex items-end gap-3 mt-4 pt-3 border-t border-gray-100">
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
                        <p className="text-xs text-coral mt-1">
                          {errors[leave.id]}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleAction(leave.id, "approved")}
                      disabled={actionId === leave.id}
                      className="bg-green-600 text-white text-sm font-semibold px-5 py-2 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {approveLabel}
                    </button>
                    <button
                      onClick={() => handleAction(leave.id, "rejected")}
                      disabled={actionId === leave.id}
                      className="bg-coral text-white text-sm font-semibold px-5 py-2 rounded-xl hover:opacity-90 disabled:opacity-50 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
