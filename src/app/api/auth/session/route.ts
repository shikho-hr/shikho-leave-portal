import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase-admin";
import { getEmployeeByEmail, ensureSystemAdmin } from "@/lib/db";
import { isSystemAdmin } from "@/lib/system-admin";

const SESSION_EXPIRES_IN = 14 * 24 * 60 * 60 * 1000; // 14 days

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();
    if (!idToken) {
      return NextResponse.json({ error: "Missing idToken" }, { status: 400 });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    if (!decoded.email) {
      return NextResponse.json({ error: "No email on account" }, { status: 400 });
    }

    // Permanent admin account: (re)create its row before the lookup so it
    // can always sign in — see system-admin.ts.
    if (isSystemAdmin(decoded.email)) await ensureSystemAdmin();

    const employee = await getEmployeeByEmail(decoded.email);
    if (!employee || employee.status !== "active") {
      return NextResponse.json(
        { error: "Access denied. Your account is not a registered employee. Contact HR." },
        { status: 403 }
      );
    }

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_EXPIRES_IN,
    });

    cookies().set("session", sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_EXPIRES_IN / 1000,
      path: "/",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to sign in" }, { status: 401 });
  }
}

export async function DELETE() {
  cookies().delete("session");
  return NextResponse.json({ ok: true });
}
