import type { Achievement, Meeting, Mentee, Mentor, Risk } from "@/lib/types";
import { frontDbToLabel } from "@/lib/meeting-front";
import { briefingFieldKeys } from "@/lib/briefing-schema";
import { getSupabaseBrowserClient } from "./client";
import type { AchievementRow, BriefingRow, MenteeRow, MentorRow, MeetingRow } from "./database.types";

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
  const [mentorsResult, menteesResult, meetingsResult, meetingMentorsResult, achievementsResult] = await Promise.all([
    supabase.from("mentors").select("*").order("name"),
    supabase.from("mentees").select("*").order("name"),
    supabase.from("meetings").select("*").order("starts_at"),
    supabase.from("meeting_mentors").select("*"),
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
  const { data, error } = await getSupabaseBrowserClient()
    .from("meeting_participations")
    .select("meetings!inner(title, starts_at, type)")
    .eq("mentee_id", menteeId)
    .eq("attended", true)
    .gte("meetings.starts_at", start)
    .lt("meetings.starts_at", end);
  assertNoError(error);
  type JoinedMeeting = { title: string; starts_at: string; type: "individual" | "group" };
  const rows = (data ?? []) as unknown as Array<{ meetings: JoinedMeeting | JoinedMeeting[] }>;
  return rows
    .map((row) => (Array.isArray(row.meetings) ? row.meetings[0] : row.meetings))
    .filter((meeting): meeting is JoinedMeeting => Boolean(meeting))
    .map((meeting) => ({ title: meeting.title, startsAt: meeting.starts_at, type: meeting.type === "individual" ? "Individual" as const : "Grupo" as const }))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

export async function updateMenteeContact(input: Mentee): Promise<Mentee> {
  const { data, error } = await getSupabaseBrowserClient().from("mentees").update({
    instagram_url: input.instagramUrl ?? null,
    folder_url: input.folderUrl ?? null,
  }).eq("id", input.id).select("*").single();
  assertNoError(error);
  return mapMentee(data as MenteeRow);
}
