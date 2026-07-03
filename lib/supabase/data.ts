import type { Achievement, Meeting, Mentee, Mentor, Risk } from "@/lib/types";
import { frontDbToLabel, type MeetingFront } from "@/lib/meeting-front";
import { briefingFieldKeys } from "@/lib/briefing-schema";
import { getSupabaseBrowserClient } from "./client";
import type { AchievementRow, BriefingRow, MaterialRow, MenteeRow, MentorRow, MeetingRow } from "./database.types";

const statusFromDb = { active: "Ativo", paused: "Pausado", closed: "Encerrado" } as const;
const statusToDb = { Ativo: "active", Pausado: "paused", Encerrado: "closed" } as const;
const riskFromDb = { low: "Baixo", medium: "Médio", high: "Alto" } as const;
const riskToDb = { Baixo: "low", Médio: "medium", Alto: "high" } as const;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function mapMentor(row: MentorRow): Mentor {
  return { id: row.id, name: row.name, initials: initials(row.name), color: row.color, contact: row.email };
}

function mapMentee(row: MenteeRow): Mentee {
  return {
    id: row.id,
    name: row.name,
    initials: initials(row.name),
    company: row.company,
    role: row.role || row.product || "Cliente",
    joinedAt: row.joined_at,
    briefing: row.briefing,
    status: statusFromDb[row.status],
    risk: riskFromDb[row.risk],
    riskReason: row.risk_reason,
    nextAction: row.next_action,
    lastParticipation: row.last_participation_at?.slice(0, 10) || row.joined_at,
    accent: row.accent,
    email: row.email ?? undefined,
    product: row.product ?? undefined,
    instagramUrl: row.instagram_url ?? undefined,
    folderUrl: row.folder_url ?? undefined,
    brandAliases: row.brand_aliases,
  };
}

function mapMeeting(row: MeetingRow, links: Array<{ mentorId: string; source: "auto" | "manual" }>): Meeting {
  return {
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    duration: Math.max(1, Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000)),
    meetUrl: row.meet_url || "#",
    mentorIds: links.map((link) => link.mentorId),
    mentorSource: links.length === 0 ? null : links.some((link) => link.source === "manual") ? "manual" : "auto",
    type: row.type === "individual" ? "Individual" : "Grupo",
    front: frontDbToLabel(row.front),
    menteeIds: row.individual_mentee_id ? [row.individual_mentee_id] : [],
    attendanceRecorded: Boolean(row.attendance_recorded_at),
  };
}

function meetingKey(meeting: Meeting) {
  return [
    meeting.title.trim().toLowerCase(),
    meeting.startsAt,
    meeting.duration,
    meeting.type,
    meeting.menteeIds.join(","),
  ].join("|");
}

function mapAchievement(row: AchievementRow): Achievement {
  return { id: row.id, menteeId: row.mentee_id, date: row.achieved_at, title: row.title, note: row.note, icon: "trophy" };
}

function assertNoError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadAppData() {
  const supabase = getSupabaseBrowserClient();
  // Mesma borda inferior da janela ativa do sync (activeSyncWindow() em lib/google-calendar.ts).
  const activeWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [mentorsResult, menteesResult, meetingsResult, meetingMentorsResult, achievementsResult] = await Promise.all([
    supabase.from("mentors").select("*").order("name"),
    supabase.from("mentees").select("*").order("name"),
    supabase.from("meetings").select("*").gte("starts_at", activeWindowStart).order("starts_at"),
    supabase.from("meeting_mentors").select("meeting_id, mentor_id, source, meetings!inner(starts_at)").gte("meetings.starts_at", activeWindowStart),
    supabase.from("achievements").select("*").order("achieved_at", { ascending: false }),
  ]);
  [mentorsResult, menteesResult, meetingsResult, meetingMentorsResult, achievementsResult].forEach((result) => assertNoError(result.error));

  const meetingMentors = new Map<string, Array<{ mentorId: string; source: "auto" | "manual" }>>();
  const meetingLinks = (meetingMentorsResult.data ?? []) as Array<{ meeting_id: string; mentor_id: string; source: "auto" | "manual" }>;
  for (const link of meetingLinks) meetingMentors.set(link.meeting_id, [...(meetingMentors.get(link.meeting_id) ?? []), { mentorId: link.mentor_id, source: link.source }]);

  const dedupedMeetings = new Map<string, Meeting>();
  for (const row of (meetingsResult.data ?? []) as MeetingRow[]) {
    const meeting = mapMeeting(row, meetingMentors.get(row.id) ?? []);
    const key = meetingKey(meeting);
    const existing = dedupedMeetings.get(key);
    if (!existing) {
      dedupedMeetings.set(key, meeting);
      continue;
    }
    existing.mentorIds = [...new Set([...existing.mentorIds, ...meeting.mentorIds])];
    existing.mentorSource = existing.mentorSource === "manual" || meeting.mentorSource === "manual" ? "manual" : (existing.mentorSource ?? meeting.mentorSource);
  }

  return {
    mentors: ((mentorsResult.data ?? []) as MentorRow[]).map(mapMentor),
    mentees: ((menteesResult.data ?? []) as MenteeRow[]).map(mapMentee),
    meetings: [...dedupedMeetings.values()].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    achievements: ((achievementsResult.data ?? []) as AchievementRow[]).map(mapAchievement),
  };
}

export async function createMentee(input: Mentee) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.from("mentees").insert({
    name: input.name,
    company: input.company,
    role: input.role,
    joined_at: input.joinedAt,
    main_mentor_id: null,
    briefing: input.briefing,
    status: statusToDb[input.status],
    risk: riskToDb[input.risk],
    risk_reason: input.riskReason,
    next_action: input.nextAction,
    last_participation_at: null,
    accent: input.accent,
    email: input.email ?? null,
    product: input.product ?? null,
    source_system: "manual",
    external_id: null,
    instagram_url: input.instagramUrl ?? null,
    media_plan_url: null,
    folder_url: input.folderUrl ?? null,
    bonus: null,
    contract_end_at: null,
    source_data: {},
  }).select("*").single();
  assertNoError(error);
  return mapMentee(data as MenteeRow);
}

export async function updateMenteeRisk(input: Mentee) {
  const { data, error } = await getSupabaseBrowserClient().from("mentees").update({
    risk: riskToDb[input.risk],
    risk_reason: input.riskReason,
    next_action: input.nextAction,
  }).eq("id", input.id).select("*").single();
  assertNoError(error);
  return mapMentee(data as MenteeRow);
}

export async function updateMenteeStatus(input: Mentee): Promise<Mentee> {
  const { data, error } = await getSupabaseBrowserClient().from("mentees").update({
    status: statusToDb[input.status],
  }).eq("id", input.id).select("*").single();
  assertNoError(error);
  return mapMentee(data as MenteeRow);
}

export async function createAchievement(input: Achievement) {
  const { data, error } = await getSupabaseBrowserClient().from("achievements").insert({
    mentee_id: input.menteeId,
    achieved_at: input.date,
    title: input.title,
    note: input.note,
    created_by: null,
  }).select("*").single();
  assertNoError(error);
  return mapAchievement(data as AchievementRow);
}

export async function syncGoogleCalendar() {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Sessão expirada.");
  const response = await fetch("/api/calendar/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível sincronizar o Calendar.");
  return result as { synced: number; individual: number; group: number };
}

export interface MenteeBriefing {
  status: "pending" | "filled";
  importReviewPending: boolean;
  filledAt: string | null;
  token: string | null;
  answers: Record<string, string>;
}

export async function loadBriefing(menteeId: string): Promise<MenteeBriefing | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("mentee_briefing")
    .select("*")
    .eq("mentee_id", menteeId)
    .maybeSingle();
  assertNoError(error);
  if (!data) return null;
  const row = data as BriefingRow;
  const answers: Record<string, string> = {};
  for (const key of briefingFieldKeys) {
    const value = row[key as keyof BriefingRow];
    if (typeof value === "string" && value.trim()) answers[key] = value;
  }
  return {
    status: row.status,
    importReviewPending: row.import_review_pending,
    filledAt: row.filled_at,
    token: row.access_token,
    answers,
  };
}

async function teamAuthHeader() {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  if (!data.session?.access_token) throw new Error("Sessão expirada.");
  return { Authorization: `Bearer ${data.session.access_token}` };
}

export async function generateBriefingLink(menteeId: string, regenerate = false): Promise<string> {
  const response = await fetch(`/api/mentees/${menteeId}/briefing`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await teamAuthHeader()) },
    body: JSON.stringify({ regenerate }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível gerar o link.");
  return result.token as string;
}

export async function markBriefingReviewed(menteeId: string): Promise<void> {
  const response = await fetch(`/api/mentees/${menteeId}/briefing`, {
    method: "PATCH",
    headers: { ...(await teamAuthHeader()) },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "Não foi possível marcar como revisado.");
  }
}

export interface ParticipationInput {
  menteeId: string;
  attended: boolean;
  engagementScore: number | null;
  evolutionScore: number | null;
  note: string;
}

export async function saveParticipation(meetingId: string, entries: ParticipationInput[]): Promise<void> {
  const response = await fetch(`/api/meetings/${meetingId}/participation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await teamAuthHeader()) },
    body: JSON.stringify({ entries }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "Não foi possível salvar a participação.");
  }
}

export async function updateMeetingMentor(meetingId: string, mentorId: string): Promise<void> {
  const response = await fetch(`/api/meetings/${meetingId}/mentor`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await teamAuthHeader()) },
    body: JSON.stringify({ mentorId }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "Não foi possível alterar o mentor.");
  }
}

export interface MentorMonthStat { mentorId: string; name: string; individual: number; group: number; total: number }
export interface MentorMonthStats { month: string; stats: MentorMonthStat[] }

export async function loadMentorMonthStats(): Promise<MentorMonthStats> {
  const response = await fetch("/api/mentors/monthly-stats", {
    headers: { ...(await teamAuthHeader()) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Não foi possível carregar as mentorias do mês.");
  return result as MentorMonthStats;
}

export interface MonthMeeting {
  title: string;
  startsAt: string;
  type: "Individual" | "Grupo";
}

export async function loadMenteeMonthMeetings(menteeId: string): Promise<MonthMeeting[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const nowIso = now.toISOString();
  const supabase = getSupabaseBrowserClient();
  // Mentorias realizadas no mês: individuais do cliente que já aconteceram + grupos com participação registrada.
  const [individualResult, participationResult] = await Promise.all([
    supabase.from("meetings").select("id, title, starts_at, type").eq("individual_mentee_id", menteeId).gte("starts_at", start).lte("starts_at", nowIso),
    supabase.from("meeting_participations").select("meetings!inner(id, title, starts_at, type)").eq("mentee_id", menteeId).eq("attended", true).gte("meetings.starts_at", start).lt("meetings.starts_at", end),
  ]);
  [individualResult, participationResult].forEach((result) => assertNoError(result.error));
  type JoinedMeeting = { id: string; title: string; starts_at: string; type: "individual" | "group" };
  const byId = new Map<string, JoinedMeeting>();
  for (const meeting of (individualResult.data ?? []) as JoinedMeeting[]) byId.set(meeting.id, meeting);
  const participationRows = (participationResult.data ?? []) as unknown as Array<{ meetings: JoinedMeeting | JoinedMeeting[] }>;
  for (const row of participationRows) {
    const meeting = Array.isArray(row.meetings) ? row.meetings[0] : row.meetings;
    if (meeting) byId.set(meeting.id, meeting);
  }
  return [...byId.values()]
    .map((meeting) => ({ title: meeting.title, startsAt: meeting.starts_at, type: meeting.type === "individual" ? "Individual" as const : "Grupo" as const }))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

export interface MenteeHistoryMaterial { id: string; type: "recording" | "summary"; title: string; driveUrl: string; happenedAt: string }
export type MenteeHistoryEntry =
  | { kind: "meeting"; id: string; title: string; startsAt: string; type: "Individual" | "Grupo"; front: MeetingFront; mentorName: string | null; materials: MenteeHistoryMaterial[] }
  | { kind: "material"; happenedAt: string; material: MenteeHistoryMaterial };

type HistoryMentorLink = { mentor_id: string; source: "auto" | "manual"; mentors: { name: string } | { name: string }[] | null };
type HistoryMeetingRow = MeetingRow & { meeting_mentors: HistoryMentorLink[] };

function mapHistoryMaterial(row: MaterialRow): MenteeHistoryMaterial {
  return { id: row.id, type: row.type, title: row.title, driveUrl: row.drive_url, happenedAt: row.happened_at };
}

export async function loadMenteeHistory(menteeId: string): Promise<MenteeHistoryEntry[]> {
  const supabase = getSupabaseBrowserClient();
  // Histórico = o que já aconteceu; encontros futuros ficam de fora.
  const nowIso = new Date().toISOString();
  const [individualResult, participationResult, materialsResult] = await Promise.all([
    supabase.from("meetings").select("*, meeting_mentors(mentor_id, source, mentors(name))").eq("individual_mentee_id", menteeId).lte("starts_at", nowIso),
    supabase.from("meeting_participations").select("meetings!inner(*, meeting_mentors(mentor_id, source, mentors(name)))").eq("mentee_id", menteeId).eq("attended", true).lte("meetings.starts_at", nowIso),
    supabase.from("mentee_materials").select("*").eq("mentee_id", menteeId),
  ]);
  [individualResult, participationResult, materialsResult].forEach((result) => assertNoError(result.error));

  // Merge por id: individual com participação registrada aparece nas duas consultas.
  const rowsById = new Map<string, HistoryMeetingRow>();
  for (const row of (individualResult.data ?? []) as unknown as HistoryMeetingRow[]) rowsById.set(row.id, row);
  const participationRows = (participationResult.data ?? []) as unknown as Array<{ meetings: HistoryMeetingRow | HistoryMeetingRow[] | null }>;
  for (const row of participationRows) {
    const meeting = Array.isArray(row.meetings) ? row.meetings[0] : row.meetings;
    if (meeting) rowsById.set(meeting.id, meeting);
  }

  // Dedupe por chave (mesma regra da carga geral), preservando vínculo de mentor de qualquer cópia.
  const mentorNames = new Map<string, string>();
  const dedupedByKey = new Map<string, { meeting: Meeting; materials: MenteeHistoryMaterial[] }>();
  const meetingIdToKey = new Map<string, string>();
  for (const row of rowsById.values()) {
    const links = (row.meeting_mentors ?? []).map((link) => {
      const mentor = Array.isArray(link.mentors) ? link.mentors[0] : link.mentors;
      if (mentor) mentorNames.set(link.mentor_id, mentor.name);
      return { mentorId: link.mentor_id, source: link.source };
    });
    const meeting = mapMeeting(row, links);
    const key = meetingKey(meeting);
    meetingIdToKey.set(row.id, key);
    const existing = dedupedByKey.get(key);
    if (!existing) {
      dedupedByKey.set(key, { meeting, materials: [] });
      continue;
    }
    existing.meeting.mentorIds = [...new Set([...existing.meeting.mentorIds, ...meeting.mentorIds])];
  }

  // Casamento de materiais: meeting_id de qualquer cópia entra na entrada deduplicada; sem correspondência vira entrada avulsa.
  const looseMaterials: MenteeHistoryEntry[] = [];
  for (const row of (materialsResult.data ?? []) as MaterialRow[]) {
    const key = row.meeting_id ? meetingIdToKey.get(row.meeting_id) : undefined;
    const entry = key ? dedupedByKey.get(key) : undefined;
    if (entry) entry.materials.push(mapHistoryMaterial(row));
    else looseMaterials.push({ kind: "material", happenedAt: row.happened_at, material: mapHistoryMaterial(row) });
  }

  const entries: MenteeHistoryEntry[] = [...dedupedByKey.values()].map(({ meeting, materials }) => ({
    kind: "meeting" as const,
    id: meeting.id,
    title: meeting.title,
    startsAt: meeting.startsAt,
    type: meeting.type,
    front: meeting.front,
    mentorName: meeting.mentorIds.length > 0 ? mentorNames.get(meeting.mentorIds[0]) ?? null : null,
    materials: [...materials].sort((a, b) => (a.type === b.type ? 0 : a.type === "recording" ? -1 : 1)),
  }));
  entries.push(...looseMaterials);
  const entryTime = (entry: MenteeHistoryEntry) => new Date(entry.kind === "meeting" ? entry.startsAt : entry.happenedAt).getTime();
  return entries.sort((a, b) => entryTime(b) - entryTime(a));
}

export async function updateMenteeContact(input: Mentee): Promise<Mentee> {
  const { data, error } = await getSupabaseBrowserClient().from("mentees").update({
    instagram_url: input.instagramUrl ?? null,
    folder_url: input.folderUrl ?? null,
    brand_aliases: input.brandAliases,
  }).eq("id", input.id).select("*").single();
  assertNoError(error);
  return mapMentee(data as MenteeRow);
}
