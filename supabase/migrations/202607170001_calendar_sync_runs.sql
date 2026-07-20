-- Log de auditoria de cada execução do sync do Calendar (issue 31).
create table public.calendar_sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('cron', 'manual')),
  synced integer not null,
  individual_total integer not null,
  group_total integer not null,
  ignored_total integer not null,
  removed_total integer not null,
  ignored_events jsonb not null default '[]'::jsonb,
  removed_events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.calendar_sync_runs enable row level security;
-- Equipe só lê o log; a escrita é feita pelo backend via DATABASE_URL (bypassa RLS).
create policy "team read calendar sync runs" on public.calendar_sync_runs
  for select to authenticated using (true);
