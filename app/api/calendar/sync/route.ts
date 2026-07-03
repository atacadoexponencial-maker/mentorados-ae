import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { activeSyncWindow, configuredCalendarSources, listWorkspaceEvents } from "@/lib/google-calendar";
import { classifyMeetingFront, frontLabelToDb } from "@/lib/meeting-front";

export const runtime = "nodejs";

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function runCalendarSync() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Configuração do servidor incompleta.");

  const database = new pg.Client({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
  try {
    const window = activeSyncWindow();
    const events = await listWorkspaceEvents(window);
    await database.connect();
    const menteesResult = await database.query("select id, name, company, brand_aliases, lower(email) as email from public.mentees where status <> 'closed'");
    await database.query("begin");
    await database.query("create temp table current_calendar_sync_keys (calendar_id text, event_id text, primary key (calendar_id, event_id)) on commit drop");

    let individual = 0;
    let group = 0;
    let ignored = 0;
    for (const event of events) {
      const eventText = normalized(`${event.title} ${event.description}`);
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
      // "R1 ..."/"R2 ..." no início do título = reunião de venda (pré-cliente), não é mentoria.
      const ignoreByTitle = /(workshop\s+ae|reuni[aã]o\s+interna|daily\s+do\s+time|\balmo[cç]o\b|bloqueio\s+de\s+agenda|reuni[aã]o\s+comercial|1:1\s*\|)/i.test(event.title) || /^\s*r\d+\s/i.test(event.title);
      const groupByTitle = /(plant[aã]o\s+atacado\s+exponencial|mentoria\s+em\s+grupo|cl[ií]nica\s+de\s+vendas)/i.test(event.title);
      const menteeId = !ignoreByTitle && !groupByTitle && matches.length === 1 ? matches[0].id : null;
      if (ignoreByTitle || (!menteeId && !groupByTitle)) { ignored += 1; continue; }
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
          type = excluded.type,
          front = excluded.front,
          individual_mentee_id = excluded.individual_mentee_id
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
    const removed = await database.query(`
      delete from public.meetings meeting
      where meeting.google_event_id is not null
        and meeting.google_calendar_id = any($1::text[])
        and meeting.starts_at >= $2::timestamptz
        and meeting.starts_at <= $3::timestamptz
        and meeting.attendance_recorded_at is null
        and not exists (select 1 from public.meeting_participations participation where participation.meeting_id = meeting.id)
        and not exists (
          select 1 from current_calendar_sync_keys current_key
          where current_key.calendar_id = meeting.google_calendar_id
            and current_key.event_id = meeting.google_event_id
        )
    `, [configuredCalendarIds, window.timeMin, window.timeMax]);
    await database.query("commit");
    return { synced: individual + group, individual, group, ignored, removed: removed.rowCount ?? 0 };
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
    return NextResponse.json(await runCalendarSync());
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
    return NextResponse.json(await runCalendarSync());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
