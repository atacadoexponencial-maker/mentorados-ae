import "server-only";
import pg from "pg";
import { listMeetParticipants } from "./google-meet";

// Coleta automática de participação de um encontro encerrado (Módulo A).
// Casa participantes reais do Meet (issue 37) com mentorados por e-mail (fallback
// por displayName) e grava a presença com origem 'auto'. Nunca toca encontro/linha
// confirmados manualmente. A rotina periódica (issue 39) orquestra as chamadas.

function connectionString() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL não configurada.");
  return value;
}

// Mesma normalização de nomes usada em app/api/calendar/sync/route.ts.
function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export type AutoCollectStatus =
  | "recorded"
  | "unavailable"
  | "skipped_manual"
  | "skipped_not_eligible"
  | "error";

export interface AutoCollectResult {
  status: AutoCollectStatus;
  presentCount?: number;
  absentCount?: number;
  message?: string;
}

interface MenteeCandidate {
  id: string;
  name: string;
  email: string | null;
}

export async function collectMeetingParticipation(meetingId: string): Promise<AutoCollectResult> {
  const cs = connectionString();
  const db = new pg.Client({
    connectionString: cs,
    ssl: cs.includes("localhost") ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  await db.connect();
  try {
    const meetingResult = await db.query(
      `select id, type, individual_mentee_id, meet_url, google_calendar_id, starts_at, ends_at, attendance_recorded_at, attendance_source
         from public.meetings where id = $1`,
      [meetingId],
    );
    if (meetingResult.rowCount === 0) return { status: "skipped_not_eligible" };
    const meeting = meetingResult.rows[0];

    // Guarda "manual prevalece": cobre também registros manuais legados (attendance_source null).
    if (meeting.attendance_recorded_at && (meeting.attendance_source ?? "manual") === "manual") {
      return { status: "skipped_manual" };
    }
    if (!meeting.meet_url || new Date(meeting.ends_at).getTime() > Date.now()) {
      return { status: "skipped_not_eligible" };
    }
    if (meeting.type === "individual" && !meeting.individual_mentee_id) {
      return { status: "skipped_not_eligible" };
    }

    // O subject a impersonar é o mentor dono do calendário do evento (parte antes de "::").
    const subject = String(meeting.google_calendar_id ?? "").split("::")[0];

    let result;
    try {
      result = await listMeetParticipants({
        meetUrl: meeting.meet_url,
        subject,
        startsAt: new Date(meeting.starts_at).toISOString(),
        endsAt: new Date(meeting.ends_at).toISOString(),
      });
    } catch (error) {
      await db.query("update public.meetings set auto_collect_last_attempt_at = now() where id = $1", [meetingId]);
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }

    if (result.status === "unavailable") {
      await db.query("update public.meetings set auto_collect_last_attempt_at = now() where id = $1", [meetingId]);
      return { status: "unavailable" };
    }

    const emails = new Set(
      result.participants.map((p) => p.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)),
    );
    // Participantes sem e-mail resolvido: candidatos ao fallback por displayName.
    const unresolvedNames = result.participants
      .filter((p) => !p.email)
      .map((p) => normalized(p.displayName))
      .filter(Boolean);

    // Presença por mentorado (id → attended). Só entram presentes; ausência é o default.
    const attendanceById = new Map<string, boolean>();
    let candidates: MenteeCandidate[];

    if (meeting.type === "individual") {
      const menteeResult = await db.query(
        "select id, name, lower(email) as email from public.mentees where id = $1",
        [meeting.individual_mentee_id],
      );
      candidates = menteeResult.rows as MenteeCandidate[];
    } else {
      const menteeResult = await db.query(
        "select id, name, lower(email) as email from public.mentees where status = 'active'",
      );
      candidates = menteeResult.rows as MenteeCandidate[];
    }

    const usedNames = new Set<string>();
    for (const mentee of candidates) {
      const byEmail = mentee.email ? emails.has(mentee.email) : false;
      let present = byEmail;
      if (!present) {
        // Fallback por displayName só quando o mentorado não casou por e-mail:
        // um participante sem e-mail resolvido cujo nome bate com exatamente este mentorado.
        const menteeName = normalized(mentee.name);
        if (menteeName) {
          const matches = unresolvedNames.filter((n) => n === menteeName);
          const otherClaim = usedNames.has(menteeName);
          if (matches.length === 1 && !otherClaim) {
            present = true;
            usedNames.add(menteeName);
          }
        }
      }
      if (meeting.type === "individual") {
        attendanceById.set(mentee.id, present); // individual grava sempre (presente OU ausente)
      } else if (present) {
        attendanceById.set(mentee.id, true); // grupo grava só presenças
      }
    }

    await db.query("begin");
    let presentCount = 0;
    let absentCount = 0;
    for (const [menteeId, attended] of attendanceById) {
      await db.query(
        `insert into public.meeting_participations (meeting_id, mentee_id, attended, engagement_score, evolution_score, note, source)
         values ($1, $2, $3, null, null, '', 'auto')
         on conflict (meeting_id, mentee_id) do update set
           attended = excluded.attended,
           source = 'auto'
         where meeting_participations.source = 'auto'`,
        [meetingId, menteeId, attended],
      );
      if (attended) {
        presentCount++;
        await db.query(
          `update public.mentees
             set last_participation_at = greatest(coalesce(last_participation_at, '-infinity'::timestamptz), $2)
           where id = $1`,
          [menteeId, meeting.starts_at],
        );
      } else {
        absentCount++;
      }
    }
    await db.query(
      "update public.meetings set attendance_recorded_at = now(), attendance_source = 'auto', auto_collect_last_attempt_at = now() where id = $1",
      [meetingId],
    );
    await db.query("commit");
    return { status: "recorded", presentCount, absentCount };
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  } finally {
    await db.end().catch(() => undefined);
  }
}
