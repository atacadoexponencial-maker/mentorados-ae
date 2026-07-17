import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { activeSyncWindow, configuredCalendarSources, fetchEventStatus, listWorkspaceEvents } from "@/lib/google-calendar";
import { classifyMeetingFront, frontLabelToDb } from "@/lib/meeting-front";

export const runtime = "nodejs";

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function runCalendarSync(trigger: "cron" | "manual") {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Configuração do servidor incompleta.");

  const database = new pg.Client({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
  try {
    const window = activeSyncWindow();
    const { events, cancelledKeys } = await listWorkspaceEvents(window);
    await database.connect();
    // `status <> 'closed'` é INTENCIONAL e vale só para o matching de eventos novos: evento de
    // mentorado encerrado não vira meeting. Meetings já persistidas de closed são preservadas
    // pelo delete conservador (só apaga com evidência de cancelamento no Google) e pela guarda
    // de vínculo no ON CONFLICT do upsert abaixo.
    const menteesResult = await database.query("select id, name, company, brand_aliases, lower(email) as email from public.mentees where status <> 'closed'");
    await database.query("begin");
    await database.query("create temp table current_calendar_sync_keys (calendar_id text, event_id text, primary key (calendar_id, event_id)) on commit drop");
    // Todo evento ativo retornado pelo Google (antes do dedupe/matching/filtros) — evento que
    // existe mas não virou upsert nunca é candidato a deleção.
    await database.query("create temp table current_calendar_seen_keys (calendar_id text, event_id text, primary key (calendar_id, event_id)) on commit drop");
    // Eventos com status: cancelled — única evidência que autoriza delete direto.
    await database.query("create temp table current_calendar_cancelled_keys (calendar_id text, event_id text, primary key (calendar_id, event_id)) on commit drop");
    for (const key of cancelledKeys) {
      await database.query("insert into current_calendar_cancelled_keys (calendar_id, event_id) values ($1, $2) on conflict do nothing", [key.calendarId, key.eventId]);
    }

    let individual = 0;
    let group = 0;
    // Resumo de auditoria (issue 31): todo evento ignorado entra aqui com título, data e motivo.
    const ignoredEvents: { title: string; starts_at: string; reason: "duplicado" | "regra_de_negocio" | "sem_correspondencia" | "ambiguo"; matches?: string[] }[] = [];
    // O mesmo evento pode existir no calendário de 2+ mentores (convidados entre si);
    // sem isso, cada cópia viraria um encontro duplicado no banco.
    const seenEvents = new Set<string>();
    for (const event of events) {
      await database.query("insert into current_calendar_seen_keys (calendar_id, event_id) values ($1, $2) on conflict do nothing", [event.calendarId, event.eventId]);
      const eventText = normalized(`${event.title} ${event.description}`);
      const dedupeKey = `${normalized(event.title)}|${event.startsAt}`;
      if (seenEvents.has(dedupeKey)) { ignoredEvents.push({ title: event.title, starts_at: event.startsAt, reason: "duplicado" }); continue; }
      seenEvents.add(dedupeKey);
      const matches = menteesResult.rows.filter((mentee) => {
        const emailMatch = mentee.email && event.attendeeEmails.includes(mentee.email);
        const name = normalized(mentee.name);
        const company = normalized(mentee.company);
        // Apelido segue a MESMA regra da marca: normalizado, 4+ caracteres, contido no texto.
        const aliasMatch = ((mentee.brand_aliases ?? []) as string[]).some((alias) => {
          const a = normalized(alias);
          return a.length >= 4 && eventText.includes(a);
        });
        return emailMatch || (name.length >= 4 && eventText.includes(name)) || (company.length >= 4 && eventText.includes(company)) || aliasMatch;
      });
      // Regras da Marcelle (2026-07-03): "R1/R2 ..." = reunião de venda; "EXT ..." = reunião externa
      // operacional; CRM/Kommo = suporte de ferramenta; "Entrevista..." = seleção para o cliente.
      // Nenhuma delas conta como mentoria.
      const ignoreByTitle = /(workshop\s+ae|reuni[aã]o\s+interna|daily\s+do\s+time|\balmo[cç]o\b|bloqueio\s+de\s+agenda|reuni[aã]o\s+comercial|1:1\s*\|)/i.test(event.title)
        || /^\s*r\d+\s/i.test(event.title)
        || /^\s*ext\s*\|/i.test(event.title)
        || /\bcrm\b/i.test(event.title)
        || /kommo/i.test(event.title)
        || /^\s*entrevistas?\b/i.test(event.title);
      const groupByTitle = /(plant[aã]o\s+atacado\s+exponencial|mentoria\s+em\s+grupo|cl[ií]nica\s+de\s+vendas)/i.test(event.title);
      const menteeId = !ignoreByTitle && !groupByTitle && matches.length === 1 ? matches[0].id : null;
      if (ignoreByTitle || (!menteeId && !groupByTitle)) {
        if (ignoreByTitle) ignoredEvents.push({ title: event.title, starts_at: event.startsAt, reason: "regra_de_negocio" });
        else if (matches.length === 0) ignoredEvents.push({ title: event.title, starts_at: event.startsAt, reason: "sem_correspondencia" });
        else ignoredEvents.push({ title: event.title, starts_at: event.startsAt, reason: "ambiguo", matches: matches.map((mentee) => mentee.name as string) });
        continue;
      }
      const type = menteeId ? "individual" : "group";
      const front = frontLabelToDb(classifyMeetingFront(event.title, event.description));
      if (menteeId) individual += 1; else group += 1;

      await database.query("insert into current_calendar_sync_keys (calendar_id, event_id) values ($1, $2) on conflict do nothing", [event.calendarId, event.eventId]);

      await database.query(`
        insert into public.meetings (
          google_event_id, google_calendar_id, title, starts_at, ends_at,
          meet_url, type, front, individual_mentee_id
        ) values ($1, $2, $3, $4, $5, $6, $7::public.meeting_type, $8::public.meeting_front, $9)
        on conflict (google_calendar_id, google_event_id) do update set
          title = excluded.title,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          meet_url = excluded.meet_url,
          -- Guarda de preservação: meeting já vinculada a mentorado closed congela type e
          -- individual_mentee_id (com o closed fora do universo de matching, o mesmo evento
          -- poderia re-casar com outro mentorado ativo ou virar grupo). meetings.* referencia
          -- a linha existente dentro do ON CONFLICT.
          type = case
            when exists (select 1 from public.mentees m where m.id = meetings.individual_mentee_id and m.status = 'closed')
            then meetings.type else excluded.type end,
          front = excluded.front,
          individual_mentee_id = case
            when exists (select 1 from public.mentees m where m.id = meetings.individual_mentee_id and m.status = 'closed')
            then meetings.individual_mentee_id else excluded.individual_mentee_id end
      `, [event.eventId, event.calendarId, event.title, event.startsAt, event.endsAt, event.meetUrl, type, front, menteeId]);
    }
    await database.query(`
      delete from public.meeting_mentors link
      using public.meetings meeting
      where link.source = 'auto'
        and link.meeting_id = meeting.id
        and exists (
          select 1 from current_calendar_sync_keys current_key
          where current_key.calendar_id = meeting.google_calendar_id
            and current_key.event_id = meeting.google_event_id
        )
        and link.mentor_id is distinct from (
          select (array_agg(mentor.id))[1]
          from public.mentors mentor
          where mentor.front = meeting.front
          group by mentor.front
          having count(*) = 1
        )
    `);
    await database.query(`
      insert into public.meeting_mentors (meeting_id, mentor_id, source)
      select meeting.id, front_mentor.mentor_id, 'auto'::public.mentor_link_source
      from public.meetings meeting
      join current_calendar_sync_keys current_key
        on current_key.calendar_id = meeting.google_calendar_id
        and current_key.event_id = meeting.google_event_id
      join (
        select front, (array_agg(id))[1] as mentor_id
        from public.mentors
        where front is not null
        group by front
        having count(*) = 1
      ) front_mentor on front_mentor.front = meeting.front
      where not exists (
        select 1 from public.meeting_mentors existing_link
        where existing_link.meeting_id = meeting.id
      )
      on conflict do nothing
    `);
    const configuredCalendarIds = configuredCalendarSources().map((source) => source.sourceId);
    // Delete conservador 1/2: só apaga com evidência explícita de cancelamento no Google.
    const removedCancelled = await database.query(`
      delete from public.meetings meeting
      where meeting.google_event_id is not null
        and meeting.google_calendar_id = any($1::text[])
        and meeting.starts_at >= $2::timestamptz
        and meeting.starts_at <= $3::timestamptz
        and meeting.attendance_recorded_at is null
        and not exists (select 1 from public.meeting_participations participation where participation.meeting_id = meeting.id)
        and exists (
          select 1 from current_calendar_cancelled_keys cancelled_key
          where cancelled_key.calendar_id = meeting.google_calendar_id
            and cancelled_key.event_id = meeting.google_event_id
        )
      returning meeting.title, meeting.starts_at
    `, [configuredCalendarIds, window.timeMin, window.timeMax]);
    const removedEvents: { title: string; starts_at: string }[] = removedCancelled.rows.map((row) => ({ title: row.title as string, starts_at: new Date(row.starts_at).toISOString() }));
    // Delete conservador 2/2: meetings da janela que não apareceram nem entre os ativos nem
    // entre os cancelados (candidatas a série apagada/evento movido) — verificadas uma a uma
    // via events.get APÓS o commit. Selecionadas aqui porque as temp tables somem no commit.
    const verificationCandidates = await database.query(`
      select meeting.id, meeting.google_calendar_id, meeting.google_event_id
      from public.meetings meeting
      where meeting.google_event_id is not null
        and meeting.google_calendar_id = any($1::text[])
        and meeting.starts_at >= $2::timestamptz
        and meeting.starts_at <= $3::timestamptz
        and meeting.attendance_recorded_at is null
        and not exists (select 1 from public.meeting_participations participation where participation.meeting_id = meeting.id)
        and not exists (
          select 1 from current_calendar_seen_keys seen_key
          where seen_key.calendar_id = meeting.google_calendar_id
            and seen_key.event_id = meeting.google_event_id
        )
        and not exists (
          select 1 from current_calendar_cancelled_keys cancelled_key
          where cancelled_key.calendar_id = meeting.google_calendar_id
            and cancelled_key.event_id = meeting.google_event_id
        )
    `, [configuredCalendarIds, window.timeMin, window.timeMax]);
    await database.query("commit");

    let removedVerified = 0;
    let kept = 0;
    const sources = configuredCalendarSources();
    for (const candidate of verificationCandidates.rows) {
      const source = sources.find((s) => s.sourceId === candidate.google_calendar_id);
      // Sem source configurada, não há como verificar — manter.
      if (!source) { kept += 1; continue; }
      try {
        const status = await fetchEventStatus(source.subject, source.calendarId, candidate.google_event_id);
        if (status === "cancelled" || status === "missing") {
          // Delete individual re-checa as guardas (participação pode ter surgido após o commit).
          const deleted = await database.query(`
            delete from public.meetings meeting
            where meeting.id = $1
              and meeting.attendance_recorded_at is null
              and not exists (select 1 from public.meeting_participations participation where participation.meeting_id = meeting.id)
            returning meeting.title, meeting.starts_at
          `, [candidate.id]);
          if ((deleted.rowCount ?? 0) > 0) { removedVerified += 1; removedEvents.push({ title: deleted.rows[0].title as string, starts_at: new Date(deleted.rows[0].starts_at).toISOString() }); } else kept += 1;
        } else {
          // Evento existe ativo (ex.: movido para fora da janela) → manter sempre.
          kept += 1;
        }
      } catch (error) {
        // Falha de rede/quota na verificação nunca apaga nem derruba o sync.
        console.error("Falha ao verificar evento no Google; meeting mantida.", candidate.google_calendar_id, candidate.google_event_id, error);
        kept += 1;
      }
    }
    const removed = (removedCancelled.rowCount ?? 0) + removedVerified;
    // Log de auditoria (issue 31): gravado após a fase de verificação pós-commit para incluir
    // também os removidos por ela. Falha antes do commit faz rollback sem gravar linha.
    await database.query(`
      insert into public.calendar_sync_runs (trigger, synced, individual_total, group_total, ignored_total, removed_total, ignored_events, removed_events)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
    `, [trigger, individual + group, individual, group, ignoredEvents.length, removed, JSON.stringify(ignoredEvents), JSON.stringify(removedEvents)]);
    return { synced: individual + group, individual, group, ignored: ignoredEvents.length, removed, kept, ignoredEvents, removedEvents };
  } catch (error) {
    await database.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await database.end().catch(() => undefined);
  }
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

  try {
    return NextResponse.json(await runCalendarSync("manual"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Gatilho do cron da Vercel (GET horário) — autenticado por CRON_SECRET, não por sessão da equipe.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  try {
    return NextResponse.json(await runCalendarSync("cron"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
