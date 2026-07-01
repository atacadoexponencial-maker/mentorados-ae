import { NextRequest, NextResponse } from "next/server";
import { ensureBriefingToken, markBriefingReviewed } from "@/lib/briefing-server";
import { requireTeamUser } from "@/lib/api-auth";

export const runtime = "nodejs";

// Rotas protegidas (equipe): gerar/regenerar o token e marcar a ficha como revisada.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTeamUser(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const token = await ensureBriefingToken(id, Boolean(body?.regenerate));
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: "Não foi possível gerar o link." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTeamUser(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  try {
    await markBriefingReviewed(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Não foi possível marcar como revisado." }, { status: 500 });
  }
}
