-- Materiais do cliente importados do Drive (gravações e resumos de reuniões).
-- Cada material pertence a um mentorado (cascata na exclusão) e pode ter um
-- encontro vinculado (desvincula sem excluir). O id do arquivo no Drive é único
-- para que reimportações façam upsert em vez de duplicar.
create type public.material_type as enum ('recording', 'summary');

create table public.mentee_materials (
  id uuid primary key default gen_random_uuid(),
  mentee_id uuid not null references public.mentees(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete set null,
  type public.material_type not null,
  title text not null,
  drive_file_id text not null unique,
  drive_url text not null,
  happened_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mentee_materials_mentee_date_idx
  on public.mentee_materials(mentee_id, happened_at desc);

create trigger mentee_materials_updated_at before update on public.mentee_materials
for each row execute function public.set_updated_at();

-- Equipe autenticada lê e escreve; o script de import usa conexão direta
-- (DATABASE_URL), que ignora RLS. Sem policy para anon.
alter table public.mentee_materials enable row level security;
create policy "team access mentee materials" on public.mentee_materials for all to authenticated
using (true) with check (true);
