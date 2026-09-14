"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/leave-calculator";

// The "Comp Off Approval" tab on Team's Leave Requests: every recorded
// additional work day still awaiting a decision from the signed-in
// manager (their reportees') or HR admin (everyone's). The notification
// bell opens the same request as a pop-up; this is where it lives on after
// that pop-up is dismissed. Same card shape and Accept/Reject styling as
// the leave queues on that page.

interface QueueItem {
  id: string;
  employeeEmail: string;
  employeeName: string;
  workDate: string;
  days: number;
  reason: string;
  createdAt: string;
}

export default function CompOffApprovalQueue({
  onCountChange,
  onToast,
}: {
  onCountChange?: (count: number) => void;
  onToast?: (message: string, type: "success" | "danger") => void;
}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [actingId, setActingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    fetch("/api/comp-off?view=queue")
      .then((r) => r.json())
      .then((data) => {
        const list: QueueItem[] = Array.isArray(data) ? data : [];
        setItems(list);
        onCountChange?.(list.length);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [onCountChange]);

  useEffect(() => {
    load();
    // Same 30s cadence as the leave queues and the bell.
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const decide = async (id: string, status: "accepted" | "rejected") => {
    setErrors((e) => ({ ...e, [id]: "" }));
    setActingId(id);
    try {
      const res = await fetch(`/api/comp-off/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, comments: comments[id] || "" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors((e) => ({ ...e, [id]: data.error || "Could not update" }));
        onToast?.(data.error || "Could not update this work day", "danger");
        return;
      }
      setItems((prev) => {
        const next = prev.filter((i) => i.id !== id);
        onCountChange?.(next.length);
        return next;
      });
      onToast?.(
        status === "accepted"
          ? "Accepted — added to their Compensatory Off balance"
          : "Rejected — nothing added to their balance",
        "success"
      );
    } catch {
      onToast?.("Network error — the work day was not updated", "danger");
    } finally {
      setActingId(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-400">Loading...</p>;
  }
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400 shadow-sm">
        No additional work days awaiting approval
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div
          key={item.id}
          id={`compoff-${item.id}`}
          className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="font-semibold text-gray-900">{item.employeeName}</p>
              <p className="text-xs text-gray-400">{item.employeeEmail}</p>
            </div>
            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sunrise/10 text-yellow-700 whitespace-nowrap">
              Awaiting decision
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <p className="text-xs font-medium text-gray-400 mb-0.5">
                Additional Work Date
              </p>
              <p className="text-sm text-gray-900">{formatDate(item.workDate)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-400 mb-0.5">Day(s)</p>
              <p className="text-sm text-gray-900">{item.days}</p>
            </div>
          </div>

          <div className="mb-4">
            <p className="text-xs font-medium text-gray-400 mb-0.5">Reason</p>
            <p className="text-sm text-gray-700">{item.reason}</p>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <input
              type="text"
              value={comments[item.id] || ""}
              onChange={(e) =>
                setComments((c) => ({ ...c, [item.id]: e.target.value }))
              }
              placeholder="Comment (optional)"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3"
            />
            {errors[item.id] && (
              <p className="text-sm text-coral font-medium mb-3">{errors[item.id]}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => decide(item.id, "accepted")}
                disabled={actingId === item.id}
                className="bg-green-600 text-white text-sm font-semibold px-5 py-2 rounded-xl hover:bg-green-700 disabled:opacity-50"
              >
                Accept
              </button>
              <button
                onClick={() => decide(item.id, "rejected")}
                disabled={actingId === item.id}
                className="bg-coral text-white text-sm font-semibold px-5 py-2 rounded-xl hover:opacity-90 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
