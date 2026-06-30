import process from "node:process";
import pg from "pg";

process.loadEnvFile(".env.local");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL não configurada em .env.local");

const expectedTables = [
  "achievements",
  "meeting_mentors",
  "meeting_participations",
  "meetings",
  "mentee_mentors",
  "mentees",
  "mentors",
];

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  const tables = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_name = any($1::text[])
    order by table_name
  `, [expectedTables]);
  const policies = await client.query(`
    select count(*)::int as count
    from pg_policies
    where schemaname = 'public' and tablename = any($1::text[])
  `, [expectedTables]);

  const found = tables.rows.map((row) => row.table_name);
  const missing = expectedTables.filter((table) => !found.includes(table));
  console.log(`Tabelas: ${found.length}/${expectedTables.length}`);
  console.log(`Políticas RLS: ${policies.rows[0].count}`);
  if (missing.length) throw new Error(`tabelas ausentes: ${missing.join(", ")}`);
  console.log("Banco validado com sucesso.");
} catch (error) {
  console.error(`Falha ao validar banco: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
