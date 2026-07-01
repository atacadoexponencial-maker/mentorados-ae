-- Briefing estruturado preenchido pelo mentorado via link público com token.
-- Um registro por mentorado (1:1). As respostas usam uma coluna por pergunta do
-- formulário AE; o acesso público é feito pelo backend via token (sem login).
create type public.briefing_status as enum ('pending', 'filled');

create table public.mentee_briefing (
  id uuid primary key default gen_random_uuid(),
  mentee_id uuid not null unique references public.mentees(id) on delete cascade,
  access_token text unique,
  status public.briefing_status not null default 'pending',
  import_review_pending boolean not null default false,
  filled_at timestamptz,
  -- Respostas (uma coluna por pergunta do formulário AE, na ordem das seções)
  brand_name text,
  niche text,
  founding_year text,
  location text,
  physical_stores text,
  business_type text,
  employees_count text,
  marketing_team text,
  sales_team text,
  company_history text,
  main_sales_channel text,
  online_channels text,
  first_purchase_policy text,
  formality_policy text,
  ideal_customer_profiles text,
  primary_customer_profile text,
  recurring_customers_avg text,
  new_customers_avg text,
  repurchase_behavior text,
  base_sales_actions text,
  new_sales_actions text,
  collection_frequency text,
  launch_strategy text,
  marketing_difficulty text,
  paid_traffic text,
  whatsapp_leads_group text,
  whatsapp_customers_group text,
  acquisition_funnels text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mentee_briefing_token_idx on public.mentee_briefing(access_token);

create trigger mentee_briefing_updated_at before update on public.mentee_briefing
for each row execute function public.set_updated_at();

-- A equipe autenticada gerencia tudo; o preenchimento público passa pelo backend
-- (conexão de servidor), que não depende destas policies.
alter table public.mentee_briefing enable row level security;
create policy "team access mentee_briefing" on public.mentee_briefing for all to authenticated
using (true) with check (true);
