# 29: Delete conservador no sync de calendário
**Tipo:** Implementação
**Página:** Módulo D — Completude da Agenda
## Descrição
Alterar `app/api/calendar/sync/route.ts` (bloco de limpeza, ~linhas 120-133) para que uma meeting só seja apagada quando o evento correspondente foi de fato cancelado/removido no Google (ex.: evento retornado com `status: cancelled` ou confirmado como inexistente por consulta ao `google_event_id`), nunca quando o evento apenas deixou de casar no matching ou caiu em filtro na execução atual. Manter as exceções existentes: encontro com participação registrada (automática ou manual) nunca é apagado, e nada fora da janela de sincronização é tocado — mentorias passadas permanecem indefinidamente.

## Contexto técnico (estado atual)

- `lib/google-calendar.ts:96-107` — `events.list` é chamado **sem** `showDeleted`, e a linha 107 descarta qualquer evento com `status === "cancelled"`. Resultado: o sync nunca recebe evidência positiva de cancelamento; "sumiu da lista de upserts" é o único sinal, e ele é falso-positivo para qualquer falha de matching/filtro.
- `app/api/calendar/sync/route.ts:64` — a temp table `current_calendar_sync_keys` só recebe a chave `(calendar_id, event_id)` dos eventos que **passaram** no matching e viraram upsert. Eventos reais que deixaram de casar (mentee virou `closed`, título editado, nova regra de ignore) ou a cópia deduplicada de um segundo calendário (`route.ts:34-36` — só a primeira cópia `título|startsAt` é processada) ficam de fora e o DELETE das linhas 120-133 os apaga.
- Semântica da API do Google: apagar um evento o marca como `status: "cancelled"`; `events.list` com `showDeleted: true` retorna esses eventos. Exceção conhecida: com `singleEvents: true`, instâncias expandidas de uma **série recorrente apagada inteira** podem não vir como `cancelled` — por isso é preciso o segundo mecanismo de verificação por `events.get` (404/410 ou `status: cancelled`).

## Solução

Duas evidências independentes de cancelamento, e **só** elas apagam:

1. **Cancelamento explícito na listagem** — `listWorkspaceEvents` passa a chamar `events.list` com `showDeleted: true` e a devolver, além dos eventos ativos, a lista de chaves canceladas `{ calendarId (sourceId), eventId }`. O sync apaga meetings da janela cuja chave está nesse conjunto (respeitando as guardas de participação).
2. **Confirmação individual por `events.get`** — meetings da janela cuja chave não apareceu **nem** entre os ativos **nem** entre os cancelados (candidatas a "série apagada" ou evento movido) são verificadas uma a uma com `events.get`: apaga só se a resposta for 404/410 ou `status: "cancelled"`. Evento encontrado ativo → mantida, sempre.

Para o mecanismo 2 funcionar sem falso-positivo, o sync registra numa nova temp table (`current_calendar_seen_keys`) a chave de **todo** evento ativo retornado pelo Google — antes do dedupe, do matching e dos filtros de título. Assim, evento que existe mas não virou upsert nunca é candidato a deleção. A verificação por `events.get` roda **após o commit** da transação principal (candidatas selecionadas para memória antes do commit), com cada delete individual re-checando as guardas — falha de rede/quota na verificação mantém a meeting e não derruba o sync.

## Cenários

### Happy Path
1. Mentoria individual cancelada no Google Meet/Calendar dentro da janela (−24h a +90d), sem participação registrada → evento volta na listagem com `status: cancelled` → meeting apagada; `removed` incrementa.
2. Evento segue existindo e casando → upsert normal, nada apagado (comportamento atual preservado).
3. Evento segue existindo mas **deixou de casar** (mentee encerrado, título editado, regra EXT/CRM/R1) → chave está em `current_calendar_seen_keys` → meeting **não** é apagada nem verificada. Correção do bug central.

### Edge Cases
1. **Evento em 2+ calendários de mentores** — o dedupe (`route.ts:34-36`) processa só a primeira cópia, mas TODAS as cópias entram em `current_calendar_seen_keys` (inserção no topo do loop, antes do `seenEvents.has`). Meeting gravada sob a chave do segundo calendário deixa de ser apagada (bug atual).
2. **Série recorrente apagada inteira** — instâncias podem não vir como `cancelled` na listagem expandida → caem na verificação `events.get` → 404/410 ou `cancelled` → apagadas corretamente.
3. **Evento movido para fora da janela** (adiado para além de +90d) — some da listagem, mas `events.get` o encontra ativo → meeting mantida com a data antiga até o evento reentrar na janela e o upsert corrigir `starts_at`.
4. **Meeting com `attendance_recorded_at` ou participação** — nunca apagada, mesmo com cancelamento explícito (guardas mantidas nos dois mecanismos).
5. **Meeting passada** (`starts_at < timeMin`) — fora da janela, intocada (histórico preservado, inclusive o backfill).
6. **`google_calendar_id` sem source configurada** (env `GOOGLE_WORKSPACE_SUBJECTS`/`GOOGLE_CALENDAR_IDS` mudou) — já filtrado por `= any(configuredCalendarIds)`; candidata sem source correspondente não é verificável → mantida.
7. **Evento cancelado retornado só com `id` + `status`** (payload mínimo do Google para cancelados) — suficiente: só a chave `(sourceId, eventId)` é usada; nenhum outro campo é lido de eventos cancelados.

### Cenário de Erro
1. **`events.get` falha (rede, quota, 403)** — try/catch por candidata: meeting mantida, erro logado via `console.error`, sync retorna sucesso com a meeting contada em `kept`. Nunca apagar por erro de verificação.
2. **`events.list` falha** — exceção antes de qualquer escrita, transação nem abre → nada apagado (comportamento atual).
3. **Falha no meio da transação principal** — `rollback` existente cobre; deletes por verificação só acontecem após commit bem-sucedido.

## Banco de Dados
Sem migration. Apenas temp tables de sessão (`on commit drop`):
- `current_calendar_seen_keys (calendar_id text, event_id text, primary key (calendar_id, event_id))` — todo evento ativo retornado pelo Google.
- `current_calendar_cancelled_keys (calendar_id text, event_id text, primary key (calendar_id, event_id))` — eventos com `status: cancelled`.
- `current_calendar_sync_keys` permanece como está (usada pelo vínculo automático de mentores, `route.ts:81-118`).

## Arquivos

- **Modificar:** `lib/google-calendar.ts`
  - `listWorkspaceEvents` (linhas 78-133): adicionar `showDeleted: true` ao `calendar.events.list`; no loop de itens, evento com `status === "cancelled"` (e com `id`) vai para um array `cancelledKeys: { calendarId: source.sourceId, eventId: event.id }[]` em vez de ser descartado; retorno muda de `Promise<CalendarEventInput[]>` para `Promise<{ events: CalendarEventInput[]; cancelledKeys: CancelledEventKey[] }>` (exportar `interface CancelledEventKey { calendarId: string; eventId: string }`). Único caller: o route do sync.
  - Nova função exportada `fetchEventStatus(subject: string, calendarId: string, eventId: string): Promise<"active" | "cancelled" | "missing">` — mesma auth JWT delegada de `listWorkspaceEvents`, chama `calendar.events.get({ calendarId, eventId })`; `data.status === "cancelled"` → `"cancelled"`; erro HTTP 404/410 → `"missing"`; qualquer outro sucesso → `"active"`; qualquer outro erro → rethrow (o caller decide manter).
- **Modificar:** `app/api/calendar/sync/route.ts`
  - Linha 20: `const { events, cancelledKeys } = await listWorkspaceEvents(window);`.
  - Após a criação de `current_calendar_sync_keys` (linha 24): criar `current_calendar_seen_keys` e `current_calendar_cancelled_keys` (ambas `on commit drop`); popular `cancelled_keys` com `cancelledKeys`.
  - No topo do loop de eventos (antes do check de `seenEvents`, linha 34): inserir a chave de todo evento em `current_calendar_seen_keys` (`on conflict do nothing`).
  - Substituir o DELETE das linhas 120-133 por:
    1. `DELETE ... where meeting.google_event_id is not null and meeting.google_calendar_id = any($1) and meeting.starts_at between $2 and $3 and meeting.attendance_recorded_at is null and not exists (participação) and exists (select 1 from current_calendar_cancelled_keys ...)` — cancelamento explícito.
    2. `SELECT id, google_calendar_id, google_event_id` das meetings na mesma janela/guardas cuja chave não está em `current_calendar_seen_keys` **nem** em `current_calendar_cancelled_keys` → array em memória de candidatas.
  - Após `commit` (linha 134): para cada candidata, resolver a source via `configuredCalendarSources().find((s) => s.sourceId === meeting.google_calendar_id)` (sem source → manter); chamar `fetchEventStatus(source.subject, source.calendarId, google_event_id)` em try/catch; se `"cancelled"` ou `"missing"`, `delete from public.meetings where id = $1 and attendance_recorded_at is null and not exists (select 1 from public.meeting_participations ...)`; senão manter e incrementar `kept`.
  - Retorno de `runCalendarSync`: `removed` = deletes explícitos + deletes verificados; adicionar campo `kept` (candidatas ausentes da listagem mas mantidas por estarem ativas/inverificáveis).
- **Modificar:** `scripts/backfill-calendar.mjs`
  - Apenas o comentário da linha 117 (`// Cancelados/sem id descartados na coleta — cópia de lib/google-calendar.ts:107`): registrar que o lib passou a usar `showDeleted: true` e a separar chaves canceladas para o delete conservador do sync, e que o backfill segue descartando cancelados de propósito (não executa limpeza). Nenhuma mudança de código.
- **Não tocar:** `scripts/sync-google-calendar.mjs` — cópia legada com delete ainda agressivo e **sem limite de janela** (linhas 151-162); fica registrado aqui como risco conhecido: não deve ser executado em produção até ser alinhado ou removido (fora do escopo desta issue).

## Dependências Externas
- Google Calendar API v3 (já usada via `googleapis`, sem dependência nova):
  - `events.list` com `showDeleted: true` — eventos apagados/cancelados retornam com `status: "cancelled"`; com `singleEvents: true`, instâncias canceladas de séries vêm expandidas, mas série apagada inteira pode não expor instâncias canceladas (coberto pelo `events.get`).
  - `events.get` — 404/410 para evento inexistente; `status: "cancelled"` para cancelado; escopo atual `calendar.events.readonly` é suficiente para ambos.

## Checklist
- [x] `lib/google-calendar.ts`: `showDeleted: true` no `events.list` e retorno `{ events, cancelledKeys }` em `listWorkspaceEvents`
- [x] `lib/google-calendar.ts`: `fetchEventStatus` exportada, tratando 404/410 como `"missing"` e rethrow para outros erros
- [x] `route.ts`: temp table `current_calendar_seen_keys` populada com TODO evento ativo, antes do dedupe/matching/filtros
- [x] `route.ts`: temp table `current_calendar_cancelled_keys` populada com as chaves canceladas
- [x] `route.ts`: DELETE antigo (linhas 120-133) substituído — delete só por chave cancelada explícita, dentro da janela e com guardas de participação/attendance
- [x] `route.ts`: candidatas ausentes selecionadas antes do commit e verificadas com `events.get` após o commit; delete individual re-checa guardas; erro de verificação mantém a meeting
- [x] `route.ts`: resposta inclui `removed` (soma dos dois mecanismos) e `kept`
- [x] `scripts/backfill-calendar.mjs`: comentário da linha 117 atualizado (sem mudança de código)
- [ ] Teste manual: evento que existe mas não casa no matching sobrevive ao sync; evento cancelado no Google some; meeting com participação sobrevive a cancelamento; meeting passada intocada
- [x] Nenhum arquivo além dos três listados modificado
