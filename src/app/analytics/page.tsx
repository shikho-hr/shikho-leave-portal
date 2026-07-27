"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import { formatDateRange } from "@/lib/leave-calculator";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface AnalyticsRow {
  date: string;
  employeeEmail: string;
  employeeName: string;
  department: string;
  leaveType: string;
}

interface AnalyticsData {
  weekStart: string;
  days: string[];
  holidays: string[];
  rows: AnalyticsRow[];
}

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
};

// Unpaid leave is deliberately not offered as a filter option; unpaid
// leaves still count toward the "All Leave Types" totals.
const LEAVE_TYPE_OPTIONS = Object.keys(TYPE_LABELS).filter(
  (t) => t !== "unpaid"
);

// Validated 8-hue categorical palette (fixed order — the order itself is
// the colorblind-safety mechanism, never cycled or re-sorted by value).
// A department's slot is assigned once per week from its alphabetical rank
// among departments actually present that week, so a filter that removes
// rows never repaints the departments that remain visible.
const CATEGORICAL_PALETTE = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
];
const OTHER_COLOR = "#898781"; // muted ink — reserved, outside the categorical set
const SINGLE_SERIES_COLOR = "#4f46e5"; // brand indigo, used only when one series is on screen

// Dates must be picked via the calendar UI, not typed — avoids mm/dd vs
// dd/mm ambiguity from manual keyboard entry. Tab is still allowed through
// for keyboard focus navigation.
const blockManualDateEntry = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Tab") e.preventDefault();
};
const blockDatePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
  e.preventDefault();
};

const toSunday = (date: Date) =>
  format(startOfWeek(date, { weekStartsOn: 0 }), "yyyy-MM-dd");

interface ChartDatum {
  date: string;
  weekday: string;
  dayLabel: string;
  count: number;
  isHoliday: boolean;
  byDept: Record<string, number>;
}

interface Series {
  key: string;
  name: string;
  color: string;
  title?: string;
}

// Two-line tick: weekday on top, date underneath; holidays greyed out and
// flagged so a zero bar reads as "office closed", not "nobody on leave".
function DayTick({
  x,
  y,
  payload,
  data,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  data: ChartDatum[];
}) {
  const datum = data.find((d) => d.weekday === payload?.value);
  const muted = datum?.isHoliday;
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        textAnchor="middle"
        dy={12}
        className={muted ? "fill-gray-300" : "fill-gray-600"}
        fontSize={13}
        fontWeight={600}
      >
        {payload?.value}
      </text>
      <text
        textAnchor="middle"
        dy={28}
        className="fill-gray-400"
        fontSize={11}
      >
        {datum ? (datum.isHoliday ? "Holiday" : datum.dayLabel) : ""}
      </text>
    </g>
  );
}

// Renders the segment-by-segment breakdown when the bar is stacked by
// department, or a single "N employees" line when it isn't.
function ChartTooltip({
  active,
  payload,
  isStacked,
}: {
  active?: boolean;
  payload?: { payload: ChartDatum; dataKey?: string; color?: string }[];
  isStacked: boolean;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-md px-3 py-2 text-sm min-w-[160px]">
      <p className="font-semibold text-gray-900">
        {d.weekday}, {d.dayLabel}
      </p>
      {d.isHoliday ? (
        <p className="text-gray-500">Holiday — office closed</p>
      ) : isStacked ? (
        <>
          <ul className="mt-1 space-y-0.5">
            {payload
              .filter((p) => p.dataKey && (d.byDept[p.dataKey] || 0) > 0)
              .map((p) => (
                <li
                  key={p.dataKey}
                  className="flex items-center justify-between gap-4 text-gray-600"
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    {(p as { name?: string }).name}
                  </span>
                  <span className="font-semibold text-gray-900">
                    {d.byDept[p.dataKey!]}
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-1 pt-1 border-t border-gray-100 flex items-center justify-between font-semibold text-gray-900">
            <span>Total</span>
            <span>{d.count}</span>
          </p>
        </>
      ) : (
        <p className="text-gray-600">
          {d.count} employee{d.count === 1 ? "" : "s"} on leave
        </p>
      )}
    </div>
  );
}

// Custom LabelList content for the topmost stacked segment — labels the
// whole stack's total (from the datum), not just that segment's own value,
// so "6" appears once above the bar instead of once per department.
function StackTotalLabel({
  x,
  y,
  width,
  index,
  data,
}: {
  x?: number;
  y?: number;
  width?: number;
  index?: number;
  data: ChartDatum[];
}) {
  if (x === undefined || y === undefined || width === undefined || index === undefined)
    return null;
  const total = data[index]?.count || 0;
  if (total === 0) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 8}
      textAnchor="middle"
      fill="#374151"
      fontSize={12}
      fontWeight={600}
    >
      {total}
    </text>
  );
}

export default function AnalyticsPage() {
  const { user, status } = useAuth();
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => toSunday(new Date()));
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [filterDept, setFilterDept] = useState("all");
  const [filterLeaveType, setFilterLeaveType] = useState("all");

  // Admin-only — stricter than Team Details, which also admits managers.
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
    if (user && user.role !== "admin") router.replace("/dashboard");
  }, [status, user, router]);

  const fetchWeek = useCallback(() => {
    setFetching(true);
    setError("");
    fetch(`/api/admin/analytics?weekStart=${weekStart}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const d = await r.json();
        setData(d);
      })
      .catch(() => setError("Failed to load analytics. Please try again."))
      .finally(() => setFetching(false));
  }, [weekStart]);

  useEffect(() => {
    if (user?.role === "admin") fetchWeek();
  }, [user, fetchWeek]);

  const departments = useMemo(
    () =>
      [...new Set((data?.rows || []).map((r) => r.department).filter(Boolean))].sort(),
    [data]
  );

  // A department picked in one week may have no leaves in the next — snap
  // the filter back to "all" instead of silently showing an all-zero chart
  // for an option that's no longer in the dropdown.
  useEffect(() => {
    if (filterDept !== "all" && !departments.includes(filterDept)) {
      setFilterDept("all");
    }
  }, [departments, filterDept]);

  // Stacking only applies to the "All Departments" view — once a single
  // department is selected the bar collapses to one series, same as before.
  const isStacked = filterDept === "all" && departments.length > 0;

  // Fixed 8-color cap (dataviz method: a 9th series folds into "Other"
  // rather than generating a 9th hue). Assigned from this week's alphabetical
  // department order, which only changes across weeks, never when the leave
  // type filter removes rows within the current week — so a department's
  // color never shifts just because a sibling bar disappeared.
  const explicitDepts = departments.slice(0, 8);
  const series: Series[] = useMemo(() => {
    if (!isStacked) return [];
    const overflowNamed = departments.slice(8);
    const hasUnassigned = (data?.rows || []).some((r) => !r.department);
    const overflowLabel = [...overflowNamed, ...(hasUnassigned ? ["Unassigned"] : [])];
    const list: Series[] = explicitDepts.map((name, i) => ({
      key: `dept${i}`,
      name,
      color: CATEGORICAL_PALETTE[i],
    }));
    if (overflowLabel.length > 0) {
      list.push({
        key: "other",
        name: "Other",
        color: OTHER_COLOR,
        title: `Includes: ${overflowLabel.join(", ")}`,
      });
    }
    return list;
  }, [isStacked, explicitDepts, departments, data]);

  const chartData: ChartDatum[] = useMemo(() => {
    if (!data) return [];
    return data.days.map((date) => {
      const dayRows = data.rows.filter(
        (r) =>
          r.date === date &&
          (filterDept === "all" || r.department === filterDept) &&
          (filterLeaveType === "all" || r.leaveType === filterLeaveType)
      );
      const byDept: Record<string, number> = {};
      if (isStacked) {
        explicitDepts.forEach((name, i) => {
          byDept[`dept${i}`] = new Set(
            dayRows.filter((r) => r.department === name).map((r) => r.employeeEmail)
          ).size;
        });
        byDept.other = new Set(
          dayRows
            .filter((r) => !explicitDepts.includes(r.department))
            .map((r) => r.employeeEmail)
        ).size;
      }
      return {
        date,
        weekday: format(parseISO(date), "EEE"),
        dayLabel: format(parseISO(date), "d MMM"),
        // Distinct employees — two approved leaves covering the same day
        // still mean one person out.
        count: new Set(dayRows.map((r) => r.employeeEmail)).size,
        isHoliday: data.holidays.includes(date),
        byDept,
      };
    });
  }, [data, filterDept, filterLeaveType, isStacked, explicitDepts]);

  const weekTotal = useMemo(
    () =>
      data
        ? new Set(
            data.rows
              .filter(
                (r) =>
                  (filterDept === "all" || r.department === filterDept) &&
                  (filterLeaveType === "all" ||
                    r.leaveType === filterLeaveType)
              )
              .map((r) => r.employeeEmail)
          ).size
        : 0,
    [data, filterDept, filterLeaveType]
  );

  if (status === "loading" || (!data && fetching)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const shiftWeek = (deltaDays: number) =>
    setWeekStart(format(addDays(parseISO(weekStart), deltaDays), "yyyy-MM-dd"));

  const weekEnd = format(addDays(parseISO(weekStart), 4), "yyyy-MM-dd");
  const isCurrentWeek = weekStart === toSunday(new Date());
  const hasLeaves = chartData.some((d) => d.count > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Leave Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Employees on approved leave per working day (Sun–Thu)
          </p>
        </div>

        {/* Week navigation */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => shiftWeek(-7)}
            className="px-3 py-2 rounded-xl text-sm font-semibold bg-white text-gray-600 border border-gray-200 hover:border-indigo-300 transition-colors"
          >
            ‹ Prev
          </button>
          <span className="text-sm font-semibold text-gray-900 min-w-[170px] text-center">
            {formatDateRange(weekStart, weekEnd)}
          </span>
          <button
            onClick={() => shiftWeek(7)}
            className="px-3 py-2 rounded-xl text-sm font-semibold bg-white text-gray-600 border border-gray-200 hover:border-indigo-300 transition-colors"
          >
            Next ›
          </button>
          {!isCurrentWeek && (
            <button
              onClick={() => setWeekStart(toSunday(new Date()))}
              className="px-3 py-2 rounded-xl text-sm font-semibold text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              This week
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <label className="text-sm text-gray-500">Jump to</label>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => {
                // Any picked date snaps to its week's Sunday
                if (e.target.value)
                  setWeekStart(toSunday(parseISO(e.target.value)));
              }}
              onKeyDown={blockManualDateEntry}
              onPaste={blockDatePaste}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
              aria-label="Jump to week containing date"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            aria-label="Department filter"
          >
            <option value="all">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            value={filterLeaveType}
            onChange={(e) => setFilterLeaveType(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
            aria-label="Leave type filter"
          >
            <option value="all">All Leave Types</option>
            {LEAVE_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        {/* Chart */}
        {error ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <p className="text-sm text-coral font-medium mb-3">{error}</p>
            <button
              onClick={fetchWeek}
              className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <div
            className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-6 transition-opacity ${
              fetching ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <p className="text-sm text-gray-500">
                {hasLeaves
                  ? `${weekTotal} employee${weekTotal === 1 ? "" : "s"} on leave this week`
                  : "No approved leaves this week"}
                {filterDept !== "all" && ` · ${filterDept}`}
                {filterLeaveType !== "all" &&
                  ` · ${TYPE_LABELS[filterLeaveType]}`}
              </p>
              {fetching && (
                <div className="animate-spin h-4 w-4 border-2 border-indigo-600 border-t-transparent rounded-full" />
              )}
            </div>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 8, left: -16, bottom: 12 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="#f3f4f6"
                />
                <XAxis
                  dataKey="weekday"
                  tickLine={false}
                  axisLine={{ stroke: "#e5e7eb" }}
                  interval={0}
                  height={44}
                  tick={<DayTick data={chartData} />}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "#9ca3af", fontSize: 12 }}
                  domain={[0, (dataMax: number) => Math.max(dataMax, 4)]}
                />
                <Tooltip
                  content={<ChartTooltip isStacked={isStacked} />}
                  cursor={{ fill: "#eef2ff" }}
                />
                {isStacked ? (
                  <>
                    {series.map((s, i) => (
                      <Bar
                        key={s.key}
                        dataKey={(d: ChartDatum) => d.byDept[s.key] || 0}
                        name={s.name}
                        stackId="leaves"
                        fill={s.color}
                        stroke="#ffffff"
                        strokeWidth={2}
                        radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                        maxBarSize={72}
                      />
                    ))}
                    {/* Recharts skips drawing (and thus labeling) a stacked
                        segment on any day that specific department has zero
                        leaves — which happens most days for most departments.
                        A tiny always-nonzero sentinel segment on top of the
                        stack guarantees a rectangle to hang the total label
                        on, regardless of which real department is 0 that
                        day. The added height (0.01) is sub-pixel and never
                        visible. */}
                    <Bar
                      key="_stackTotal"
                      dataKey={() => 0.01}
                      stackId="leaves"
                      fill="transparent"
                      stroke="none"
                      isAnimationActive={false}
                      legendType="none"
                    >
                      <LabelList content={<StackTotalLabel data={chartData} />} />
                    </Bar>
                  </>
                ) : (
                  <Bar
                    dataKey="count"
                    fill={SINGLE_SERIES_COLOR}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={72}
                  >
                    {/* Zero stays unlabeled — a "0" over every empty day is
                        noise, and holidays already say so in the axis */}
                    <LabelList
                      dataKey="count"
                      position="top"
                      formatter={(v: unknown) => (Number(v) > 0 ? String(v) : "")}
                      fill="#374151"
                      fontSize={12}
                      fontWeight={600}
                    />
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
            {isStacked && series.length > 1 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-gray-50">
                {series.map((s) => (
                  <span
                    key={s.key}
                    className="flex items-center gap-1.5 text-xs text-gray-600"
                    title={s.title}
                  >
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.name}
                  </span>
                ))}
              </div>
            )}
            {data && data.holidays.length > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                Holiday{data.holidays.length === 1 ? "" : "s"} this week:{" "}
                {data.holidays
                  .map((h) => format(parseISO(h), "EEE, d MMM"))
                  .join(" · ")}{" "}
                — excluded from counts
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
