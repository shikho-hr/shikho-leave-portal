"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import {
  HALF_DAY_ELIGIBLE_TYPES,
  calculateLeaveDays,
  REASON_OPTIONAL_TYPES,
  MIN_REASON_LENGTH,
} from "@/lib/leave-calculator";
import { LeaveType } from "@/lib/types";

const TYPE_LABELS: Record<string, string> = {
  sick: "Sick Leave",
  casual: "Casual Leave",
  annual: "Annual Leave",
  marriage: "Marriage Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  ladies_wfh: "Monthly WFH (Ladies)",
  compassionate: "Compassionate Leave",
  compensatory: "Compensatory Off",
  wfh: "Work from Home",
  unpaid: "Unpaid Leave",
  offsite_attendance: "Off-site Attendance",
  wfh_deployment: "WFH - Deployment",
};

type HalfDayChoice = "" | "first_half" | "second_half";

// Dates must be picked via the calendar UI, not typed — avoids mm/dd vs
// dd/mm ambiguity from manual keyboard entry. Tab is still allowed through
// for keyboard focus navigation.
const blockManualDateEntry = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Tab") e.preventDefault();
};
const blockDatePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
  e.preventDefault();
};

export default function ApplyLeave() {
  const { user, status } = useAuth();
  const router = useRouter();
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [holidayDates, setHolidayDates] = useState<string[]>([]);
  const [form, setForm] = useState({
    leaveType: "",
    startDate: "",
    endDate: "",
    reason: "",
    halfDayPeriod: "" as HalfDayChoice,
    extraWorkStartDate: "",
    extraWorkEndDate: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isHalfDayEligible = HALF_DAY_ELIGIBLE_TYPES.includes(
    form.leaveType as (typeof HALF_DAY_ELIGIBLE_TYPES)[number]
  );
  const isReasonRequired = !REASON_OPTIONAL_TYPES.includes(
    form.leaveType as LeaveType
  );
  const isCompensatory = form.leaveType === "compensatory";

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (user) {
      Promise.all([
        fetch("/api/balance").then((r) => r.json()),
        fetch("/api/holidays").then((r) => r.json()),
      ]).then(([balanceData, holidayData]) => {
        setAvailableTypes(balanceData.availableTypes || []);
        setHolidayDates(holidayData.dates || []);
      });
    }
  }, [user]);

  // Reset the half-day choice if the selected leave type no longer supports it
  useEffect(() => {
    if (!isHalfDayEligible && form.halfDayPeriod) {
      setForm((f) => ({ ...f, halfDayPeriod: "" }));
    }
  }, [isHalfDayEligible, form.halfDayPeriod]);

  const effectiveEndDate = form.halfDayPeriod ? form.startDate : form.endDate;
  const computedDays =
    form.startDate && effectiveEndDate
      ? calculateLeaveDays(
          form.startDate,
          effectiveEndDate,
          form.halfDayPeriod || undefined,
          holidayDates
        )
      : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (computedDays <= 0) {
      setError(
        "The selected date(s) fall on a weekend or holiday — there are no leave days to apply for."
      );
      return;
    }

    if (isReasonRequired && form.reason.trim().length < MIN_REASON_LENGTH) {
      setError("Please elaborate the reason properly");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveType: form.leaveType,
          startDate: form.startDate,
          endDate: effectiveEndDate,
          halfDayPeriod: form.halfDayPeriod || undefined,
          extraWorkStartDate: isCompensatory
            ? form.extraWorkStartDate
            : undefined,
          extraWorkEndDate: isCompensatory ? form.extraWorkEndDate : undefined,
          reason: form.reason,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to submit");
      } else {
        setSuccess("Leave request submitted successfully!");
        setForm({
          leaveType: "",
          startDate: "",
          endDate: "",
          reason: "",
          halfDayPeriod: "",
          extraWorkStartDate: "",
          extraWorkEndDate: "",
        });
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "loading") return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Apply for Leave
        </h1>

        {error && (
          <div className="mb-4 p-4 bg-coral/10 border border-coral/20 text-coral rounded-2xl text-sm font-medium">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded-2xl text-sm font-medium">
            {success}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5 shadow-sm"
        >
          {/* Leave type */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Leave Type
            </label>
            <select
              required
              value={form.leaveType}
              onChange={(e) =>
                setForm((f) => ({ ...f, leaveType: e.target.value }))
              }
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50"
            >
              <option value="">Select leave type</option>
              {availableTypes.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type] || type}
                </option>
              ))}
            </select>
          </div>

          {/* Half day choice */}
          {isHalfDayEligible && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Half day
              </label>
              <div className="flex gap-2">
                {(
                  [
                    ["", "Whole day"],
                    ["first_half", "First half"],
                    ["second_half", "Second half"],
                  ] as [HalfDayChoice, string][]
                ).map(([value, label]) => (
                  <button
                    key={value || "whole"}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, halfDayPeriod: value }))
                    }
                    className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                      form.halfDayPeriod === value
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-gray-50/50 text-gray-600 border-gray-200 hover:border-indigo-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                {form.halfDayPeriod ? "Date" : "Start Date"}
              </label>
              <input
                type="date"
                required
                value={form.startDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, startDate: e.target.value }))
                }
                onKeyDown={blockManualDateEntry}
                onPaste={blockDatePaste}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50"
              />
            </div>
            {!form.halfDayPeriod && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  End Date
                </label>
                <input
                  type="date"
                  required
                  value={form.endDate}
                  min={form.startDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, endDate: e.target.value }))
                  }
                  onKeyDown={blockManualDateEntry}
                  onPaste={blockDatePaste}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50"
                />
              </div>
            )}
          </div>

          {/* Compensatory off — the extra day(s) actually worked */}
          {isCompensatory && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Additional Work - Start Date
                </label>
                <input
                  type="date"
                  required
                  value={form.extraWorkStartDate}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      extraWorkStartDate: e.target.value,
                    }))
                  }
                  onKeyDown={blockManualDateEntry}
                  onPaste={blockDatePaste}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Additional Work - End Date
                </label>
                <input
                  type="date"
                  required
                  value={form.extraWorkEndDate}
                  min={form.extraWorkStartDate}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      extraWorkEndDate: e.target.value,
                    }))
                  }
                  onKeyDown={blockManualDateEntry}
                  onPaste={blockDatePaste}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50"
                />
              </div>
              <p className="text-xs text-gray-400 -mt-2 col-span-2">
                The date(s) you worked extra, which this compensatory off is being taken for.
              </p>
            </div>
          )}

          {/* Days */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Number of Days
            </label>
            <input
              type="text"
              readOnly
              value={computedDays}
              className="w-full border border-gray-100 bg-gray-50 rounded-xl px-3 py-2.5 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              Fridays, Saturdays, and holidays don&apos;t count toward leave days.
            </p>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Reason
              {REASON_OPTIONAL_TYPES.includes(form.leaveType as LeaveType) && (
                <span className="text-gray-400 font-normal"> (optional)</span>
              )}
            </label>
            <textarea
              required={isReasonRequired}
              rows={3}
              value={form.reason}
              onChange={(e) =>
                setForm((f) => ({ ...f, reason: e.target.value }))
              }
              placeholder="Provide a reason for your leave request"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-2xl hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm"
          >
            {submitting ? "Submitting..." : "Submit Leave Request"}
          </button>
        </form>
      </main>
    </div>
  );
}
