"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/leave-calculator";

// The employee's own Compensatory Off balance: what's banked, what's still
// awaiting a decision, and the form to record another additional work day.
// Opened from the Compensatory Off card on the dashboard.
//
// Shares the LeavePopup shell (backdrop, Escape, stopPropagation panel) so
// both modals in the app look and behave the same.

interface Credit {
  id: string;
  workDate: string;
  days: number;
  reason: string;
  status: "pending" | "accepted" | "rejected";
  consumedDays: number;
  remaining: number;
}

interface Summary {
  accepted: number;
  consumed: number;
  remaining: number;
  pending: number;
}

// Dates must be picked from the calendar, not typed — same reasoning as the
// apply form (mm/dd vs dd/mm ambiguity).
const blockManualDateEntry = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Tab") e.preventDefault();
};
const blockDatePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
  e.preventDefault();
};

export default function CompOffPopup({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  // Fired after a successful record so the dashboard can refresh its card.
  onChanged?: () => void;
}) {
  const [credits, setCredits] = useState<Credit[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [recording, setRecording] = useState(false);
  const [workDate, setWorkDate] = useState("");
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(() => {
    fetch("/api/comp-off")
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          setCredits(data.credits || []);
          setSummary(data.summary || null);
        } else {
          setError(data.error || "Could not load your Compensatory Off");
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load your Compensatory Off");
        setLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    setFormError("");
    if (!workDate) {
      setFormError("Please pick the date you worked.");
      return;
    }
    if (!reason.trim()) {
      setFormError("Please say what you worked on.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/comp-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workDate, days: Number(days), reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Could not record the work day");
        return;
      }
      setSuccess("Sent to your manager for approval.");
      setRecording(false);
      setWorkDate("");
      setDays("1");
      setReason("");
      load();
      onChanged?.();
    } catch {
      setFormError("Network error — the work day was not recorded.");
    } finally {
      setSubmitting(false);
    }
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          width: "clamp(340px, 44vw, 900px)",
          height: "clamp(320px, 52vh, 680px)",
        }}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100 flex-none">
          <h2 className="font-semibold text-gray-900">
            Compensatory Off
            {summary && (
              <span className="ml-2 text-sm font-medium text-gray-500">
                {summary.remaining} day(s) remaining
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3">
            {/* Lives in the header (user's choice) so it's reachable
                without scrolling past a long balance table. Hidden while
                the form is open — the form carries its own Cancel. */}
            {!loading && !error && !recording && (
              <button
                onClick={() => {
                  setRecording(true);
                  setSuccess("");
                }}
                className="bg-indigo-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl hover:bg-indigo-700 whitespace-nowrap"
              >
                + Add Extra Work day
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-700 text-xl leading-none w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-50"
            >
              &times;
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : error ? (
            <p className="text-sm text-coral">{error}</p>
          ) : (
            <>
              {success && (
                <p className="mb-3 text-sm font-medium text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                  {success}
                </p>
              )}

              {credits.length === 0 ? (
                <p className="text-sm text-gray-400">
                  You have no additional work days recorded yet. Use Record
                  Additional Work Day above and your manager will be asked to
                  approve it.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-indigo-50/50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-indigo-900/70 whitespace-nowrap">
                        Additional Work Date
                      </th>
                      <th className="text-left px-3 py-2 font-semibold text-indigo-900/70">
                        Reason
                      </th>
                      <th className="text-center px-3 py-2 font-semibold text-indigo-900/70">
                        Day(s)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {credits.map((c) => (
                      <tr key={c.id}>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                          {formatDate(c.workDate)}
                          {c.status === "pending" && (
                            <span className="block text-xs text-yellow-700">
                              Awaiting approval
                            </span>
                          )}
                          {c.status === "accepted" && c.remaining === 0 && (
                            <span className="block text-xs text-gray-400">
                              Fully used
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{c.reason}</td>
                        <td className="px-3 py-2 text-center font-semibold text-gray-900">
                          {c.status === "accepted" ? c.remaining : c.days}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {recording ? (
                <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
                  <div className="flex flex-wrap gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Additional Work Date
                      </label>
                      <input
                        type="date"
                        value={workDate}
                        max={today}
                        onChange={(e) => setWorkDate(e.target.value)}
                        onKeyDown={blockManualDateEntry}
                        onPaste={blockDatePaste}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Day(s)
                      </label>
                      <select
                        value={days}
                        onChange={(e) => setDays(e.target.value)}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                      >
                        <option value="1">Full day (1)</option>
                        <option value="0.5">Half day (0.5)</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Reason
                    </label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      placeholder="What did you work on?"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
                    />
                  </div>
                  {formError && (
                    <p className="text-sm text-coral font-medium">{formError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={submit}
                      disabled={submitting}
                      className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {submitting ? "Sending..." : "Send for approval"}
                    </button>
                    <button
                      onClick={() => {
                        setRecording(false);
                        setFormError("");
                      }}
                      className="text-sm font-medium text-gray-500 px-3 py-2 rounded-xl hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
