-- Origem do registro de participação (Módulo A — coleta automática).
-- 'manual' = confirmado pelo mentor; 'auto' = coletado do Google Meet.
-- Em meetings, attendance_source null = sem registro. Manual sempre prevalece:
-- a coleta automática nunca sobrescreve attendance_source = 'manual'.

create type public.participation_source as enum ('auto', 'manual');

alter table public.meetings
  add column attendance_source public.participation_source,
  add column auto_collect_last_attempt_at timestamptz;

-- Tudo que já tem presença registrada veio do fluxo manual existente.
update public.meetings
  set attendance_source = 'manual'
  where attendance_recorded_at is not null;

alter table public.meetings
  add constraint attendance_source_matches_recorded
  check ((attendance_source is null) = (attendance_recorded_at is null));

alter table public.meeting_participations
  add column source public.participation_source not null default 'manual';
