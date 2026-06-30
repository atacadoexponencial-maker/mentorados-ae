import process from "node:process";
import pg from "pg";

process.loadEnvFile(".env.local");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL não configurada.");

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  const summary = await client.query(`
    select
      count(*)::int as total,
      count(distinct external_id)::int as unique_external_ids,
      count(*) filter (where email is null or name = '' or company = '')::int as incomplete
    from public.mentees
    where source_system = 'clickup_clients'
  `);
  const breakdown = await client.query(`
    select product, status::text, count(*)::int as count
    from public.mentees
    where source_system = 'clickup_clients'
    group by product, status
    order by product, status
  `);
  const unexpected = await client.query(`
    select count(*)::int as count
    from public.mentees
    where source_system = 'clickup_clients'
      and product not in ('AE + AC', 'AC + AE', 'ATACADO EXPONENCIAL')
  `);

  console.log(JSON.stringify({ ...summary.rows[0], unexpected: unexpected.rows[0].count, breakdown: breakdown.rows }, null, 2));
  if (summary.rows[0].total !== 45 || summary.rows[0].unique_external_ids !== 45 || summary.rows[0].incomplete !== 0 || unexpected.rows[0].count !== 0) {
    throw new Error("A auditoria da importação encontrou divergências.");
  }
  console.log("Importação validada com sucesso.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Erro desconhecido");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
