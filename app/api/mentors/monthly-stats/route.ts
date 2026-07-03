import { NextRequest, NextResponse } from "next/server";
import { requireTeamUser } from "@/lib/api-auth";
import { getMentorMonthStats } from "@/lib/mentor-month-stats-server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireTeamUser(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const result = await getMentorMonthStats();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Falha ao carregar mentorias do mês." }, { status: 500 });
  }
}
