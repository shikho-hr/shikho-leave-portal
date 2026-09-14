"use client";

import { useAuth } from "@/lib/AuthContext";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import NotificationBell from "./NotificationBell";
import { isSystemAdmin, SYSTEM_ADMIN_HOME } from "@/lib/system-admin";

export default function Navbar() {
  const { user, signOutUser } = useAuth();
  const pathname = usePathname();
  const role = user?.role;
  // The HR automation account only ever sees Team Details — no other links,
  // no pending-approvals badge, no notification bell (see system-admin.ts).
  const systemAdmin = isSystemAdmin(user?.email);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (systemAdmin) return;
    if (role !== "manager" && role !== "admin") return;

    const fetchPendingCount = () => {
      const fetches: Promise<unknown>[] = [
        fetch("/api/leaves?view=pending").then((r) => r.json()),
      ];
      // Admins/HR also have a second queue (requests manager-approved and
      // awaiting HR's final sign-off) that counts toward "do I have anything
      // pending" just as much as the manager-stage queue does.
      if (role === "admin") {
        fetches.push(fetch("/api/leaves?view=hr").then((r) => r.json()));
      }

      Promise.all(fetches).then((results) => {
        const total = results.reduce(
          (sum: number, data) => sum + (Array.isArray(data) ? data.length : 0),
          0
        );
        setPendingCount(total);
      });
    };

    fetchPendingCount();
    // Fired by the Approvals page right after a manager/HR approves or
    // rejects a request, so the badge updates live without a page
    // navigation — the Navbar instance otherwise never re-fetches on its
    // own once mounted.
    window.addEventListener("leave-request-updated", fetchPendingCount);
    return () =>
      window.removeEventListener("leave-request-updated", fetchPendingCount);
  }, [role, systemAdmin]);

  const pendingCountLabel = pendingCount >= 10 ? "9+" : String(pendingCount);

  const links = systemAdmin
    ? [{ href: SYSTEM_ADMIN_HOME, label: "Team Details" }]
    : [
    { href: "/dashboard", label: "Dashboard" },
    ...(role === "manager" || role === "admin"
      ? [
          {
            href: "/approvals",
            label:
              pendingCount > 0
                ? `Team's Leave Requests (${pendingCountLabel})`
                : "Team's Leave Requests",
          },
        ]
      : []),
    ...(role === "manager" || role === "admin"
      ? [{ href: "/admin", label: "Team Details" }]
      : []),
    // Admin-only, unlike the manager-visible entries above — the analytics
    // view spans every department.
    ...(role === "admin" ? [{ href: "/analytics", label: "Analytics" }] : []),
  ];

  const homeHref = systemAdmin ? SYSTEM_ADMIN_HOME : "/dashboard";

  return (
    <nav className="bg-indigo-600 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14 items-center">
          <div className="flex items-center gap-8">
            <Link
              href={homeHref}
              className="flex items-center gap-2 text-white"
            >
              <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/shikho-bird.png"
                  alt="Shikho"
                  className="w-full h-full object-contain"
                />
              </div>
              <span className="font-semibold text-sm hidden sm:block">
                Leave Portal
              </span>
            </Link>
            <div className="hidden sm:flex gap-1">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                    pathname === link.href
                      ? "bg-white/20 text-white"
                      : "text-indigo-100 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {user?.email && !systemAdmin && (
              <NotificationBell currentUserEmail={user.email} />
            )}
            <span className="text-sm text-indigo-200 hidden sm:block">
              {user?.name}
            </span>
            <button
              onClick={async () => {
                await signOutUser();
                window.location.href = "/";
              }}
              className="text-sm text-indigo-200 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
