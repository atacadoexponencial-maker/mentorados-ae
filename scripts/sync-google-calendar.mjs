import process from "node:process";
import pg from "pg";
import { google } from "googleapis";

process.loadEnvFile(".env.local");

const connectionString = process.env.DATABASE_URL;
const email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
const subject = process.env.GOOGLE_WORKSPACE_SUBJECT;
const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
if (!connectionString || !email || !subject || !rawKey) throw new Error("Configuração incompleta.");

const key = rawKey.includes("BEGIN PRIVATE KEY")
  ? rawKey
  : `-----BEGIN PRIVATE KEY-----\n${rawKey.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
const calendarIds = (process.env.GOOGLE_CALENDAR_IDS || "primary").split(",").map((id) => id.trim()).filter(Boolean);
const auth = new google.auth.JWT({ email, key, subject, scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"] });
const calendar = google.calendar({ version: "v3", auth });

const normalize = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const eventDate = (value, fallback) => value?.dateTime
  ? new Date(value.dateTime).toISOString()
  : value?.date
    ? new Date(`${value.date}T00:00:00-03:00`).toISOString()
    : fallback.toISOString();

const timeMin = new Date(Date.now() - 86400000).toISOString();
const timeMax = new Date(Date.now() + 90 * 86400000).toISOString();
const events = [];

for (const calendarId of calendarIds) {
  let pageToken;
  do {
    const response = await calendar.events.list({ calendarId, timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: 250, pageToken });
    for (const event of response.data.items ?? []) {
      if (!event.id || event.status === "cancelled") continue;
      const startsAt = eventDate(event.start, new Date());
      let endsAt = eventDate(event.end, new Date(new Date(startsAt).getTime() + 3600000));
      if (new Date(endsAt) <= new Date(startsAt)) endsAt = new Date(new Date(startsAt).getTime() + 3600000).toISOString();
      events.push({
        calendarId,
        eventId: event.id,
        title: event.summary?.trim() || "Encontro sem título",
        description: event.description?.trim() || "",
        startsAt,
        endsAt,
        meetUrl: event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri || null,
        attendeeEmails: (event.attendees ?? []).map((attendee) => attendee.email?.toLowerCase()).filter(Boolean),
      });
    }
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);
}

const database = new pg.Client({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
try {
  await database.connect();
  const mentees = await database.query("select id, name, company, lower(email) as email from public.mentees where status <> 'closed'");
  await database.query("begin");
  await database.query("create temp table current_calendar_sync_keys (calendar_id text, event_id text, primary key (calendar_id, event_id)) on commit drop");
  let individual = 0;
  let group = 0;
  let ignored = 0;

  for (const event of events) {
    const text = normalize(`${event.title} ${event.description}`);
    const matches = mentees.rows.filter((mentee) => {
      const name = normalize(mentee.name);
      const company = normalize(mentee.company);
      return (mentee.email && event.attendeeEmails.includes(mentee.email)) ||
        (name.length >= 4 && text.includes(name)) ||
        (company.length >= 4 && text.includes(company));
    });
    const ignoreByTitle = /(workshop\s+ae|reuni[aã]o\s+interna|daily\s+do\s+time|\balmo[cç]o\b|bloqueio\s+de\s+agenda|reuni[aã]o\s+comercial)/i.test(event.title);
    const groupByTitle = /(plant[aã]o\s+atacado\s+exponencial|mentoria\s+em\s+grupo|cl[ií]nica\s+de\s+vendas)/i.test(event.title);
    const menteeId = !ignoreByTitle && !groupByTitle && matches.length === 1 ? matches[0].id : null;
    if (ignoreByTitle || (!menteeId && !groupByTitle)) { ignored += 1; continue; }
    const type = menteeId ? "individual" : "group";
    if (menteeId) individual += 1; else group += 1;

    await database.query("insert into current_calendar_sync_keys (calendar_id, event_id) values ($1, $2) on conflict do nothing", [event.calendarId, event.eventId]);

    await database.query(`
      insert into public.meetings (
        google_event_id, google_calendar_id, title, starts_at, ends_at,
        meet_url, type, individual_mentee_id
      ) values ($1, $2, $3, $4, $5, $6, $7::public.meeting_type, $8)
      on conflict (google_calendar_id, google_event_id) do update set
        title = excluded.title,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        meet_url = excluded.meet_url,
        type = excluded.type,
        individual_mentee_id = excluded.individual_mentee_id
    `, [event.eventId, event.calendarId, event.title, event.startsAt, event.endsAt, event.meetUrl, type, menteeId]);
  }
  const removed = await database.query(`
    delete from public.meetings meeting
    where meeting.google_event_id is not null
      and meeting.google_calendar_id = any($1::text[])
      and meeting.attendance_recorded_at is null
      and not exists (select 1 from public.meeting_participations participation where participation.meeting_id = meeting.id)
      and not exists (
        select 1 from current_calendar_sync_keys current_key
        where current_key.calendar_id = meeting.google_calendar_id
          and current_key.event_id = meeting.google_event_id
      )
  `, [calendarIds]);
  await database.query("commit");

  const audit = await database.query(`
    select
      count(*) filter (where google_event_id is not null)::int as synced_events,
      count(*) filter (where attendance_recorded_at is not null)::int as auto_attendance,
      (select count(*)::int from public.meeting_participations) as participations
    from public.meetings
  `);
  console.log(JSON.stringify({ fetched: events.length, individual, group, ignored, removed: removed.rowCount ?? 0, ...audit.rows[0] }, null, 2));
  if (audit.rows[0].auto_attendance !== 0 || audit.rows[0].participations !== 0) throw new Error("Auditoria detectou presença inesperada.");
  console.log("Sincronização concluída sem registrar presença.");
} catch (error) {
  await database.query("rollback").catch(() => undefined);
  console.error(error instanceof Error ? error.message : "Erro desconhecido");
  process.exitCode = 1;
} finally {
  await database.end().catch(() => undefined);
}
