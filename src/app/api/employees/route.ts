import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getEmployees,
  getEmployeesByManager,
  getAllApprovedLeavesGroupedByEmployee,
  getApprovedLeavesGroupedByEmployees,
  getAllOpeningBalances,
  getAllBalanceSnapshots,
} from "@/lib/db";
import { calculateBalance } from "@/lib/leave-calculator";

export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (user.role !== "admin" && user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const isAdmin = user.role === "admin";
    // Managers only see their active reportees — Admin still sees everyone,
    // active or inactive, unchanged.
    const employees = isAdmin
      ? await getEmployees()
      : (await getEmployeesByManager(user.email)).filter(
          (e) => e.status === "active"
        );

    const [approvedByEmail, openingBalances, snapshots] = await Promise.all([
      isAdmin
        ? getAllApprovedLeavesGroupedByEmployee()
        : getApprovedLeavesGroupedByEmployees(employees.map((e) => e.email)),
      getAllOpeningBalances(),
      getAllBalanceSnapshots(),
    ]);

    const enriched = employees.map((emp) => {
      const approved = approvedByEmail.get(emp.email) || [];
      const balance = calculateBalance(
        emp,
        approved,
        openingBalances.get(emp.email),
        snapshots.get(emp.email)
      );
      return {
        ...emp,
        balance: balance.remaining,
      };
    });

    return NextResponse.json(enriched);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch employees" },
      { status: 500 }
    );
  }
}
