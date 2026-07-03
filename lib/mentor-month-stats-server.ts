import "server-only";
import pg from "pg";

// Conta, por mentor com vínculo em meeting_mentors, os encontros já realizados
// (starts_at <= now()) dentro do mês corrente em America/Sao_Paulo, separados
// por tipo. Só leitura — sem transação.

function connectionString() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL não configurada.");
  return value;
}

export interface MentorMonthStat {
  mentorId: string;
  name: string;
  individual: number;
  group: number;
  total: number;
}

const monthFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" });

export async function getMentorMonthStats(): Promise<{ month: string; stats: MentorMonthStat[] }> {
  const cs = connectionString();
  const db = new pg.Client({
    connectionString: cs,
    ssl: cs.includes("localhost") ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  await db.connect();
  try {
    const result = await db.query(
      `with sp as (
         select date_trunc('month', now() at time zone 'America/Sao_Paulo') as month_start
       )
       select
         m.id as mentor_id,
         m.name,
         to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM') as month,
         count(*) filter (
           where mt.type = 'individual'
             and mt.starts_at <= now()
             and (mt.starts_at at time zone 'America/Sao_Paulo') >= sp.month_start
             and (mt.starts_at at time zone 'America/Sao_Paulo') < sp.month_start + interval '1 month'
         )::int as individual_count,
         count(*) filter (
           where mt.type = 'group'
             and mt.starts_at <= now()
             and (mt.starts_at at time zone 'America/Sao_Paulo') >= sp.month_start
             and (mt.starts_at at time zone 'America/Sao_Paulo') < sp.month_start + interval '1 month'
         )::int as group_count
       from public.mentors m
       join public.meeting_mentors mm on mm.mentor_id = m.id
       join public.meetings mt on mt.id = mm.meeting_id
       cross join sp
       group by m.id, m.name, sp.month_start
       order by m.name asc`,
    );
    if (result.rowCount === 0) return { month: monthFormatter.format(new Date()), stats: [] };
    const month = result.rows[0].month as string;
    const stats: MentorMonthStat[] = result.rows.map((row) => ({
      mentorId: row.mentor_id as string,
      name: row.name as string,
      individual: row.individual_count as number,
      group: row.group_count as number,
      total: (row.individual_count as number) + (row.group_count as number),
    }));
    return { month, stats };
  } finally {
    await db.end().catch(() => undefined);
  }
}
