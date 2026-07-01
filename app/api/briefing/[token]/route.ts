import { NextRequest, NextResponse } from "next/server";
import { getBriefingByToken, saveBriefingByToken } from "@/lib/briefing-server";

export const runtime = "nodejs";

// Rota pública (sem login): leitura e gravação do briefing pelo token do mentorado.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const briefing = await getBriefingByToken(token);
    if (!briefing) return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 404 });
    return NextResponse.json(briefing);
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar o briefing." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const body = await request.json().catch(() => null);
    const answers = body && typeof body === "object" ? body.answers : null;
    if (!answers || typeof answers !== "object") {
      return NextResponse.json({ error: "Respostas inválidas." }, { status: 400 });
    }
    const saved = await saveBriefingByToken(token, answers as Record<string, unknown>);
    if (!saved) return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Não foi possível salvar o briefing." }, { status: 500 });
  }
}
