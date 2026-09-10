"use client";

import { useEffect, useState } from "react";

interface Holiday {
  date: string;
  name: string;
}

// Dates must be picked via the calendar UI, not typed — same convention as
// every other date field in the app (avoids mm/dd vs dd/mm ambiguity).
const blockManualDateEntry = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Tab") e.preventDefault();
};
const blockDatePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
  e.preventDefault();
};

function formatDisplay(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    weekday: "short",
  });
}

// Admin-managed replacement for the old Holidays/working_weekends Sheet
// tabs — see src/lib/db.ts's createHoliday/createWorkingWeekend. Both
// lists are small (a few dozen dates a year at most), so a simple
// fetch-the-whole-list-on-load approach is fine, no pagination needed.
export default function CompanyCalendarManager() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [workingWeekends, setWorkingWeekends] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [addingHoliday, setAddingHoliday] = useState(false);

  const [newWorkingWeekendDate, setNewWorkingWeekendDate] = useState("");
  const [addingWorkingWeekend, setAddingWorkingWeekend] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/holidays").then((r) => r.json()),
      fetch("/api/admin/working-weekends").then((r) => r.json()),
    ])
      .then(([h, w]) => {
        setHolidays(Array.isArray(h) ? h : []);
        setWorkingWeekends(Array.isArray(w) ? w : []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const addHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolidayDate || !newHolidayName.trim()) return;
    setAddingHoliday(true);
    setError("");
    try {
      const res = await fetch("/api/admin/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newHolidayDate, name: newHolidayName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add holiday");
      setNewHolidayDate("");
      setNewHolidayName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add holiday");
    } finally {
      setAddingHoliday(false);
    }
  };

  const removeHoliday = async (date: string) => {
    setError("");
    try {
      const res = await fetch(`/api/admin/holidays/${date}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to remove holiday");
      setHolidays((prev) => prev.filter((h) => h.date !== date));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove holiday");
    }
  };

  const addWorkingWeekend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkingWeekendDate) return;
    setAddingWorkingWeekend(true);
    setError("");
    try {
      const res = await fetch("/api/admin/working-weekends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newWorkingWeekendDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add working weekend");
      setNewWorkingWeekendDate("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add working weekend");
    } finally {
      setAddingWorkingWeekend(false);
    }
  };

  const removeWorkingWeekend = async (date: string) => {
    setError("");
    try {
      const res = await fetch(`/api/admin/working-weekends/${date}`, {
        method: "DELETE",
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Failed to remove working weekend");
      setWorkingWeekends((prev) => prev.filter((d) => d !== date));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove working weekend");
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">Loading company calendar...</p>;
  }

  const sortedHolidays = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  const sortedWorkingWeekends = [...workingWeekends].sort();

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm font-medium bg-coral/10 text-coral">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Holidays */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-1">Holidays</h3>
          <p className="text-sm text-gray-500 mb-4">
            Dates excluded from every leave-day count, regardless of weekday.
          </p>
          <form onSubmit={addHoliday} className="flex flex-wrap gap-2 mb-4">
            <input
              type="date"
              value={newHolidayDate}
              onChange={(e) => setNewHolidayDate(e.target.value)}
              onKeyDown={blockManualDateEntry}
              onPaste={blockDatePaste}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
              required
            />
            <input
              type="text"
              placeholder="Holiday name"
              value={newHolidayName}
              onChange={(e) => setNewHolidayName(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white flex-1 min-w-[140px]"
              required
            />
            <button
              type="submit"
              disabled={addingHoliday}
              className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              Add
            </button>
          </form>
          <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {sortedHolidays.length === 0 && (
              <li className="text-sm text-gray-400 py-2">No holidays added yet.</li>
            )}
            {sortedHolidays.map((h) => (
              <li key={h.date} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span className="text-gray-900 font-medium">{h.name}</span>{" "}
                  <span className="text-gray-500">— {formatDisplay(h.date)}</span>
                </span>
                <button
                  onClick={() => removeHoliday(h.date)}
                  className="text-coral hover:opacity-75 font-semibold"
                  aria-label={`Remove ${h.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Working weekends */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-1">Working Weekends</h3>
          <p className="text-sm text-gray-500 mb-4">
            A Friday/Saturday that counts as a working day (a team came in to make up for a
            holiday). Doesn&apos;t apply to Sunday–Thursday — those are already working days.
          </p>
          <form onSubmit={addWorkingWeekend} className="flex flex-wrap gap-2 mb-4">
            <input
              type="date"
              value={newWorkingWeekendDate}
              onChange={(e) => setNewWorkingWeekendDate(e.target.value)}
              onKeyDown={blockManualDateEntry}
              onPaste={blockDatePaste}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
              required
            />
            <button
              type="submit"
              disabled={addingWorkingWeekend}
              className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              Add
            </button>
          </form>
          <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {sortedWorkingWeekends.length === 0 && (
              <li className="text-sm text-gray-400 py-2">No working weekends added yet.</li>
            )}
            {sortedWorkingWeekends.map((date) => (
              <li key={date} className="flex items-center justify-between py-2 text-sm">
                <span className="text-gray-900">{formatDisplay(date)}</span>
                <button
                  onClick={() => removeWorkingWeekend(date)}
                  className="text-coral hover:opacity-75 font-semibold"
                  aria-label={`Remove ${date}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
