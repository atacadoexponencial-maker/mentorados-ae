import process from "node:process";
import { google } from "googleapis";

process.loadEnvFile(".env.local");

const email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
const key = rawKey?.includes("BEGIN PRIVATE KEY")
  ? rawKey
  : `-----BEGIN PRIVATE KEY-----\n${rawKey?.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;

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

const subjects = configuredSubjects();
const calendarIds = configuredCalendarIds();

if (!email || !key || subjects.length === 0) throw new Error("Credenciais Google incompletas.");

try {
  const results = [];

  for (const subject of subjects) {
    const auth = new google.auth.JWT({
      email,
      key,
      subject,
      scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    });
    const calendar = google.calendar({ version: "v3", auth });

    for (const calendarId of calendarIds) {
      const response = await calendar.events.list({
        calendarId,
        timeMin: new Date(Date.now() - 7 * 86400000).toISOString(),
        maxResults: 1,
        singleEvents: true,
        orderBy: "startTime",
      });

      results.push({
        subject,
        calendarId,
        sourceId: `${subject}::${calendarId}`,
        accessible: true,
        sampleEvents: response.data.items?.length ?? 0,
      });
    }
  }

  console.log(JSON.stringify({ delegatedSubjectsConfigured: subjects.length, calendars: results }, null, 2));
  console.log("Google Calendar validado com sucesso.");
} catch (error) {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`Falha ao validar Google Calendar: ${message}`);
  process.exitCode = 1;
}
