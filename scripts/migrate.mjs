import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

process.loadEnvFile(".env.local");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL não configurada em .env.local");

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  await client.query("begin");
  await client.query("create schema if not exists app_private");
  await client.query(`
    create table if not exists app_private.schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  let applied = 0;
  for (const migrationFile of migrationFiles) {
    const migrationId = path.basename(migrationFile, ".sql");
    const existing = await client.query(
      "select 1 from app_private.schema_migrations where id = $1",
      [migrationId],
    );
    if (existing.rowCount > 0) continue;

    const sql = await readFile(new URL(migrationFile, migrationsDirectory), "utf8");
    await client.query(sql);
    await client.query(
      "insert into app_private.schema_migrations (id) values ($1)",
      [migrationId],
    );
    applied += 1;
  }

  await client.query("commit");
  console.log(applied ? `${applied} migration(s) aplicada(s) com sucesso.` : "Migrations já estavam aplicadas.");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(`Falha ao aplicar migration: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
