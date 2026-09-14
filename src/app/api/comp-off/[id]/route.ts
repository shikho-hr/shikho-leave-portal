import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  decideCompOffCredit,
  getCompOffCreditById,
  getEmployeeByEmail,
  notifyCompOffDecided,
} from "@/lib/db";

// Who may act on a credit: its owner can look, the employee's line manager
// or any HR admin can look and decide. Mirrors how a leave request is
// visible to the same three parties.
async function access(creditEmployeeEmail: string, user: { email: string; role: string }) {
  const owner = creditEmployeeEmail.toLowerCase() === user.email.toLowerCase();
  if (user.role === "admin") return { canView: true, canDecide: true };
  const employee = await getEmployeeByEmail(creditEmployeeEmail);
  const isManager =
    (employee?.managerEmail || "").toLowerCase() === user.email.toLowerCase();
  return { canView: owner || isManager, canDecide: isManager };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const credit = await getCompOffCreditById(params.id);
    if (!credit)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { canView, canDecide } = await access(credit.employeeEmail, user);
    if (!canView)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const employee = await getEmployeeByEmail(credit.employeeEmail);
    return NextResponse.json({
      ...credit,
      employeeName: employee?.name || credit.employeeEmail,
      canDecide: canDecide && credit.status === "pending",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch the work day" },
      { status: 500 }
    );
  }
}

// Accept or reject a recorded work day. Accepting is what turns it into
// spendable Compensatory Off balance; rejecting adds nothing.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { status, comments } = await req.json();
    if (status !== "accepted" && status !== "rejected") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    // Same rule as rejecting a leave: say why.
    if (status === "rejected" && !String(comments || "").trim()) {
      return NextResponse.json(
        { error: "Please add a comment explaining the rejection." },
        { status: 400 }
      );
    }

    const credit = await getCompOffCreditById(params.id);
    if (!credit)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { canDecide } = await access(credit.employeeEmail, user);
    if (!canDecide)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (credit.status !== "pending") {
      return NextResponse.json(
        { error: `This work day was already ${credit.status}.` },
        { status: 409 }
      );
    }

    // Conditional update — if another reviewer decided it a moment ago,
    // this returns false rather than silently overwriting their decision.
    const decided = await decideCompOffCredit(
      params.id,
      status,
      user.email,
      String(comments || "").trim()
    );
    if (!decided) {
      return NextResponse.json(
        { error: "Someone else has already decided this work day." },
        { status: 409 }
      );
    }

    await notifyCompOffDecided(
      params.id,
      status,
      user.email,
      user.name || user.email,
      String(comments || "").trim()
    );

    return NextResponse.json({ message: `Work day ${status}`, status });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update the work day" },
      { status: 500 }
    );
  }
}
