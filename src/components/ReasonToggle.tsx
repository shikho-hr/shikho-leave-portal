"use client";

import { useState } from "react";

export default function ReasonToggle({ reason }: { reason: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!reason) return null;

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
        Reason
      </button>

      {expanded && (
        <div className="mt-2 border-l-2 border-indigo-100 pl-3">
          <p className="text-xs text-gray-600">{reason}</p>
        </div>
      )}
    </div>
  );
}
