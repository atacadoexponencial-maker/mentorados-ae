create type public.meeting_front as enum ('trafego', 'redes_sociais', 'comercial', 'estrategia');

alter table public.meetings
  add column front public.meeting_front not null default 'estrategia';

update public.meetings
set front = case
  when lower(title) ~ '(rede social|redes sociais|social media|instagram|conteudo)' then 'redes_sociais'::public.meeting_front
  when lower(title) ~ '(trafego|meta ads|google ads|midia paga|ads)' then 'trafego'::public.meeting_front
  when lower(title) ~ '(comercial|vendas|closer|pipeline)' then 'comercial'::public.meeting_front
  else 'estrategia'::public.meeting_front
end;
