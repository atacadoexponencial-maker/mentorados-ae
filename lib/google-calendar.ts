import "server-only";
import { google, type calendar_v3 } from "googleapis";

const eventScope = "https://www.googleapis.com/auth/calendar.events.readonly";

interface CalendarSource {
  subject: string;
  calendarId: string;
  sourceId: string;
}

function privateKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY nao configurada.");
  if (raw.includes("BEGIN PRIVATE KEY")) return raw;
  return `-----BEGIN PRIVATE KEY-----\n${raw.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

// JWT de service account com domain-wide delegation, impersonando `subject`.
// Reutilizado pelo cliente do Google Meet (lib/google-meet.ts).
export function workspaceJwt(subject: string, scopes: string[]) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
  if (!email) throw new Error("GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL nao configurado.");
  return new google.auth.JWT({ email, key: privateKey(), subject, scopes });
}

function configuredSubjects() {
  const subjects = (process.env.GOOGLE_WORKSPACE_SUBJECTS || process.env.GOOGLE_WORKSPACE_SUBJECT || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (subjects.length === 0) throw new Error("GOOGLE_WORKSPACE_SUBJECT ou GOOGLE_WORKSPACE_SUBJECTS nao configurado.");
  return [...new Set(subjects)];
}

function configuredCalendarIds() {
  const calendarIds = (process.env.GOOGLE_CALENDAR_IDS || "primary")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return calendarIds.length > 0 ? [...new Set(calendarIds)] : ["primary"];
}

export function configuredCalendarSources(): CalendarSource[] {
  return configuredSubjects().flatMap((subject) =>
    configuredCalendarIds().map((calendarId) => ({
      subject,
      calendarId,
      sourceId: `${subject}::${calendarId}`,
    })),
  );
}

export interface CalendarEventInput {
  calendarId: string;
  delegatedSubject: string;
  eventId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  meetUrl: string | null;
  attendeeEmails: string[];
}

function eventDate(value: calendar_v3.Schema$EventDateTime | undefined, fallback: Date) {
  if (value?.dateTime) return new Date(value.dateTime).toISOString();
  if (value?.date) return new Date(`${value.date}T00:00:00-03:00`).toISOString();
  return fallback.toISOString();
}

export interface SyncWindow {
  timeMin: string;
  timeMax: string;
}

export function activeSyncWindow(): SyncWindow {
  return {
    timeMin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export interface CancelledEventKey {
  calendarId: string;
  eventId: string;
}

export async function listWorkspaceEvents(window: SyncWindow = activeSyncWindow()): Promise<{ events: CalendarEventInput[]; cancelledKeys: CancelledEventKey[] }> {
  const sources = configuredCalendarSources();
  const collected: CalendarEventInput[] = [];
  const cancelledKeys: CancelledEventKey[] = [];

  for (const source of sources) {
    const auth = workspaceJwt(source.subject, [eventScope]);
    const calendar = google.calendar({ version: "v3", auth });

    let pageToken: string | undefined;
    do {
      const response = await calendar.events.list({
        calendarId: source.calendarId,
        timeMin: window.timeMin,
        timeMax: window.timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        showDeleted: true,
        pageToken,
      });

      for (const event of response.data.items ?? []) {
        if (!event.id) continue;
        if (event.status === "cancelled") {
          // Evidência positiva de cancelamento: só a chave importa (payload mínimo do Google).
          cancelledKeys.push({ calendarId: source.sourceId, eventId: event.id });
          continue;
        }
        const start = eventDate(event.start, new Date());
        let end = eventDate(event.end, new Date(new Date(start).getTime() + 60 * 60 * 1000));
        if (new Date(end) <= new Date(start)) end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
        const videoEntry = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;

        collected.push({
          calendarId: source.sourceId,
          delegatedSubject: source.subject,
          eventId: event.id,
          title: event.summary?.trim() || "Encontro sem titulo",
          description: event.description?.trim() || "",
          startsAt: start,
          endsAt: end,
          meetUrl: event.hangoutLink || videoEntry || null,
          attendeeEmails: (event.attendees ?? [])
            .map((attendee) => attendee.email?.toLowerCase())
            .filter((value): value is string => Boolean(value)),
        });
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
  }

  return { events: collected, cancelledKeys };
}

// Verifica um evento individualmente — usado pelo delete conservador do sync para
// confirmar cancelamento quando o evento sumiu da listagem (ex.: série apagada inteira).
export async function fetchEventStatus(subject: string, calendarId: string, eventId: string): Promise<"active" | "cancelled" | "missing"> {
  const auth = workspaceJwt(subject, [eventScope]);
  const calendar = google.calendar({ version: "v3", auth });

  try {
    const response = await calendar.events.get({ calendarId, eventId });
    return response.data.status === "cancelled" ? "cancelled" : "active";
  } catch (error) {
    const status = (error as { code?: number; response?: { status?: number } }).code
      ?? (error as { response?: { status?: number } }).response?.status;
    if (status === 404 || status === 410) return "missing";
    throw error;
  }
}
