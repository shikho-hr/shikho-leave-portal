"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import CommentThread from "@/components/CommentThread";
import { formatDate, isSingleStageApproval } from "@/lib/leave-calculator";
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

export default function Dashboard() {
  const { user, status } = useAuth();
  const router = useRouter();
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);

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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome, {employee.name}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {employee.designation} &middot; {employee.department}
          </p>
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

          const renderCard = (type: string, i: number) => {
            const usedUpThisMonth =
              type === "ladies_wfh" && (balance.remaining[type] ?? 0) === 0;
            return (
            <div
              key={type}
              className={`bg-white rounded-2xl border border-gray-100 border-l-4 ${
                CARD_ACCENTS[i % CARD_ACCENTS.length]
              } p-5 shadow-sm ${usedUpThisMonth ? "opacity-50" : ""}`}
            >
              <p className="text-sm font-medium text-gray-500 mb-2">
                {TYPE_LABELS[type] || type}
              </p>
              <p className="text-3xl font-bold text-gray-900">
                {balance.remaining[type] ?? 0}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {balance.used[type] ?? 0} used of {balance.entitled[type] ?? 0}
              </p>
            </div>
            );
          };

          return (
            <div className="mb-10 space-y-6">
              <div>
                <h3 className="text-lg font-bold text-gray-500 mb-3">
                  General Leave
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {primaryTypes.map((type, i) => renderCard(type, i))}
                </div>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-500 mb-3">
                  Special Leave
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {secondaryTypes.map((type, i) => renderCard(type, i))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Recent requests */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">
            My Leave Requests
          </h2>
          <button
            onClick={() => router.push("/apply")}
            className="bg-indigo-600 text-white text-sm font-semibold px-5 py-2.5 rounded-2xl hover:bg-indigo-700 transition-colors shadow-sm"
          >
            + Apply Leave
          </button>
        </div>

        {leaves.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400 shadow-sm">
            No leave requests yet
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
                {leaves
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
                          {formatDate(leave.startDate)} —{" "}
                          {formatDate(leave.endDate)}
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
                          <CommentThread
                            leaveId={leave.id}
                            currentUserEmail={user?.email || ""}
                          />
                        </td>
                      </tr>
                    </Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
