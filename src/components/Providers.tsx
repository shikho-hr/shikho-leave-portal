"use client";

import { AuthProvider } from "@/lib/AuthContext";
import SystemAdminGuard from "./SystemAdminGuard";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SystemAdminGuard />
      {children}
    </AuthProvider>
  );
}
