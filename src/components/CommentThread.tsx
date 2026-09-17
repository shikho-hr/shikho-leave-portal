"use client";

import { useEffect, useState } from "react";

interface Comment {
  id: string;
  leaveId: string;
  authorEmail: string;
  authorName: string;
  comment: string;
  createdAt: string;
}

export default function CommentThread({
  leaveId,
  currentUserEmail,
  hideIfEmpty = false,
  initialExpanded = false,
}: {
  leaveId: string;
  currentUserEmail: string;
  // When true, fetches eagerly on mount (instead of on first expand) so an
  // empty thread can render nothing at all, rather than a toggle that only
  // reveals "No comments yet" once clicked. Trades the lazy-load for an
  // upfront fetch per row — used on Dashboard, scoped to a bounded list
  // rather than an unbounded one.
  hideIfEmpty?: boolean;
  // Opens already expanded — used by the notification popup, where the
  // whole point of opening it was to read the comment that triggered it.
  initialExpanded?: boolean;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(initialExpanded);

  const fetchComments = () => {
    fetch(`/api/leaves/${leaveId}/comments`)
      .then((r) => r.json())
      .then((data) => {
        setComments(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (expanded || hideIfEmpty) fetchComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, leaveId]);

  const handleSubmit = async () => {
    if (!newComment.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/leaves/${leaveId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: newComment.trim() }),
      });
      if (res.ok) {
        const added = await res.json();
        setComments((prev) => [...prev, added]);
        setNewComment("");
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

  if (hideIfEmpty && !loading && comments.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
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
        Comments{comments.length > 0 ? ` (${comments.length})` : ""}
      </button>

      {expanded && (
        <div className="mt-2 border-l-2 border-indigo-100 pl-3 space-y-2">
          {loading ? (
            <p className="text-xs text-gray-400">Loading...</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-gray-400">No comments yet</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="text-xs">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-semibold ${
                      c.authorEmail === currentUserEmail
                        ? "text-indigo-700"
                        : "text-gray-700"
                    }`}
                  >
                    {c.authorName}
                  </span>
                  <span className="text-gray-400">
                    {formatTime(c.createdAt)}
                  </span>
                </div>
                <p className="text-gray-600 mt-0.5">{c.comment}</p>
              </div>
            ))
          )}

          {/* Add comment */}
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 bg-gray-50/50"
            />
            <button
              onClick={handleSubmit}
              disabled={sending || !newComment.trim()}
              className="text-xs font-semibold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {sending ? "..." : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
