import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteWorkingWeekend } from "@/lib/db";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { date: string } }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await deleteWorkingWeekend(params.date);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to delete working weekend" },
      { status: 500 }
    );
  }
}
