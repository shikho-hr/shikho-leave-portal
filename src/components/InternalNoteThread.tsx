"use client";

import { useEffect, useState } from "react";

interface Note {
  id: string;
  leaveId: string;
  authorEmail: string;
  authorName: string;
  comment: string;
  createdAt: string;
}

// Manager/admin-only notes thread — separate from CommentThread, which the
// employee who applied for the leave can also see. This one is deliberately
// never rendered anywhere an employee's own view can reach.
export default function InternalNoteThread({
  leaveId,
  currentUserEmail,
}: {
  leaveId: string;
  currentUserEmail: string;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchNotes = () => {
    fetch(`/api/leaves/${leaveId}/internal-notes`)
      .then((r) => r.json())
      .then((data) => {
        setNotes(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (expanded) fetchNotes();
  }, [expanded, leaveId]);

  const handleSubmit = async () => {
    if (!newNote.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/leaves/${leaveId}/internal-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: newNote.trim() }),
      });
      if (res.ok) {
        const added = await res.json();
        setNotes((prev) => [...prev, added]);
        setNewNote("");
      }
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs font-medium text-yellow-700 hover:text-yellow-800 flex items-center gap-1"
      >
        <svg
          className={`w-3 h-3 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
        Internal notes{notes.length > 0 ? ` (${notes.length})` : ""} — not
        visible to employee
      </button>

      {expanded && (
        <div className="mt-2 border-l-2 border-sunrise/40 bg-sunrise/5 pl-3 py-2 rounded-r-lg space-y-2">
          {loading ? (
            <p className="text-xs text-gray-400">Loading...</p>
          ) : notes.length === 0 ? (
            <p className="text-xs text-gray-400">No internal notes yet</p>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="text-xs">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-semibold ${
                      n.authorEmail === currentUserEmail
                        ? "text-yellow-800"
                        : "text-gray-700"
                    }`}
                  >
                    {n.authorName}
                  </span>
                  <span className="text-gray-400">
                    {formatTime(n.createdAt)}
                  </span>
                </div>
                <p className="text-gray-600 mt-0.5">{n.comment}</p>
              </div>
            ))
          )}

          <div className="flex gap-2 pt-1">
            <input
              type="text"
              placeholder="Add an internal note (manager/admin only)..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="flex-1 border border-sunrise/30 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-yellow-600 bg-white"
            />
            <button
              onClick={handleSubmit}
              disabled={sending || !newNote.trim()}
              className="text-xs font-semibold text-white bg-yellow-600 px-3 py-1.5 rounded-lg hover:bg-yellow-700 disabled:opacity-50 transition-colors"
            >
              {sending ? "..." : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
