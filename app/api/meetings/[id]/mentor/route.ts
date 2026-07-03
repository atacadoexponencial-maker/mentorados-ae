import { NextRequest, NextResponse } from "next/server";
import { requireTeamUser } from "@/lib/api-auth";
import { setMeetingMentor } from "@/lib/meeting-mentor-server";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND_MESSAGES = ["Encontro não encontrado.", "Mentor não encontrado."];

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTeamUser(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const mentorId = body && typeof body === "object" ? body.mentorId : null;
  if (typeof mentorId !== "string" || !UUID_PATTERN.test(mentorId)) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  try {
    await setMeetingMentor(id, mentorId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao salvar.";
    const status = NOT_FOUND_MESSAGES.includes(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
