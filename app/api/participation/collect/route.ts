import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { collectMeetingParticipation } from "@/lib/auto-participation-server";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PER_RUN = 25;
const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 30;

interface CollectSummary {
  scanned: number;
  collected: number;
  pending: number;
  failed: number;
}

// Varre encontros encerrados com link do Meet, sem confirmação manual e sem coleta
// automática concluída, e executa o registro automático (lib/auto-participation-server).
// Coleta concluída = attendance_recorded_at preenchido (a issue 38 o grava no sucesso);
// isso também exclui confirmações manuais. auto_collect_last_attempt_at faz o retry.
async function runParticipationCollect(windowDays: number): Promise<CollectSummary> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Configuração do servidor incompleta.");

  const database = new pg.Client({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
  await database.connect();

  let candidates: Array<{ id: string }>;
  try {
    const result = await database.query(
      `select id from public.meetings
        where meet_url is not null and meet_url <> ''
          and ends_at <= now() - interval '15 minutes'
          and ends_at >= now() - ($1 || ' days')::interval
          and attendance_recorded_at is null
          and (auto_collect_last_attempt_at is null or auto_collect_last_attempt_at < now() - interval '2 hours')
        order by auto_collect_last_attempt_at asc nulls first, ends_at asc
        limit ${MAX_PER_RUN}`,
      [String(windowDays)],
    );
    candidates = result.rows;
    // Marca a tentativa no início (evita hot-loop se o processo morrer no meio do run).
    if (candidates.length > 0) {
      await database.query(
        "update public.meetings set auto_collect_last_attempt_at = now() where id = any($1::uuid[])",
        [candidates.map((row) => row.id)],
      );
    }
  } finally {
    await database.end().catch(() => undefined);
  }

  const summary: CollectSummary = { scanned: candidates.length, collected: 0, pending: 0, failed: 0 };
  // Cada coleta abre sua própria conexão/transação (lib/auto-participation-server).
  for (const { id } of candidates) {
    try {
      const result = await collectMeetingParticipation(id);
      if (result.status === "recorded") summary.collected++;
      else if (result.status === "unavailable") summary.pending++;
      else if (result.status === "error") { summary.failed++; console.error(`Coleta de participação falhou (${id}):`, result.message); }
      // skipped_manual / skipped_not_eligible: encontro deixou de ser elegível entre a query e a coleta — ignorado no resumo.
    } catch (error) {
      summary.failed++;
      console.error(`Coleta de participação lançou exceção (${id}):`, error);
    }
  }
  return summary;
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return NextResponse.json({ error: "Configuração do servidor incompleta." }, { status: 500 });

  const authClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  // Backfill manual pós-deploy: ?days=N com cap em 30.
  const daysParam = Number(request.nextUrl.searchParams.get("days"));
  const windowDays = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, MAX_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;

  try {
    return NextResponse.json(await runParticipationCollect(windowDays));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Gatilho do cron da Vercel — autenticado por CRON_SECRET. Ignora ?days e usa a janela padrão.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  try {
    return NextResponse.json(await runParticipationCollect(DEFAULT_WINDOW_DAYS));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
