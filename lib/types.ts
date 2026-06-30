export type Risk = "Baixo" | "Médio" | "Alto";
export type MenteeStatus = "Ativo" | "Pausado" | "Encerrado";
export type EventType = "Individual" | "Grupo";
export type MeetingFront = "Tráfego" | "Redes sociais" | "Comercial" | "Estratégia";

export interface Mentor {
  id: string;
  name: string;
  initials: string;
  color: string;
  contact: string;
}

export interface Mentee {
  id: string;
  name: string;
  initials: string;
  company: string;
  role: string;
  joinedAt: string;
  mainMentorId: string;
  otherMentorIds: string[];
  briefing: string;
  status: MenteeStatus;
  risk: Risk;
  riskReason: string;
  nextAction: string;
  lastParticipation: string;
  accent: string;
  email?: string;
  product?: string;
  instagramUrl?: string;
  folderUrl?: string;
}

export interface Meeting {
  id: string;
  title: string;
  startsAt: string;
  duration: number;
  meetUrl: string;
  mentorIds: string[];
  type: EventType;
  front: MeetingFront;
  menteeIds: string[];
  attendanceRecorded: boolean;
}

export interface Achievement {
  id: string;
  menteeId: string;
  date: string;
  title: string;
  note: string;
  icon: "trophy" | "target" | "sparkles";
}
