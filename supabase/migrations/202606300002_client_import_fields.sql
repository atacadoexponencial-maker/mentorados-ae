alter table public.mentees
  add column email text,
  add column product text,
  add column source_system text not null default 'manual',
  add column external_id text,
  add column instagram_url text,
  add column media_plan_url text,
  add column folder_url text,
  add column bonus text,
  add column contract_end_at date,
  add column source_data jsonb not null default '{}'::jsonb;

alter table public.mentees
  add constraint mentees_source_external_id_unique unique (source_system, external_id);

create index mentees_email_lower_idx on public.mentees(lower(email));
create index mentees_product_idx on public.mentees(product);
