"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import CommentThread from "@/components/CommentThread";
import InternalNoteThread from "@/components/InternalNoteThread";
import { formatDate } from "@/lib/leave-calculator";

interface PendingLeave {
  id: string;
  employeeName: string;
  employeeEmail: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  halfDayPeriod?: "first_half" | "second_half";
  reason: string;
  status: string;
  appliedOn: string;
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

const HALF_DAY_LABELS: Record<string, string> = {
  first_half: "First half",
  second_half: "Second half",
};

export default function Approvals() {
  const { user, status } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "hr">("pending");
  const [pendingLeaves, setPendingLeaves] = useState<PendingLeave[]>([]);
  const [hrLeaves, setHrLeaves] = useState<PendingLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
    if (user && user.role !== "manager" && user.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [status, user, router]);

  const fetchLeaves = () => {
    const fetches: Promise<void>[] = [
      fetch("/api/leaves?view=pending")
        .then((r) => r.json())
        .then((data) =>
          setPendingLeaves(Array.isArray(data) ? data : [])
        ),
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
    if (user) fetchLeaves();
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
      } else {
        setErrors((e) => ({
          ...e,
          [leaveId]: data.error || "Failed to update leave",
        }));
      }
    } catch {
      setErrors((e) => ({
        ...e,
        [leaveId]: "Network error. Please try again.",
      }));
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

  const currentLeaves = tab === "pending" ? pendingLeaves : hrLeaves;
  const approveLabel = tab === "hr" ? "Approve (Final)" : "Approve";

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Approvals
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
        </div>

        {tab === "hr" && (
          <p className="text-sm text-gray-500 mb-4">
            These non-tele-sales leave requests have been approved by the
            manager and need your final approval.
          </p>
        )}

        {currentLeaves.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400 shadow-sm">
            {tab === "pending"
              ? "No pending leave requests"
              : "No requests awaiting HR approval"}
          </div>
        ) : (
          <div className="space-y-4">
            {currentLeaves.map((leave) => (
              <div
                key={leave.id}
                className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-gray-900">
                      {leave.employeeName}
                    </p>
                    <p className="text-sm text-gray-500">
                      {leave.employeeEmail}
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

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
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
                      {formatDate(leave.startDate)} —{" "}
                      {formatDate(leave.endDate)}
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

                {/* Action buttons */}
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
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
