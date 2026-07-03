import "server-only";
import pg from "pg";

// Troca o mentor vinculado a um encontro numa transação: remove os vínculos
// atuais e insere um único vínculo com source='manual' (o sync não o sobrescreve).

function connectionString() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL não configurada.");
  return value;
}

export async function setMeetingMentor(meetingId: string, mentorId: string): Promise<void> {
  const cs = connectionString();
  const db = new pg.Client({
    connectionString: cs,
    ssl: cs.includes("localhost") ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  await db.connect();
  try {
    await db.query("begin");
    const meeting = await db.query("select id from public.meetings where id = $1", [meetingId]);
    if (meeting.rowCount === 0) throw new Error("Encontro não encontrado.");
    const mentor = await db.query("select id from public.mentors where id = $1", [mentorId]);
    if (mentor.rowCount === 0) throw new Error("Mentor não encontrado.");

    await db.query("delete from public.meeting_mentors where meeting_id = $1", [meetingId]);
    await db.query(
      "insert into public.meeting_mentors (meeting_id, mentor_id, source) values ($1, $2, 'manual')",
      [meetingId, mentorId],
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end().catch(() => undefined);
  }
}
