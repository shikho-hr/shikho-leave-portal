import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getNotificationsForUser } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const notifications = await getNotificationsForUser(user.email);
    return NextResponse.json(notifications);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 }
    );
  }
}
