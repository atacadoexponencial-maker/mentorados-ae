import process from "node:process";
import pg from "pg";

process.loadEnvFile(".env.local");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL ausente.");
const database = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });

try {
  await database.connect();
  const result = await database.query(`
    select
      count(*)::int as total,
      count(*) filter (where meet_url is not null)::int as with_meet,
      count(*) filter (where title ~* '(mentoria|mentoring|individual|1:1|one.on.one)')::int as individual_keywords,
      count(*) filter (where title ~* '(plant[aã]o|grupo|cl[ií]nica|workshop|masterclass|aula)')::int as group_keywords,
      count(*) filter (where starts_at < now())::int as past,
      count(*) filter (where starts_at >= now())::int as future,
      count(*) filter (where individual_mentee_id is not null)::int as linked,
      count(*) filter (where attendance_recorded_at is not null)::int as attendance_recorded
    from public.meetings
    where google_event_id is not null
  `);
  console.log(JSON.stringify(result.rows[0], null, 2));
} finally {
  await database.end().catch(() => undefined);
}
