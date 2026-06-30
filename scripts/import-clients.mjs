import fs from "node:fs/promises";
import process from "node:process";
import pg from "pg";

process.loadEnvFile(".env.local");

const [inputPath] = process.argv.slice(2);
const connectionString = process.env.DATABASE_URL;
if (!inputPath) throw new Error("Informe o JSON filtrado.");
if (!connectionString) throw new Error("DATABASE_URL não configurada.");

const { filtered } = JSON.parse(await fs.readFile(inputPath, "utf8"));

const field = (record, fragment) => {
  const key = Object.keys(record).find((candidate) => candidate.includes(fragment));
  return record[key];
};
const clean = (value) => String(value ?? "").trim() || null;
const excelDate = (value) => {
  if (!value) return null;
  if (typeof value === "number") {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};
const statusFor = (value) => String(value ?? "").trim().toUpperCase() === "EM PAUSA" ? "paused" : "active";
const accents = ["#c98c69", "#748b7c", "#b98b5f", "#657f8f", "#9a7182", "#817b63", "#708b88"];

const records = filtered.map((record, index) => ({
  externalId: clean(record["Task ID"]),
  name: clean(field(record, "Nome")),
  company: clean(record["Task Name"]),
  product: clean(field(record, "Produto")),
  email: clean(field(record, "E-mail"))?.toLowerCase(),
  joinedAt: excelDate(record["Ativo (date)"] ?? record["Start Date"]),
  contractEndAt: excelDate(record["Due Date"]),
  status: statusFor(record.Status),
  bonus: clean(field(record, "Bônus")),
  instagramUrl: clean(record["Instagram (url)"]),
  mediaPlanUrl: clean(field(record, "Plano de Mídia")),
  folderUrl: clean(record["Pasta (url)"]),
  accent: accents[index % accents.length],
  sourceData: {
    clickup_status: clean(record.Status),
    comment_count: record["Comment Count"] ?? null,
    participations: record["Participações"] ?? null,
    imported_from: "Sete Aceleradora - 2 OPERACIONAL - Clientes.xlsx",
  },
}));

const invalid = records.filter((record) => !record.externalId || !record.name || !record.company);
if (invalid.length) throw new Error(`${invalid.length} registro(s) sem ID, nome ou empresa.`);

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  await client.query("begin");
  for (const record of records) {
    await client.query(`
      insert into public.mentees (
        name, company, role, joined_at, briefing, status, risk, risk_reason,
        next_action, accent, email, product, source_system, external_id,
        instagram_url, media_plan_url, folder_url, bonus, contract_end_at, source_data
      ) values (
        $1, $2, null, $3, '', $4::public.mentee_status, 'low', '',
        '', $5, $6, $7, 'clickup_clients', $8,
        $9, $10, $11, $12, $13, $14::jsonb
      )
      on conflict (source_system, external_id) do update set
        name = excluded.name,
        company = excluded.company,
        joined_at = excluded.joined_at,
        status = excluded.status,
        email = excluded.email,
        product = excluded.product,
        instagram_url = excluded.instagram_url,
        media_plan_url = excluded.media_plan_url,
        folder_url = excluded.folder_url,
        bonus = excluded.bonus,
        contract_end_at = excluded.contract_end_at,
        source_data = excluded.source_data
    `, [
      record.name, record.company, record.joinedAt, record.status, record.accent,
      record.email, record.product, record.externalId, record.instagramUrl,
      record.mediaPlanUrl, record.folderUrl, record.bonus, record.contractEndAt,
      JSON.stringify(record.sourceData),
    ]);
  }
  await client.query("commit");
  console.log(`${records.length} cliente(s) importado(s) ou atualizado(s).`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(`Falha na importação: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
