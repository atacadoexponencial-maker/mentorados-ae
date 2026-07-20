import "server-only";
import { google } from "googleapis";
import { workspaceJwt } from "./google-calendar";

// Cliente da Google Meet REST v2: dado o link/código do Meet de um encontro,
// devolve os participantes reais da reunião. A API do Meet só entrega
// signedinUser.user (id) + displayName — sem e-mail —, então o id é resolvido
// para e-mail via Admin SDK Directory. Consumido pelas issues 38/39.

const meetScope = "https://www.googleapis.com/auth/meetings.space.readonly";
const directoryScope = "https://www.googleapis.com/auth/admin.directory.user.readonly";

export interface MeetParticipant {
  displayName: string;
  email: string | null; // resolvido via Directory; null p/ anônimo, telefone ou falha de resolução
  kind: "signedin" | "anonymous" | "phone";
}

export type MeetParticipantsResult =
  | { status: "ok"; participants: MeetParticipant[] }
  | { status: "unavailable" }; // sem conference record ainda (ou reunião em andamento) → retry

// Extrai o código "abc-mnop-xyz" de uma URL do Meet, ignorando query/fragment.
export function meetingCodeFromUrl(meetUrl: string): string | null {
  const match = meetUrl.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  return match ? match[1].toLowerCase() : null;
}

function adminSubject(): string {
  const explicit = process.env.GOOGLE_WORKSPACE_ADMIN_SUBJECT?.trim();
  if (explicit) return explicit;
  // Fallback: primeiro subject configurado. Se não tiver privilégio de Directory,
  // a resolução falha por usuário e cai no fallback de displayName (e-mail nulo).
  const first = (process.env.GOOGLE_WORKSPACE_SUBJECTS || process.env.GOOGLE_WORKSPACE_SUBJECT || "")
    .split(",").map((v) => v.trim()).filter(Boolean)[0];
  if (!first) throw new Error("GOOGLE_WORKSPACE_ADMIN_SUBJECT ou GOOGLE_WORKSPACE_SUBJECTS nao configurado.");
  return first;
}

interface RawParticipant {
  userId: string | null;
  displayName: string;
  kind: "signedin" | "anonymous" | "phone";
}

export async function listMeetParticipants(input: {
  meetUrl: string;
  subject: string;
  startsAt: string;
  endsAt: string;
}): Promise<MeetParticipantsResult> {
  const code = meetingCodeFromUrl(input.meetUrl);
  if (!code) throw new Error(`meet_url sem codigo de reuniao reconhecivel: ${input.meetUrl}`);

  // O subject impersonado precisa ser host/participante da reunião (o mentor dono
  // do calendário do evento — google_calendar_id antes de "::").
  const meet = google.meet({ version: "v2", auth: workspaceJwt(input.subject, [meetScope]) });

  // Janela de start_time restringe records de outras ocorrências do mesmo link recorrente.
  const windowStart = new Date(new Date(input.startsAt).getTime() - 60 * 60 * 1000).toISOString();
  const filter = `space.meeting_code = "${code}" AND start_time >= "${windowStart}" AND start_time <= "${input.endsAt}"`;

  const records: Array<{ name: string; endTime: string | null | undefined }> = [];
  let pageToken: string | undefined;
  do {
    const response = await meet.conferenceRecords.list({ filter, pageSize: 100, pageToken });
    for (const record of response.data.conferenceRecords ?? []) {
      if (record.name) records.push({ name: record.name, endTime: record.endTime });
    }
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  if (records.length === 0) return { status: "unavailable" };
  // Reunião ainda aberta (record sem endTime) → lista incompleta, tenta de novo depois.
  if (records.some((record) => !record.endTime)) return { status: "unavailable" };

  const merged = new Map<string, RawParticipant>();
  for (const record of records) {
    let partToken: string | undefined;
    do {
      const response = await meet.conferenceRecords.participants.list({ parent: record.name, pageSize: 250, pageToken: partToken });
      for (const participant of response.data.participants ?? []) {
        if (participant.signedinUser?.user) {
          merged.set(`u:${participant.signedinUser.user}`, {
            userId: participant.signedinUser.user,
            displayName: participant.signedinUser.displayName || "",
            kind: "signedin",
          });
        } else if (participant.phoneUser) {
          const name = participant.phoneUser.displayName || "Telefone";
          merged.set(`p:${name}`, { userId: null, displayName: name, kind: "phone" });
        } else if (participant.anonymousUser) {
          const name = participant.anonymousUser.displayName || "Convidado";
          merged.set(`a:${name}`, { userId: null, displayName: name, kind: "anonymous" });
        }
      }
      partToken = response.data.nextPageToken || undefined;
    } while (partToken);
  }

  const emailByUserId = await resolveEmails(
    [...new Set([...merged.values()].map((p) => p.userId).filter((id): id is string => Boolean(id)))],
  );

  const participants: MeetParticipant[] = [...merged.values()].map((p) => ({
    displayName: p.displayName,
    email: p.userId ? emailByUserId.get(p.userId) ?? null : null,
    kind: p.kind,
  }));

  return { status: "ok", participants };
}

// Resolve ids de usuário do Meet para e-mail via Admin SDK Directory, memoizando
// por id. Falha isolada por usuário (externo ao domínio, sem privilégio) → sem e-mail.
async function resolveEmails(userIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (userIds.length === 0) return result;

  const directory = google.admin({ version: "directory_v1", auth: workspaceJwt(adminSubject(), [directoryScope]) });
  for (const userId of userIds) {
    try {
      const response = await directory.users.get({ userKey: userId });
      const email = response.data.primaryEmail?.toLowerCase();
      if (email) result.set(userId, email);
    } catch {
      // Usuário externo ao domínio, sem privilégio ou não encontrado → mantém sem e-mail.
    }
  }
  return result;
}
