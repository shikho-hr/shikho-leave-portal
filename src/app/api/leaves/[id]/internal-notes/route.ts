import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getInternalNotesByLeave, addInternalNote, getLeaveById } from "@/lib/db";
import { isResolvedLeaveStatus } from "@/lib/leave-calculator";

// Manager/admin only, on both reads and writes — an employee hitting this
// endpoint directly (not just lacking a UI element for it) is rejected too.
function assertReviewer(role: string | undefined) {
  return role === "manager" || role === "admin";
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user || !assertReviewer(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [notes, leave] = await Promise.all([
      getInternalNotesByLeave(params.id),
      getLeaveById(params.id),
    ]);
    const res = NextResponse.json(notes);
    // Same rule as comments — locked (see POST) the moment a leave is
    // decided, so it's then immutable and safe to cache indefinitely.
    if (leave && isResolvedLeaveStatus(leave.status)) {
      res.headers.set("Cache-Control", "private, max-age=31536000, immutable");
    }
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch internal notes" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user || !assertReviewer(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { comment } = body;

    if (!comment || !comment.trim()) {
      return NextResponse.json(
        { error: "Comment is required" },
        { status: 400 }
      );
    }

    const leave = await getLeaveById(params.id);
    if (!leave) {
      return NextResponse.json({ error: "Leave not found" }, { status: 404 });
    }
    if (isResolvedLeaveStatus(leave.status)) {
      return NextResponse.json(
        { error: "This leave request has already been decided — internal notes are closed." },
        { status: 403 }
      );
    }

    const newNote = await addInternalNote(
      params.id,
      user.email,
      user.name || user.email,
      comment.trim()
    );

    return NextResponse.json(newNote);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to add internal note" },
      { status: 500 }
    );
  }
}
