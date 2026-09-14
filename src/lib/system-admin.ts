// The HR automation account is a permanent, restricted administrator:
//
//   - It is always an active admin. Its Employee row is (re)created on every
//     sign-in (ensureSystemAdmin in db.ts), so deleting or demoting it has no
//     lasting effect, the Role Assigner refuses to change it, and the roster
//     sync ignores any sheet row with this email.
//   - It is not a member of staff: it never appears in Team Details' employee
//     list, balances, analytics or the Role Assigner, has no leave balance,
//     and cannot apply for leave.
//   - It may only use the Team Details (/admin) page. Every other page
//     redirects there (SystemAdminGuard), and the navbar shows nothing else.
//
// Pure module: safe to import from both server and client code.

export const SYSTEM_ADMIN_EMAIL = "hr.portal@shikho.com";

export function isSystemAdmin(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === SYSTEM_ADMIN_EMAIL;
}

export const SYSTEM_ADMIN_HOME = "/admin";
