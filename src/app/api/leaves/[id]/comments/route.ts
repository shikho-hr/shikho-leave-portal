import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCommentsByLeave, addComment, getLeaveById } from "@/lib/db";
import { isResolvedLeaveStatus } from "@/lib/leave-calculator";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [comments, leave] = await Promise.all([
      getCommentsByLeave(params.id),
      getLeaveById(params.id),
    ]);
    const res = NextResponse.json(comments);
    // Once a leave is approved or rejected, its comment thread is locked
    // (see the POST handler) and can never change again — safe to cache in
    // the browser forever instead of re-fetching on every dashboard visit.
    if (leave && isResolvedLeaveStatus(leave.status)) {
      res.headers.set("Cache-Control", "private, max-age=31536000, immutable");
    }
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch comments" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
        { error: "This leave request has already been decided — the comment thread is closed." },
        { status: 403 }
      );
    }

    const newComment = await addComment(
      params.id,
      user.email,
      user.name || user.email,
      comment.trim()
    );

    return NextResponse.json(newComment);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to add comment" },
      { status: 500 }
    );
  }
}
