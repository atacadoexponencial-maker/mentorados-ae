-- Áurea — schema inicial do MVP
create extension if not exists pgcrypto;

create type public.mentee_status as enum ('active', 'paused', 'closed');
create type public.risk_level as enum ('low', 'medium', 'high');
create type public.meeting_type as enum ('individual', 'group');

create table public.mentors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text not null unique,
  phone text,
  color text not null default '#29473b',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mentees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text not null,
  role text,
  joined_at date not null default current_date,
  main_mentor_id uuid references public.mentors(id) on delete set null,
  briefing text not null default '',
  status public.mentee_status not null default 'active',
  risk public.risk_level not null default 'low',
  risk_reason text not null default '',
  next_action text not null default '',
  last_participation_at timestamptz,
  accent text not null default '#748b7c',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mentee_mentors (
  mentee_id uuid not null references public.mentees(id) on delete cascade,
  mentor_id uuid not null references public.mentors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (mentee_id, mentor_id)
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  google_event_id text unique,
  google_calendar_id text,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meet_url text,
  type public.meeting_type not null,
  individual_mentee_id uuid references public.mentees(id) on delete set null,
  attendance_recorded_at timestamptz,
  general_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_period_is_valid check (ends_at > starts_at),
  constraint individual_meeting_has_mentee check (
    type <> 'individual' or individual_mentee_id is not null
  )
);

create table public.meeting_mentors (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  mentor_id uuid not null references public.mentors(id) on delete cascade,
  primary key (meeting_id, mentor_id)
);

create table public.meeting_participations (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  mentee_id uuid not null references public.mentees(id) on delete cascade,
  attended boolean not null,
  engagement_score smallint,
  evolution_score smallint,
  note text not null default '',
  recorded_by uuid references public.mentors(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, mentee_id),
  constraint valid_engagement_score check (engagement_score between 1 and 5),
  constraint valid_evolution_score check (evolution_score between 1 and 5)
);

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  mentee_id uuid not null references public.mentees(id) on delete cascade,
  achieved_at date not null default current_date,
  title text not null,
  note text not null default '',
  created_by uuid references public.mentors(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mentees_status_idx on public.mentees(status);
create index mentees_risk_idx on public.mentees(risk);
create index meetings_starts_at_idx on public.meetings(starts_at);
create index participations_mentee_idx on public.meeting_participations(mentee_id);
create index achievements_mentee_date_idx on public.achievements(mentee_id, achieved_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger mentors_updated_at before update on public.mentors
for each row execute function public.set_updated_at();
create trigger mentees_updated_at before update on public.mentees
for each row execute function public.set_updated_at();
create trigger meetings_updated_at before update on public.meetings
for each row execute function public.set_updated_at();
create trigger participations_updated_at before update on public.meeting_participations
for each row execute function public.set_updated_at();
create trigger achievements_updated_at before update on public.achievements
for each row execute function public.set_updated_at();

alter table public.mentors enable row level security;
alter table public.mentees enable row level security;
alter table public.mentee_mentors enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_mentors enable row level security;
alter table public.meeting_participations enable row level security;
alter table public.achievements enable row level security;

-- MVP interno: qualquer usuário autenticado da equipe pode operar toda a carteira.
-- O cadastro de usuários deve permanecer restrito no painel do Supabase.
create policy "team access mentors" on public.mentors for all to authenticated
using (true) with check (true);
create policy "team access mentees" on public.mentees for all to authenticated
using (true) with check (true);
create policy "team access mentee mentors" on public.mentee_mentors for all to authenticated
using (true) with check (true);
create policy "team access meetings" on public.meetings for all to authenticated
using (true) with check (true);
create policy "team access meeting mentors" on public.meeting_mentors for all to authenticated
using (true) with check (true);
create policy "team access participations" on public.meeting_participations for all to authenticated
using (true) with check (true);
create policy "team access achievements" on public.achievements for all to authenticated
using (true) with check (true);
