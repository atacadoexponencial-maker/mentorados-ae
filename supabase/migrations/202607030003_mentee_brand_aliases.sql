-- Apelidos de marca do mentorado (nomes alternativos usados em títulos de
-- eventos e arquivos). Lista vazia por padrão, nunca nula — a coluna herda
-- as policies existentes de mentees.
alter table public.mentees
  add column brand_aliases text[] not null default '{}';

-- Carga inicial dos casos reais conhecidos
update public.mentees
  set brand_aliases = array['Lady Hair']
  where lower(email) = 'soniaalbuquerquebadu@gmail.com';

update public.mentees
  set brand_aliases = array['Barraca do Wilinha']
  where company = 'Barraca do Willinha';
