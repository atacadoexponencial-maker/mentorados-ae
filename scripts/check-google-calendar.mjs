import process from "node:process";
import { google } from "googleapis";

process.loadEnvFile(".env.local");

const email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
const key = rawKey?.includes("BEGIN PRIVATE KEY")
  ? rawKey
  : `-----BEGIN PRIVATE KEY-----\n${rawKey?.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
const subject = process.env.GOOGLE_WORKSPACE_SUBJECT;
const calendarIds = (process.env.GOOGLE_CALENDAR_IDS || "primary").split(",").map((id) => id.trim()).filter(Boolean);

if (!email || !key || !subject) throw new Error("Credenciais Google incompletas.");

const auth = new google.auth.JWT({
  email,
  key,
  subject,
  scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
});
const calendar = google.calendar({ version: "v3", auth });

try {
  const results = [];
  for (const calendarId of calendarIds) {
    const response = await calendar.events.list({
      calendarId,
      timeMin: new Date(Date.now() - 7 * 86400000).toISOString(),
      maxResults: 1,
      singleEvents: true,
      orderBy: "startTime",
    });
    results.push({ calendar: calendarId === "primary" ? "primary" : "configured", accessible: true, sampleEvents: response.data.items?.length ?? 0 });
  }
  console.log(JSON.stringify({ delegatedSubjectConfigured: true, calendars: results }, null, 2));
  console.log("Google Calendar validado com sucesso.");
} catch (error) {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`Falha ao validar Google Calendar: ${message}`);
  process.exitCode = 1;
}
