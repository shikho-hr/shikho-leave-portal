"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { isSystemAdmin, SYSTEM_ADMIN_HOME } from "@/lib/system-admin";

// Confines the HR automation account to the Team Details page: any other
// route it lands on (Dashboard, Apply, Approvals, Analytics, the login
// page's post-sign-in redirect…) is replaced with /admin. Mounted once from
// Providers so it covers every page without per-page edits.
export default function SystemAdminGuard() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!user || !isSystemAdmin(user.email)) return;
    if (pathname !== SYSTEM_ADMIN_HOME) router.replace(SYSTEM_ADMIN_HOME);
  }, [user, pathname, router]);

  return null;
}
