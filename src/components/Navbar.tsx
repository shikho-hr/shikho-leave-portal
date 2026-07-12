"use client";

import { useAuth } from "@/lib/AuthContext";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const { user, signOutUser } = useAuth();
  const pathname = usePathname();
  const role = user?.role;

  const links = [
    { href: "/dashboard", label: "Dashboard" },
    ...(role === "manager" || role === "admin"
      ? [{ href: "/approvals", label: "Approvals" }]
      : []),
    ...(role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <nav className="bg-indigo-600 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14 items-center">
          <div className="flex items-center gap-8">
            <Link
              href="/dashboard"
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
