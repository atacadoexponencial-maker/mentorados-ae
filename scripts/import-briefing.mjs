import fs from "node:fs/promises";
import process from "node:process";
import pg from "pg";

// Importa as respostas do formulário de briefing (JSON pré-convertido da planilha)
// e pré-preenche `mentee_briefing`, casando por nome da marca -> empresa.
// Não sobrescreve briefings já preenchidos pelo mentorado (import_review_pending = false).

process.loadEnvFile(".env.local");

const [inputPath] = process.argv.slice(2);
const connectionString = process.env.DATABASE_URL;
if (!inputPath) throw new Error("Informe o JSON de respostas do briefing.");
if (!connectionString) throw new Error("DATABASE_URL não configurada.");

// Ordem espelha lib/briefing-schema.ts (briefingFieldKeys).
const FIELDS = [
  "brand_name", "niche", "founding_year", "location", "physical_stores", "business_type",
  "employees_count", "marketing_team", "sales_team", "company_history", "main_sales_channel",
  "online_channels", "first_purchase_policy", "formality_policy", "ideal_customer_profiles",
  "primary_customer_profile", "recurring_customers_avg", "new_customers_avg", "repurchase_behavior",
  "base_sales_actions", "new_sales_actions", "collection_frequency", "launch_strategy",
  "marketing_difficulty", "paid_traffic", "whatsapp_leads_group", "whatsapp_customers_group",
  "acquisition_funnels",
];

const norm = (value) =>
  String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const { responses } = JSON.parse(await fs.readFile(inputPath, "utf8"));

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  const mentees = (await client.query("select id, company from public.mentees")).rows;
  const byCompany = new Map();
  for (const mentee of mentees) {
    const key = norm(mentee.company);
    if (!key) continue;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(mentee);
  }

  const cols = FIELDS.map((_, index) => `$${index + 2}`).join(", ");
  const setClause = FIELDS.map((key) => `${key} = excluded.${key}`).join(", ");
  const tsParam = FIELDS.length + 2;

  let prefilled = 0;
  let protectedSkips = 0;
  const unmatched = [];
  const ambiguous = [];

  await client.query("begin");
  for (const response of responses) {
    const brand = norm(response.brand_name);
    if (!brand) {
      unmatched.push(response.brand_name || "(sem nome)");
      continue;
    }
    let matches = byCompany.get(brand) ?? [];
    if (matches.length === 0) {
      matches = mentees.filter((mentee) => {
        const company = norm(mentee.company);
        return company && (company.includes(brand) || brand.includes(company));
      });
    }
    if (matches.length === 0) {
      unmatched.push(response.brand_name);
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push(response.brand_name);
      continue;
    }

    const values = [matches[0].id, ...FIELDS.map((key) => (response[key] == null ? null : String(response[key]))), response._timestamp ?? null];
    const result = await client.query(
      `insert into public.mentee_briefing (mentee_id, ${FIELDS.join(", ")}, status, import_review_pending, filled_at)
       values ($1, ${cols}, 'filled', true, coalesce($${tsParam}::timestamptz, now()))
       on conflict (mentee_id) do update set
         ${setClause}, status = 'filled', import_review_pending = true, filled_at = coalesce(excluded.filled_at, now())
       where public.mentee_briefing.status = 'pending' or public.mentee_briefing.import_review_pending = true`,
      values,
    );
    if ((result.rowCount ?? 0) > 0) prefilled += 1;
    else protectedSkips += 1;
  }
  await client.query("commit");

  console.log(`Pré-preenchidos: ${prefilled}`);
  if (protectedSkips) console.log(`Preservados (já preenchidos pelo mentorado): ${protectedSkips}`);
  console.log(`Sem correspondência (${unmatched.length}): ${unmatched.join(", ") || "—"}`);
  console.log(`Ambíguos (${ambiguous.length}): ${ambiguous.join(", ") || "—"}`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(`Falha na importação: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
