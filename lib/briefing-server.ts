import "server-only";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { briefingFieldKeys } from "@/lib/briefing-schema";

// Acesso de servidor ao briefing. O preenchimento público (por token) e a gestão
// do token rodam aqui, no backend, usando a conexão de servidor — nunca no frontend.

function connectionString() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL não configurada.");
  return value;
}

async function withDb<T>(run: (db: pg.Client) => Promise<T>): Promise<T> {
  const cs = connectionString();
  const db = new pg.Client({
    connectionString: cs,
    ssl: cs.includes("localhost") ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end().catch(() => undefined);
  }
}

export interface PublicBriefing {
  menteeName: string;
  company: string;
  status: "pending" | "filled";
  filledAt: string | null;
  answers: Record<string, string>;
}

export async function getBriefingByToken(token: string): Promise<PublicBriefing | null> {
  if (!token) return null;
  return withDb(async (db) => {
    const fieldList = briefingFieldKeys.map((key) => `b.${key}`).join(", ");
    const result = await db.query(
      `select b.status, b.filled_at, m.name as mentee_name, m.company, ${fieldList}
         from public.mentee_briefing b
         join public.mentees m on m.id = b.mentee_id
        where b.access_token = $1`,
      [token],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    const answers: Record<string, string> = {};
    for (const key of briefingFieldKeys) {
      if (row[key] != null) answers[key] = row[key];
    }
    return {
      menteeName: row.mentee_name,
      company: row.company,
      status: row.status,
      filledAt: row.filled_at,
      answers,
    };
  });
}

export async function saveBriefingByToken(token: string, answers: Record<string, unknown>): Promise<boolean> {
  if (!token) return false;
  // Aceita apenas as chaves conhecidas e normaliza os valores para texto.
  const updates: string[] = [];
  const values: unknown[] = [token];
  for (const key of briefingFieldKeys) {
    const value = answers?.[key];
    values.push(typeof value === "string" ? value : value == null ? null : String(value));
    updates.push(`${key} = $${values.length}`);
  }
  return withDb(async (db) => {
    const result = await db.query(
      `update public.mentee_briefing
          set ${updates.join(", ")}, status = 'filled', filled_at = now(), import_review_pending = false
        where access_token = $1`,
      values,
    );
    return (result.rowCount ?? 0) > 0;
  });
}

// Garante um registro de briefing para o mentorado e retorna o token de acesso.
// Quando `regenerate` é true, gera um novo token (invalidando o anterior).
export async function ensureBriefingToken(menteeId: string, regenerate = false): Promise<string> {
  const newToken = randomBytes(24).toString("base64url");
  return withDb(async (db) => {
    await db.query(
      `insert into public.mentee_briefing (mentee_id) values ($1) on conflict (mentee_id) do nothing`,
      [menteeId],
    );
    if (!regenerate) {
      const existing = await db.query(
        `select access_token from public.mentee_briefing where mentee_id = $1`,
        [menteeId],
      );
      const current = existing.rows[0]?.access_token as string | null | undefined;
      if (current) return current;
    }
    await db.query(
      `update public.mentee_briefing set access_token = $2 where mentee_id = $1`,
      [menteeId, newToken],
    );
    return newToken;
  });
}

export async function markBriefingReviewed(menteeId: string): Promise<void> {
  await withDb((db) =>
    db.query(`update public.mentee_briefing set import_review_pending = false where mentee_id = $1`, [menteeId]),
  );
}
