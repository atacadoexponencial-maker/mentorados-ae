import { NextRequest, NextResponse } from "next/server";
import { requireTeamUser } from "@/lib/api-auth";
import { saveParticipation, type ParticipationEntry } from "@/lib/participation-server";

export const runtime = "nodejs";

function clampScore(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return Math.round(n);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTeamUser(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const rawEntries = body && typeof body === "object" ? body.entries : null;
  if (!Array.isArray(rawEntries)) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  const entries: ParticipationEntry[] = rawEntries
    .filter((entry) => entry && typeof entry.menteeId === "string")
    .map((entry) => ({
      menteeId: String(entry.menteeId),
      attended: Boolean(entry.attended),
      engagementScore: clampScore(entry.engagementScore),
      evolutionScore: clampScore(entry.evolutionScore),
      note: typeof entry.note === "string" ? entry.note : "",
    }));

  try {
    await saveParticipation(id, entries);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao salvar." }, { status: 500 });
  }
}
