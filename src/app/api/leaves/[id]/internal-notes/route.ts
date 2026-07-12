import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getInternalNotesByLeave, addInternalNote } from "@/lib/db";

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
    const notes = await getInternalNotesByLeave(params.id);
    return NextResponse.json(notes);
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
