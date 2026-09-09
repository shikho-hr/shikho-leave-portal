"use client";

import { useEffect, useState } from "react";
import CommentThread from "./CommentThread";
import InternalNoteThread from "./InternalNoteThread";
import { useAuth } from "@/lib/AuthContext";
import { formatDateRange } from "@/lib/leave-calculator";

interface LeaveDetail {
  id: string;
  employeeName: string;
  employeeEmail: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
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
  offsite_attendance: "Off-site Attendance",
  wfh_deployment: "WFH - Deployment",
};

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

export default function LeavePopup({
  leaveId,
  currentUserEmail,
  isInternalNote = false,
  onClose,
}: {
  leaveId: string;
  currentUserEmail: string;
  // Whether the notification that opened this popup was about an internal
  // note — expands that thread by default instead of Comments.
  isInternalNote?: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const canSeeInternalNotes = user?.role === "manager" || user?.role === "admin";
  const [leave, setLeave] = useState<LeaveDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/leaves/${leaveId}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok) setLeave(data);
        else setError(data.error || "Could not load this leave request");
        setLoading(false);
      });
  }, [leaveId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          // ~760x400 on a 1920x1080 screen (39.6vw / 37vh), clamped so it
          // stays usable on much smaller or larger viewports.
          width: "clamp(340px, 39.6vw, 900px)",
          height: "clamp(280px, 37vh, 620px)",
        }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-none">
          <h2 className="font-semibold text-gray-900">Leave Request</h2>
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
          ) : error || !leave ? (
            <p className="text-sm text-coral">{error || "Not found"}</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-gray-900">
                  {leave.employeeName}
                </p>
                <span
                  className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    STATUS_COLORS[leave.status] || ""
                  }`}
                >
                  {STATUS_LABELS[leave.status] || leave.status}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm mb-4">
                <div>
                  <p className="text-gray-400 text-xs uppercase tracking-wide">
                    Type
                  </p>
                  <p className="font-medium mt-0.5">
                    {TYPE_LABELS[leave.leaveType] || leave.leaveType}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs uppercase tracking-wide">
                    Dates
                  </p>
                  <p className="font-medium mt-0.5">
                    {formatDateRange(leave.startDate, leave.endDate)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs uppercase tracking-wide">
                    Days
                  </p>
                  <p className="font-medium mt-0.5">{leave.days}</p>
                </div>
              </div>

              {leave.reason && (
                <div className="mb-4">
                  <p className="text-gray-400 text-xs uppercase tracking-wide">
                    Reason
                  </p>
                  <p className="text-sm text-gray-700 mt-0.5">
                    {leave.reason}
                  </p>
                </div>
              )}

              <div className="pt-3 border-t border-gray-100">
                <CommentThread
                  leaveId={leave.id}
                  currentUserEmail={currentUserEmail}
                  initialExpanded={!isInternalNote}
                />
                {canSeeInternalNotes && (
                  <InternalNoteThread
                    leaveId={leave.id}
                    currentUserEmail={currentUserEmail}
                    initialExpanded={isInternalNote}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
