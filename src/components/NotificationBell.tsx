"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import LeavePopup from "./LeavePopup";
import CompOffPopup from "./CompOffPopup";
import CompOffReviewPopup from "./CompOffReviewPopup";

interface NotificationItem {
  id: string;
  kind: "comment" | "comp_off_request" | "comp_off_decision";
  leaveId?: string;
  creditId?: string;
  leaveType: string;
  employeeName: string;
  commentAuthorName: string;
  commentPreview: string;
  isInternalNote: boolean;
  isSubmission: boolean;
  read: boolean;
  createdAt: string;
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

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationBell({
  currentUserEmail,
}: {
  currentUserEmail: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeNotification, setActiveNotification] =
    useState<NotificationItem | null>(null);
  // Compensatory Off popups: the reviewer's accept/reject for one recorded
  // work day, and the employee's own balance view.
  const [reviewCreditId, setReviewCreditId] = useState<string | null>(null);
  const [showCompOff, setShowCompOff] = useState(false);

  const fetchNotifications = () => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((data) => setNotifications(Array.isArray(data) ? data : []));
  };

  // No polling, and opening the dropdown doesn't fetch either. The count
  // only updates when you navigate to another page (or the page loads) and
  // when you click Refresh inside the dropdown — so the badge never ticks
  // over live while you sit on a page (Neon free-tier data-transfer limit).
  useEffect(() => {
    fetchNotifications();
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const closeIt = () => setOpen(false);
    window.addEventListener("click", closeIt);
    return () => window.removeEventListener("click", closeIt);
  }, [open]);

  // Facebook-style badge: opening the bell clears the count without marking
  // anything read — the badge only counts unread notifications newer than the
  // last time the bell was opened. Kept per browser (localStorage), so a
  // different device shows its own count; the unread dots stay in the list.
  const seenKey = `notifSeenAt:${currentUserEmail}`;
  const [seenAt, setSeenAt] = useState(0);

  useEffect(() => {
    try {
      setSeenAt(Number(localStorage.getItem(seenKey)) || 0);
    } catch {}
  }, [seenKey]);

  // While the dropdown is open everything in it counts as seen, including
  // anything a Refresh brings in.
  useEffect(() => {
    if (!open || notifications.length === 0) return;
    const newest = Math.max(
      ...notifications.map((n) => new Date(n.createdAt).getTime())
    );
    if (newest <= seenAt) return;
    setSeenAt(newest);
    try {
      localStorage.setItem(seenKey, String(newest));
    } catch {}
  }, [open, notifications, seenAt, seenKey]);

  const unreadCount = notifications.filter(
    (n) => !n.read && new Date(n.createdAt).getTime() > seenAt
  ).length;
  const unreadLabel = unreadCount >= 10 ? "9+" : String(unreadCount);

  const handleClickNotification = (n: NotificationItem) => {
    setOpen(false);
    if (!n.read) {
      fetch(`/api/notifications/${n.id}`, { method: "PATCH" }).then(() => {
        setNotifications((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
        );
      });
    }

    // Compensatory Off credits aren't leave requests — they open their own
    // popups: the reviewer's accept/reject for a request, the employee's own
    // balance for the decision that came back.
    if (n.kind === "comp_off_request" && n.creditId) {
      setReviewCreditId(n.creditId);
      return;
    }
    if (n.kind === "comp_off_decision") {
      setShowCompOff(true);
      return;
    }

    // A new submission belongs in the Manager Approval queue, not the
    // picture-in-picture popup — that's reserved for comments/internal
    // notes, where reading the message in place is the point.
    if (n.isSubmission) {
      router.push(`/approvals?tab=pending&highlight=${n.leaveId}`);
      return;
    }
    setActiveNotification(n);
  };

  return (
    <>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="relative text-indigo-100 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          aria-label="Notifications"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-coral text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {unreadLabel}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-gray-900 text-sm">
                Notifications
              </span>
              <button
                onClick={fetchNotifications}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                Refresh
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
              {notifications.length === 0 ? (
                <p className="p-4 text-sm text-gray-400 text-center">
                  No notifications yet
                </p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleClickNotification(n)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                      !n.read ? "bg-indigo-50/40" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-gray-800">
                        <span className="font-semibold">
                          {n.commentAuthorName}
                        </span>{" "}
                        {n.kind === "comp_off_request" ? (
                          <>has recorded an additional work day</>
                        ) : n.kind === "comp_off_decision" ? (
                          <>has reviewed your additional work day</>
                        ) : n.isSubmission ? (
                          <>
                            has submitted a new{" "}
                            {TYPE_LABELS[n.leaveType] || n.leaveType} request
                          </>
                        ) : (
                          <>
                            {n.isInternalNote
                              ? "added an internal note on"
                              : "commented on"}{" "}
                            {n.employeeName}&apos;s{" "}
                            {TYPE_LABELS[n.leaveType] || n.leaveType}
                          </>
                        )}
                        {n.isInternalNote && (
                          <span className="ml-1.5 text-[10px] font-semibold text-yellow-700 bg-sunrise/10 px-1.5 py-0.5 rounded align-middle">
                            HR only
                          </span>
                        )}
                      </p>
                      {!n.read && (
                        <span
                          className={`w-2 h-2 rounded-full flex-none mt-1.5 ${
                            n.isInternalNote ? "bg-sunrise" : "bg-indigo-600"
                          }`}
                        />
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {n.commentPreview}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {relativeTime(n.createdAt)}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {activeNotification?.leaveId && (
        <LeavePopup
          leaveId={activeNotification.leaveId}
          currentUserEmail={currentUserEmail}
          isInternalNote={activeNotification.isInternalNote}
          onClose={() => setActiveNotification(null)}
        />
      )}

      {reviewCreditId && (
        <CompOffReviewPopup
          creditId={reviewCreditId}
          onClose={() => setReviewCreditId(null)}
        />
      )}

      {showCompOff && <CompOffPopup onClose={() => setShowCompOff(false)} />}
    </>
  );
}
