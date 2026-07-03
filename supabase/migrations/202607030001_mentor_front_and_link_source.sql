-- Frente de atuação do mentor (reutiliza o enum public.meeting_front) e origem
-- do vínculo mentor↔encontro (auto = criado pelo sync, manual = definido pela equipe).

create type public.mentor_link_source as enum ('auto', 'manual');

alter table public.mentors
  add column front public.meeting_front;

alter table public.meeting_mentors
  add column source public.mentor_link_source not null default 'auto';

update public.mentors set front = 'trafego' where email = 'marcelle@seteads.com';
update public.mentors set front = 'redes_sociais' where email = 'day@seteads.com';
update public.mentors set front = 'comercial' where email = 'barbara@seteads.com';
update public.mentors set front = 'estrategia' where email = 'felipe@seteads.com';
