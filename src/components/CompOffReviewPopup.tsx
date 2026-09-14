"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/leave-calculator";

// A manager's (or HR admin's) view of one recorded additional work day, with
// the Accept / Reject decision that turns it into Compensatory Off balance —
// or doesn't. Opened from the notification bell.

interface CreditDetail {
  id: string;
  employeeEmail: string;
  employeeName: string;
  workDate: string;
  days: number;
  reason: string;
  status: "pending" | "accepted" | "rejected";
  reviewedBy: string;
  reviewerComments: string;
  canDecide: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting decision",
  accepted: "Accepted",
  rejected: "Rejected",
};
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-sunrise/10 text-yellow-700",
  accepted: "bg-green-50 text-green-700",
  rejected: "bg-coral/10 text-coral",
};

export default function CompOffReviewPopup({
  creditId,
  onClose,
  onDecided,
}: {
  creditId: string;
  onClose: () => void;
  onDecided?: () => void;
}) {
  const [credit, setCredit] = useState<CreditDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [comments, setComments] = useState("");
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    fetch(`/api/comp-off/${creditId}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok) setCredit(data);
        else setError(data.error || "Could not load this work day");
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load this work day");
        setLoading(false);
      });
  }, [creditId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const decide = async (status: "accepted" | "rejected") => {
    setActionError("");
    setActing(true);
    try {
      const res = await fetch(`/api/comp-off/${creditId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, comments }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Could not update this work day");
        return;
      }
      setDone(
        status === "accepted"
          ? "Accepted — the day has been added to their Compensatory Off balance."
          : "Rejected — nothing was added to their balance."
      );
      setCredit((c) => (c ? { ...c, status, canDecide: false } : c));
      onDecided?.();
    } catch {
      setActionError("Network error — the work day was not updated.");
    } finally {
      setActing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          width: "clamp(340px, 39.6vw, 780px)",
          height: "clamp(300px, 44vh, 600px)",
        }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-none">
          <h2 className="font-semibold text-gray-900">Additional Work Day</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-700 text-xl leading-none w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-50"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : error ? (
            <p className="text-sm text-coral">{error}</p>
          ) : credit ? (
            <>
              <div className="flex items-center gap-3 mb-4">
                <p className="font-semibold text-gray-900">
                  {credit.employeeName}
                </p>
                <span
                  className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    STATUS_COLORS[credit.status] || ""
                  }`}
                >
                  {STATUS_LABELS[credit.status] || credit.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-0.5">
                    Additional Work Date
                  </p>
                  <p className="text-sm text-gray-900">
                    {formatDate(credit.workDate)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-0.5">
                    Day(s)
                  </p>
                  <p className="text-sm text-gray-900">{credit.days}</p>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-xs font-medium text-gray-400 mb-0.5">
                  Reason
                </p>
                <p className="text-sm text-gray-700">{credit.reason}</p>
              </div>

              {done ? (
                <p className="text-sm font-medium text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                  {done}
                </p>
              ) : credit.canDecide ? (
                <div className="border-t border-gray-100 pt-4">
                  <input
                    type="text"
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    placeholder="Comment"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3"
                  />
                  {actionError && (
                    <p className="text-sm text-coral font-medium mb-3">
                      {actionError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => decide("accepted")}
                      disabled={acting}
                      className="bg-green-600 text-white text-sm font-semibold px-5 py-2 rounded-xl hover:bg-green-700 disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => decide("rejected")}
                      disabled={acting}
                      className="bg-coral text-white text-sm font-semibold px-5 py-2 rounded-xl hover:opacity-90 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ) : credit.status !== "pending" ? (
                <p className="text-sm text-gray-500 border-t border-gray-100 pt-4">
                  This work day was already {STATUS_LABELS[credit.status]?.toLowerCase()}
                  {credit.reviewerComments ? ` — ${credit.reviewerComments}` : "."}
                </p>
              ) : (
                <p className="text-sm text-gray-500 border-t border-gray-100 pt-4">
                  Only {credit.employeeName}&apos;s line manager or HR can decide
                  this.
                </p>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
