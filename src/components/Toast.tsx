"use client";

import { useEffect } from "react";

interface ToastProps {
  message: string;
  type?: "success" | "danger";
  onClose: () => void;
}

export default function Toast({ message, type = "success", onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  const isDanger = type === "danger";

  return (
    <div className="fixed top-20 right-6 z-[60]">
      <div
        className={`flex items-center gap-3 rounded-2xl px-4 py-3 shadow-lg text-sm font-semibold text-white ${
          isDanger ? "bg-coral" : "bg-green-600"
        }`}
      >
        <span className="text-base leading-none">{isDanger ? "✕" : "✓"}</span>
        <span>{message}</span>
        <button
          onClick={onClose}
          className="ml-2 text-white/80 hover:text-white text-base leading-none"
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
