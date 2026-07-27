import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getNotificationById, markNotificationRead } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const notification = await getNotificationById(params.id);
    if (!notification) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (notification.recipientEmail !== user.email.toLowerCase()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await markNotificationRead(params.id);
    return NextResponse.json({ message: "Marked as read" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update notification" },
      { status: 500 }
    );
  }
}
