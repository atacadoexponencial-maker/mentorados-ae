import type { Achievement, Meeting, Mentee, Risk } from "@/lib/types";
import { getSupabaseBrowserClient } from "./client";
import type { AchievementRow, MenteeRow, MeetingRow } from "./database.types";

const statusFromDb = { active: "Ativo", paused: "Pausado", closed: "Encerrado" } as const;
const statusToDb = { Ativo: "active", Pausado: "paused", Encerrado: "closed" } as const;
const riskFromDb = { low: "Baixo", medium: "Médio", high: "Alto" } as const;
const riskToDb = { Baixo: "low", Médio: "medium", Alto: "high" } as const;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function mapMentee(row: MenteeRow, otherMentorIds: string[] = []): Mentee {
  return {
    id: row.id,
    name: row.name,
    initials: initials(row.name),
    company: row.company,
    role: row.role || row.product || "Cliente",
    joinedAt: row.joined_at,
    mainMentorId: row.main_mentor_id || "unassigned",
    otherMentorIds,
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

function mapMeeting(row: MeetingRow, mentorIds: string[]): Meeting {
  return {
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    duration: Math.max(1, Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000)),
    meetUrl: row.meet_url || "#",
    mentorIds,
    type: row.type === "individual" ? "Individual" : "Grupo",
    menteeIds: row.individual_mentee_id ? [row.individual_mentee_id] : [],
    attendanceRecorded: Boolean(row.attendance_recorded_at),
  };
}

function mapAchievement(row: AchievementRow): Achievement {
  return { id: row.id, menteeId: row.mentee_id, date: row.achieved_at, title: row.title, note: row.note, icon: "trophy" };
}

function assertNoError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadAppData() {
  const supabase = getSupabaseBrowserClient();
  const [menteesResult, linksResult, meetingsResult, meetingMentorsResult, achievementsResult] = await Promise.all([
    supabase.from("mentees").select("*").order("name"),
    supabase.from("mentee_mentors").select("*"),
    supabase.from("meetings").select("*").order("starts_at"),
    supabase.from("meeting_mentors").select("*"),
    supabase.from("achievements").select("*").order("achieved_at", { ascending: false }),
  ]);
  [menteesResult, linksResult, meetingsResult, meetingMentorsResult, achievementsResult].forEach((result) => assertNoError(result.error));

  const menteeMentors = new Map<string, string[]>();
  const menteeLinks = (linksResult.data ?? []) as Array<{ mentee_id: string; mentor_id: string }>;
  for (const link of menteeLinks) menteeMentors.set(link.mentee_id, [...(menteeMentors.get(link.mentee_id) ?? []), link.mentor_id]);
  const meetingMentors = new Map<string, string[]>();
  const meetingLinks = (meetingMentorsResult.data ?? []) as Array<{ meeting_id: string; mentor_id: string }>;
  for (const link of meetingLinks) meetingMentors.set(link.meeting_id, [...(meetingMentors.get(link.meeting_id) ?? []), link.mentor_id]);

  return {
    mentees: ((menteesResult.data ?? []) as MenteeRow[]).map((row) => mapMentee(row, menteeMentors.get(row.id))),
    meetings: ((meetingsResult.data ?? []) as MeetingRow[]).map((row) => mapMeeting(row, meetingMentors.get(row.id) ?? [])),
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
    instagram_url: null,
    media_plan_url: null,
    folder_url: null,
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
  return mapMentee(data as MenteeRow, input.otherMentorIds);
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
