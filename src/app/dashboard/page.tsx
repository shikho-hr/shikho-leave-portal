"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import CommentThread from "@/components/CommentThread";
import { formatDate } from "@/lib/leave-calculator";

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
  };
}

interface Leave {
  id: string;
  leaveType: string;
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

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-sunrise/10 text-yellow-700",
  manager_approved: "bg-indigo-50 text-indigo-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-coral/10 text-coral",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  manager_approved: "Awaiting HR",
  approved: "Approved",
  rejected: "Rejected",
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

          const renderCard = (type: string, i: number) => (
            <div
              key={type}
              className={`bg-white rounded-2xl border border-gray-100 border-l-4 ${
                CARD_ACCENTS[i % CARD_ACCENTS.length]
              } p-5 shadow-sm`}
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
                    Days
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-indigo-900/70">
                    Applied
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
                  .map((leave) => (
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
                        </td>
                        <td className="px-4 py-3">{leave.days}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              STATUS_COLORS[leave.status] || ""
                            }`}
                          >
                            {STATUS_LABELS[leave.status] || leave.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {formatDate(leave.appliedOn)}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={5} className="px-4 pb-3">
                          <CommentThread
                            leaveId={leave.id}
                            currentUserEmail={user?.email || ""}
                          />
                        </td>
                      </tr>
                    </Fragment>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
