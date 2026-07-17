import process from "node:process";
import pg from "pg";
import { google } from "googleapis";

// Backfill de EXECUÇÃO ÚNICA dos encontros históricos do Google Calendar
// (2023-02-01 até agora − 24h, nunca invadindo a janela ativa do sync).
//
// As regras de matching/ignore/grupo/frente/upsert/mentor-auto são CÓPIA FIEL de:
//   - app/api/calendar/sync/route.ts  (normalização, regexes, matching, upsert, mentor auto)
//   - lib/meeting-front.ts            (classificação de frente)
//   - lib/google-calendar.ts          (auth JWT delegada, fontes, coleta paginada)
// Qualquer mudança nesses arquivos deve ser espelhada aqui se o script for reexecutado.
//
// O script NÃO executa limpeza de meetings, NÃO cria participações e NÃO altera
// attendance_recorded_at nem a última participação dos clientes.
// Pré-requisito de produção: issues 20 e 21 (proteção da limpeza e carga geral restrita)
// já em produção, senão o cron apaga o histórico.
// Execução: node scripts/backfill-calendar.mjs

process.loadEnvFile(".env.local");

// Validação de ambiente — mesmo bloco de scripts/sync-google-calendar.mjs:7-14
const connectionString = process.env.DATABASE_URL;
const email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
if (!connectionString || !email || !rawKey) throw new Error("Configuracao incompleta.");

// Chave privada — cópia de lib/google-calendar.ts (privateKey) / scripts/sync-google-calendar.mjs:12-14
const key = rawKey.includes("BEGIN PRIVATE KEY")
  ? rawKey
  : `-----BEGIN PRIVATE KEY-----\n${rawKey.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;

// Fontes configuradas — cópia de lib/google-calendar.ts (configuredSubjects/configuredCalendarIds/configuredCalendarSources)
function configuredSubjects() {
  const subjects = (process.env.GOOGLE_WORKSPACE_SUBJECTS || process.env.GOOGLE_WORKSPACE_SUBJECT || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(subjects)];
}

function configuredCalendarIds() {
  const calendarIds = (process.env.GOOGLE_CALENDAR_IDS || "primary")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return calendarIds.length > 0 ? [...new Set(calendarIds)] : ["primary"];
}

const sources = configuredSubjects().flatMap((subject) =>
  configuredCalendarIds().map((calendarId) => ({
    subject,
    calendarId,
    sourceId: `${subject}::${calendarId}`,
  })),
);

if (sources.length === 0) throw new Error("Nenhum usuario delegado configurado para o Google Calendar.");

// Normalização — cópia de app/api/calendar/sync/route.ts:9-11 (normalized)
const normalize = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Classificação de frente — cópia de lib/meeting-front.ts (classifyMeetingFront), já retornando
// o valor do enum do banco (colapsa classifyMeetingFront + frontLabelToDb, como scripts/sync-google-calendar.mjs:45-51)
const classifyMeetingFront = (title, description = "") => {
  const text = normalize(`${title} ${description}`);
  if (/(rede social|redes sociais|social media|instagram|conteudo)/.test(text)) return "redes_sociais";
  if (/(trafego|meta ads|google ads|midia paga|ads\b)/.test(text)) return "trafego";
  if (/(comercial|vendas|closer|pipeline)/.test(text)) return "comercial";
  return "estrategia";
};

// Data do evento com fallback — cópia de lib/google-calendar.ts (eventDate)
const eventDate = (value, fallback) => value?.dateTime
  ? new Date(value.dateTime).toISOString()
  : value?.date
    ? new Date(`${value.date}T00:00:00-03:00`).toISOString()
    : fallback.toISOString();

// Janela histórica (calculada uma única vez):
// timeMin fixo no início da operação; timeMax = agora − 24h, espelho exato de
// activeSyncWindow().timeMin (lib/google-calendar.ts:71-76) — o backfill termina
// exatamente onde a janela ativa do sync começa e nunca a invade.
const timeMin = "2023-02-01T00:00:00-03:00";
const timeMax = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

// Coleta paginada por fonte — cópia de lib/google-calendar.ts (listWorkspaceEvents),
// com contagem de eventos lidos por sourceId.
const events = [];
const eventsBySource = new Map();

for (const source of sources) {
  const auth = new google.auth.JWT({
    email,
    key,
    subject: source.subject,
    scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
  });
  const calendar = google.calendar({ version: "v3", auth });

  let sourceCount = 0;
  let pageToken;
  do {
    const response = await calendar.events.list({
      calendarId: source.calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
    });

    for (const event of response.data.items ?? []) {
      // Cancelados/sem id descartados na coleta. O lib (lib/google-calendar.ts) passou a usar
      // showDeleted: true e a separar as chaves canceladas para o delete conservador do sync;
      // o backfill segue descartando cancelados de propósito — não executa limpeza.
      if (!event.id || event.status === "cancelled") continue;
      const startsAt = eventDate(event.start, new Date());
      let endsAt = eventDate(event.end, new Date(new Date(startsAt).getTime() + 60 * 60 * 1000));
      if (new Date(endsAt) <= new Date(startsAt)) endsAt = new Date(new Date(startsAt).getTime() + 60 * 60 * 1000).toISOString();
      sourceCount += 1;
      events.push({
        calendarId: source.sourceId,
        delegatedSubject: source.subject,
        eventId: event.id,
        title: event.summary?.trim() || "Encontro sem titulo",
        description: event.description?.trim() || "",
        startsAt,
        endsAt,
        meetUrl: event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri || null,
        attendeeEmails: (event.attendees ?? []).map((attendee) => attendee.email?.toLowerCase()).filter(Boolean),
      });
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  eventsBySource.set(source.sourceId, sourceCount);
}

const database = new pg.Client({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
try {
  await database.connect();
  // Diferença INTENCIONAL ante o sync (route.ts:22): sem `where status <> 'closed'` —
  // o histórico pertence ao passado; cliente hoje encerrado tinha encontros quando era ativo.
  const mentees = await database.query("select id, name, company, brand_aliases, lower(email) as email, joined_at from public.mentees");
  await database.query("begin");
  await database.query("create temp table backfill_calendar_keys (calendar_id text, event_id text, primary key (calendar_id, event_id)) on commit drop");

  let individual = 0;
  let grupo = 0;
  let ignoradoPorRegra = 0;
  let semCorrespondencia = 0;
  let ambiguo = 0;
  let duplicado = 0;

  // O mesmo evento pode existir no calendário de 2+ mentores — cópia da regra do sync.
  const seenEvents = new Set();
  for (const event of events) {
    const dedupeKey = `${normalize(event.title)}|${event.startsAt}`;
    if (seenEvents.has(dedupeKey)) { duplicado += 1; continue; }
    seenEvents.add(dedupeKey);
    // Matching — cópia de app/api/calendar/sync/route.ts:30-41
    const eventText = normalize(`${event.title} ${event.description}`);
    const eventStart = new Date(event.startsAt).getTime();
    const matches = mentees.rows.filter((mentee) => {
      const emailMatch = mentee.email && event.attendeeEmails.includes(mentee.email);
      const name = normalize(mentee.name);
      const company = normalize(mentee.company);
      const companyMatch = company.length >= 4 && eventText.includes(company);
      // Apelido segue a MESMA regra da marca (identificador forte, sem joinedCutoff).
      const aliasMatch = (mentee.brand_aliases ?? []).some((alias) => {
        const a = normalize(alias);
        return a.length >= 4 && eventText.includes(a);
      });
      // Guarda de entrada SÓ para casamento por nome de pessoa: primeiro nome é ambíguo
      // (ex.: outra "Adriana" de 2024), então evento anterior à entrada do cliente
      // (folga de 30 dias) não casa por nome. E-mail, marca e apelidos são identificadores
      // fortes e valem para qualquer época — clientes com histórico anterior à entrada
      // registrada (renovações/datas aproximadas na planilha) mantêm o histórico completo.
      const joinedCutoff = new Date(mentee.joined_at).getTime() - 30 * 24 * 60 * 60 * 1000;
      const nameMatch = name.length >= 4 && eventText.includes(name) && eventStart >= joinedCutoff;
      return emailMatch || nameMatch || companyMatch || aliasMatch;
    });
    // Regexes de ignore e grupo — cópia fiel de app/api/calendar/sync/route.ts (ignoreByTitle/groupByTitle).
    // Regras da Marcelle (2026-07-03): R1/R2 = venda; EXT = externa operacional; CRM/Kommo = ferramenta;
    // Entrevista = seleção para o cliente. Nenhuma conta como mentoria.
    const ignoreByTitle = /(workshop\s+ae|reuni[aã]o\s+interna|daily\s+do\s+time|\balmo[cç]o\b|bloqueio\s+de\s+agenda|reuni[aã]o\s+comercial|1:1\s*\|)/i.test(event.title)
      || /^\s*r\d+\s/i.test(event.title)
      || /^\s*ext\s*\|/i.test(event.title)
      || /\bcrm\b/i.test(event.title)
      || /kommo/i.test(event.title)
      || /^\s*entrevistas?\b/i.test(event.title);
    const groupByTitle = /(plant[aã]o\s+atacado\s+exponencial|mentoria\s+em\s+grupo|cl[ií]nica\s+de\s+vendas)/i.test(event.title);
    const menteeId = !ignoreByTitle && !groupByTitle && matches.length === 1 ? matches[0].id : null;
    // Contadores separados (diferente do sync, que agrega tudo em `ignored`):
    // cada evento cai em exatamente um destino.
    if (ignoreByTitle) { ignoradoPorRegra += 1; continue; }
    if (!menteeId && !groupByTitle) {
      if (matches.length === 0) semCorrespondencia += 1; else ambiguo += 1;
      continue;
    }
    const type = menteeId ? "individual" : "group";
    const front = classifyMeetingFront(event.title, event.description);
    if (menteeId) individual += 1; else grupo += 1;

    await database.query("insert into backfill_calendar_keys (calendar_id, event_id) values ($1, $2) on conflict do nothing", [event.calendarId, event.eventId]);

    // Upsert — mesma identidade calendário+evento do sync (app/api/calendar/sync/route.ts):
    // reexecuções e convivência com o sync não duplicam. Divergência INTENCIONAL: o sync tem
    // uma guarda no ON CONFLICT que congela type/individual_mentee_id de meetings vinculadas a
    // mentorado closed; aqui ela não se aplica porque o universo de matching inclui closed
    // (query de mentees acima), então o vínculo nunca "sai do universo".
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

  // Vínculo automático de mentor — cópia APENAS do INSERT de app/api/calendar/sync/route.ts:85-104
  // (frente com exatamente um mentor, encontro sem nenhum vínculo, source = 'auto').
  // O DELETE de vínculos 'auto' divergentes do sync (route.ts:67-84) NÃO é replicado:
  // nenhum vínculo existente, automático ou manual, é removido ou alterado.
  await database.query(`
    insert into public.meeting_mentors (meeting_id, mentor_id, source)
    select meeting.id, front_mentor.mentor_id, 'auto'::public.mentor_link_source
    from public.meetings meeting
    join backfill_calendar_keys current_key
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
  await database.query("commit");

  // Relatório final
  console.log("Backfill concluído.");
  console.log(`Período coberto: ${timeMin} → ${timeMax}`);
  console.log("Eventos lidos por calendário:");
  for (const [sourceId, count] of eventsBySource) console.log(`  ${sourceId}: ${count}`);
  console.log(`Individuais criados/atualizados: ${individual}`);
  console.log(`Em grupo criados/atualizados: ${grupo}`);
  console.log(`Ignorados por regra de título: ${ignoradoPorRegra}`);
  console.log(`Sem correspondência: ${semCorrespondencia}`);
  console.log(`Ambíguos: ${ambiguo}`);
  console.log(`Duplicados entre calendários (pulados): ${duplicado}`);
} catch (error) {
  await database.query("rollback").catch(() => undefined);
  console.error(`Falha no backfill: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  process.exitCode = 1;
} finally {
  await database.end().catch(() => undefined);
}
