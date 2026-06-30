import "server-only";
import { google, type calendar_v3 } from "googleapis";

const eventScope = "https://www.googleapis.com/auth/calendar.events.readonly";

function privateKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY não configurada.");
  if (raw.includes("BEGIN PRIVATE KEY")) return raw;
  return `-----BEGIN PRIVATE KEY-----\n${raw.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
}
export interface CalendarEventInput {
  calendarId: string;
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

export async function listWorkspaceEvents(): Promise<CalendarEventInput[]> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
  const subject = process.env.GOOGLE_WORKSPACE_SUBJECT;
  if (!email || !subject) throw new Error("Credenciais ou usuário delegado do Google incompletos.");

  const auth = new google.auth.JWT({ email, key: privateKey(), subject, scopes: [eventScope] });
  const calendar = google.calendar({ version: "v3", auth });
  const calendarIds = (process.env.GOOGLE_CALENDAR_IDS || "primary").split(",").map((id) => id.trim()).filter(Boolean);
  const timeMin = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const collected: CalendarEventInput[] = [];

  for (const calendarId of calendarIds) {
    let pageToken: string | undefined;
    do {
      const response = await calendar.events.list({ calendarId, timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: 250, pageToken });
      for (const event of response.data.items ?? []) {
        if (!event.id || event.status === "cancelled") continue;
        const start = eventDate(event.start, new Date());
        let end = eventDate(event.end, new Date(new Date(start).getTime() + 60 * 60 * 1000));
        if (new Date(end) <= new Date(start)) end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
        const videoEntry = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
        collected.push({
          calendarId,
          eventId: event.id,
          title: event.summary?.trim() || "Encontro sem título",
          description: event.description?.trim() || "",
          startsAt: start,
          endsAt: end,
          meetUrl: event.hangoutLink || videoEntry || null,
          attendeeEmails: (event.attendees ?? []).map((attendee) => attendee.email?.toLowerCase()).filter((value): value is string => Boolean(value)),
        });
      }
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
  }
  return collected;
}
