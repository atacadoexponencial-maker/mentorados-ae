import "server-only";
import pg from "pg";

// Persiste as participações de um encontro (presença, notas e observação) numa
// transação e atualiza a última participação de cada mentorado presente.

function connectionString() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL não configurada.");
  return value;
}

export interface ParticipationEntry {
  menteeId: string;
  attended: boolean;
  engagementScore: number | null;
  evolutionScore: number | null;
  note: string;
}

export async function saveParticipation(meetingId: string, entries: ParticipationEntry[]): Promise<void> {
  const cs = connectionString();
  const db = new pg.Client({
    connectionString: cs,
    ssl: cs.includes("localhost") ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  await db.connect();
  try {
    await db.query("begin");
    const meeting = await db.query("select starts_at from public.meetings where id = $1", [meetingId]);
    if (meeting.rowCount === 0) throw new Error("Encontro não encontrado.");
    const startsAt = meeting.rows[0].starts_at;

    for (const entry of entries) {
      await db.query(
        `insert into public.meeting_participations (meeting_id, mentee_id, attended, engagement_score, evolution_score, note)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (meeting_id, mentee_id) do update set
           attended = excluded.attended,
           engagement_score = excluded.engagement_score,
           evolution_score = excluded.evolution_score,
           note = excluded.note`,
        [meetingId, entry.menteeId, entry.attended, entry.engagementScore, entry.evolutionScore, entry.note],
      );
      if (entry.attended) {
        await db.query(
          `update public.mentees
             set last_participation_at = greatest(coalesce(last_participation_at, '-infinity'::timestamptz), $2)
           where id = $1`,
          [entry.menteeId, startsAt],
        );
      }
    }

    await db.query("update public.meetings set attendance_recorded_at = now() where id = $1", [meetingId]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end().catch(() => undefined);
  }
}
