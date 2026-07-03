# 15: Atribuição Automática de Mentor no Sync da Agenda

**Tipo:** Implementação
**Página:** Módulo B (sync da agenda)

## Descrição
Estender o sync existente para vincular automaticamente a cada encontro (Individual ou Grupo) o mentor cuja frente de atuação corresponde à frente classificada, marcando o vínculo como "automático". Regras: sem mentor correspondente (frente sem mentor ou com mais de um mentor) o encontro fica sem vínculo; ao reprocessar, vínculos automáticos são recalculados pela frente atual e vínculos manuais **nunca** são alterados; encontros sem vínculo ganham vínculo automático quando a frente passa a ter mentor; o vínculo é removido junto com o encontro na limpeza do sync; eventos já ignorados pelo sync continuam sem mentor.

## Abordagem Técnica

Toda a lógica fica no handler `POST` de `app/api/calendar/sync/route.ts`, dentro da transação já existente (`begin`…`commit`). A reconciliação é **set-based**, executada uma única vez **depois** do loop de eventos (após a linha 69, antes do bloco de limpeza), aproveitando a temp table `current_calendar_sync_keys`, que contém exatamente os encontros criados/atualizados nesta execução (eventos ignorados nunca entram nela — o `continue` na linha 48 acontece antes do insert na temp table, o que já garante a regra "eventos ignorados continuam sem mentor").

Definição de "mentor correspondente à frente": subquery sobre `public.mentors` com `where front is not null group by front having count(*) = 1` — frentes com zero ou mais de um mentor não produzem candidato.

Dois statements SQL, nesta ordem:

1. **Remover vínculos automáticos obsoletos** — `delete from public.meeting_mentors` onde `source = 'auto'`, o encontro pertence a `current_calendar_sync_keys` (join com `public.meetings` por `google_calendar_id`/`google_event_id`) e o `mentor_id` do vínculo **não** é o mentor único da `front` atual do encontro (inclui o caso de a frente ter perdido o mentor único). Vínculos `source = 'manual'` nunca são tocados pelo filtro `source = 'auto'`.
2. **Criar vínculos automáticos** — `insert into public.meeting_mentors (meeting_id, mentor_id, source) select meeting.id, mentor_unico.id, 'auto'` para encontros de `current_calendar_sync_keys` cuja `front` tem mentor único e que **não possuem nenhum vínculo** em `meeting_mentors` (`not exists`, sem filtrar por source — assim um vínculo manual existente bloqueia a criação do automático), com `on conflict do nothing` como proteção.

Com o passo 1 antes do 2, a mudança de frente de um encontro com vínculo auto resulta em troca do mentor; encontro com vínculo manual passa incólume pelos dois passos.

**Limpeza:** não precisa de código — `meeting_mentors.meeting_id` já tem `on delete cascade` (`supabase/migrations/202606300001_initial_schema.sql`, linha 65), então o `delete from public.meetings` do sync já remove os vínculos junto.

## Cenários

### Happy Path
- Sync roda e encontra evento novo classificado como `trafego` → encontro criado e vínculo `meeting_mentors (meeting_id, mentor Marcelle, source='auto')` criado na mesma transação.
- Vale igualmente para encontros `individual` e `group` (a reconciliação não filtra por `type`).
- Sync reprocessa encontro existente cuja frente não mudou e cujo vínculo auto já aponta o mentor certo → nenhum delete/insert efetivo (idempotente).

### Edge Cases
- **Frente mudou entre syncs** (título do evento editado no Google): encontro tinha vínculo auto com mentor A; novo título classifica outra frente com mentor B → passo 1 remove A, passo 2 insere B.
- **Vínculo manual existente**: encontro tem vínculo `source='manual'` (qualquer mentor) → passo 1 não o toca (filtro `source='auto'`) e passo 2 não insere (o `not exists` vê o vínculo manual). O mentor manual permanece mesmo que a frente aponte outro.
- **Frente sem mentor**: nenhum mentor com aquela `front` (ex.: `front is null` em todos) → encontro fica/permanece sem vínculo; se tinha vínculo auto de frente anterior, ele é removido pelo passo 1.
- **Frente com dois ou mais mentores**: o `having count(*) = 1` exclui a frente → tratado igual a "sem mentor" (não atribui; remove auto obsoleto).
- **Encontro antigo sem vínculo cuja frente ganhou mentor** (mentor cadastrado com `front` depois): próximo sync que reprocessar o encontro cria o vínculo auto via passo 2.
- **Evento ignorado pelo sync** (reunião interna, bloqueio, sem mentorado único): não entra na temp table → reconciliação não o alcança; nenhum vínculo criado.
- **Encontro removido pela limpeza do sync**: vínculos (auto e manual) somem via `on delete cascade` — sem código novo.
- **Encontros fora do sync** (sem `google_event_id` ou de calendário não configurado): não entram na temp table → intocados.

### Cenário de Erro
- Qualquer falha nos dois statements novos (ex.: violação de constraint, erro de conexão) cai no `catch` existente → `rollback` da transação inteira (encontros e vínculos), resposta `500` com a mensagem — nenhum estado parcial persiste.

## Banco de Dados
Nenhuma migration nova. A issue 14 já criou tudo o que é necessário:
- `mentors.front public.meeting_front` (nullable) + carga das frentes dos 4 mentores (`supabase/migrations/202607030001_mentor_front_and_link_source.sql`).
- `meeting_mentors.source public.mentor_link_source not null default 'auto'`.
- `meeting_mentors.meeting_id` com `on delete cascade` desde o schema inicial — a limpeza do sync já propaga a remoção dos vínculos.
- Tipos em `lib/supabase/database.types.ts` já refletem `source` e o enum `mentor_link_source` (nada a alterar).

## Arquivos
- **Modificar:** `app/api/calendar/sync/route.ts` — no handler `POST`, após o loop `for (const event of events)` (linha 69) e antes do bloco de limpeza (linha 70), adicionar os dois statements de reconciliação descritos acima (delete de vínculos auto obsoletos + insert de vínculos auto para frentes com mentor único), ambos via `database.query` dentro da transação existente. Nenhuma outra função ou arquivo muda; `lib/meeting-front.ts` é apenas consumido como hoje.

## Checklist
- [x] Adicionar em `route.ts`, após o loop de eventos e dentro da transação, o `delete` de vínculos `source='auto'` de encontros presentes em `current_calendar_sync_keys` cujo `mentor_id` difere do mentor único da `front` atual (ou cuja frente não tem mentor único).
- [x] Adicionar em seguida o `insert ... select` que cria vínculos `source='auto'` para encontros de `current_calendar_sync_keys` sem nenhum vínculo em `meeting_mentors` e cuja `front` tem exatamente um mentor (`group by front having count(*) = 1`), com `on conflict do nothing`.
- [x] Garantir que nenhum dos dois statements toca linhas `source='manual'` e que a presença de vínculo manual impede a criação do automático.
- [x] Não alterar o loop de eventos, a classificação de frente (`lib/meeting-front.ts`), o bloco de limpeza nem o shape da resposta JSON.
- [x] Confirmar (sem código novo) que a limpeza remove vínculos via `on delete cascade` de `meeting_mentors.meeting_id`.
- [x] Rodar `npm run build` (ou `npx tsc --noEmit`) para validar tipos.
- [ ] Testar o sync autenticado e verificar em `meeting_mentors`: vínculo auto criado para frente com mentor, ausência de vínculo para frente sem mentor único, e preservação de um vínculo marcado manualmente como `manual`.
