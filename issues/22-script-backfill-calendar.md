# 22: Script de Backfill de Encontros Históricos do Calendar

**Tipo:** Implementação
**Página:** Módulo B — Backfill de Encontros Históricos do Calendar

## Descrição
Criar script de execução única no padrão dos `scripts/import-*.mjs` (Node `.mjs`, `process.loadEnvFile(".env.local")`, `pg` via `DATABASE_URL`, transação com rollback, relatório no console) que busca com paginação os eventos de todas as fontes configuradas do sync de 2023-02-01 (GMT−03:00) até agora − 24h (nunca invadindo a janela ativa) e cria encontros históricos com as mesmas regras do sync (`app/api/calendar/sync/route.ts`): descarte de cancelados/sem id, matching por e-mail/nome/marca considerando todos os clientes inclusive pausados e encerrados, regex de ignore e de grupo por título, individual só com correspondência única, classificação de frente, upsert pela identidade calendário+id do evento (reexecuções e sync não duplicam) e vínculo automático de mentor apenas quando a frente tem exatamente um mentor e o encontro não tem vínculo. O script não executa limpeza, não cria participações nem altera última participação, e imprime relatório final (período, eventos por calendário, individuais/grupo criados, ignorados por regra/sem correspondência/ambíguos).

**Depende de:** issues 20 e 21 (proteção da limpeza e carga geral restrita devem estar em produção antes de o backfill rodar, senão o cron apaga o histórico e a Agenda regride para 2023).

## Decisões de implementação

**Replicação das regras (decisão central):** um script `.mjs` não importa TypeScript (`app/api/calendar/sync/route.ts`, `lib/google-calendar.ts`, `lib/meeting-front.ts`) sem build/refatoração do app. O precedente já existe no projeto: `scripts/sync-google-calendar.mjs` replica em JS a auth JWT delegada, a normalização, os regexes de ignore/grupo e a classificação de frente. O backfill segue o mesmo caminho: **replicar as regras como cópia fiel, com comentário de origem em cada bloco** apontando o arquivo/linha de referência:
- Normalização (`normalized`), regex de ignore, regex de grupo, filtro de matching (e-mail / nome ≥ 4 chars / marca ≥ 4 chars) e o SQL de upsert → cópia de `app/api/calendar/sync/route.ts` (linhas 9-11, 29-60).
- Classificação de frente → cópia de `lib/meeting-front.ts` (`classifyMeetingFront`), retornando direto os valores do enum do banco (`redes_sociais`/`trafego`/`comercial`/`estrategia`), colapsando `classifyMeetingFront` + `frontLabelToDb` como `scripts/sync-google-calendar.mjs:45-51` já faz.
- Coleta do Calendar (chave privada, subjects × calendários → `sourceId = "subject::calendarId"`, JWT por fonte, `events.list` paginado com `singleEvents: true`, `orderBy: "startTime"`, `maxResults: 250`, descarte de cancelado/sem id, `eventDate` com fallback e correção de `end <= start`, `meetUrl`, `attendeeEmails`) → cópia de `lib/google-calendar.ts` (`privateKey`, `configuredCalendarSources`, `listWorkspaceEvents`); `scripts/sync-google-calendar.mjs:6-103` já tem essa réplica pronta em JS para servir de base.
- SQL do vínculo automático de mentor → cópia **apenas do INSERT** de `app/api/calendar/sync/route.ts:80-99` (ver abaixo).

**Janela histórica:** `timeMin = "2023-02-01T00:00:00-03:00"` (fixo); `timeMax = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()` — espelho exato de `activeSyncWindow().timeMin` (`lib/google-calendar.ts:71-76`), calculado uma única vez no início. O backfill termina exatamente onde a janela ativa do sync começa; eventos na borda que ambos vejam não duplicam porque a identidade do upsert é a mesma.

**Matching com todos os clientes:** a query de mentorados é `select id, name, company, lower(email) as email from public.mentees` — **sem** o `where status <> 'closed'` do sync (diferença intencional documentada no comentário: o histórico pertence ao passado; cliente hoje encerrado tinha encontros quando era ativo).

**Mentor automático — só inserção:** replicar o padrão da temp table do sync (`create temp table backfill_calendar_keys (calendar_id text, event_id text, primary key (...)) on commit drop`, populada a cada upsert) e rodar **somente** o INSERT set-based de `meeting_mentors` (frente com exatamente um mentor, `where not exists` vínculo existente, `source = 'auto'`, `on conflict do nothing`). O DELETE de vínculos `auto` divergentes do sync (`route.ts:62-79`) **não** é replicado — a spec proíbe alterar vínculos existentes, automáticos ou manuais.

**Sem limpeza, sem participações:** nenhum `delete from public.meetings`, nenhuma escrita em `meeting_participations`, nenhuma atualização de `attendance_recorded_at` ou de última participação do cliente.

**Contadores separados:** diferente do sync (que agrega tudo em `ignored`), o backfill classifica cada evento em exatamente um destino: `ignoradoPorRegra` (regex de ignore), `grupo`, `individual`, `semCorrespondencia` (0 matches, sem regex de grupo), `ambiguo` (2+ matches, sem regex de grupo). Contagem de eventos lidos por calendário registrada por `sourceId` durante a coleta.

**Estrutura de execução:** coleta do Calendar fora da transação (como o sync); depois `connect` → query de mentees → `begin` → temp table → loop de upserts → INSERT de mentores → `commit` → relatório. Falha em qualquer ponto: `rollback`, mensagem no `console.error`, `process.exitCode = 1` (padrão de `scripts/import-briefing.mjs:99-105`). Execução: `node scripts/backfill-calendar.mjs` (sem entrada em `package.json`, como os demais scripts de importação).

## Cenários

1. **Coleta histórica paginada:** para cada fonte configurada (subjects × calendários — as mesmas do sync), o script pagina `events.list` com `timeMin = 2023-02-01T00:00:00-03:00` e `timeMax = agora − 24h` até esgotar `nextPageToken` (~8,6k eventos nos 4 calendários), contando eventos lidos por calendário.
2. **Nunca invade a janela ativa:** nenhum evento com início a partir de agora − 24h é buscado (o `timeMax` do backfill é idêntico ao `timeMin` de `activeSyncWindow()`); evento exatamente na borda que apareça nas duas execuções não duplica (mesma identidade de upsert).
3. **Cancelados/sem id descartados:** evento com `status === "cancelled"` ou sem `id` é pulado na coleta, exatamente como no sync (não entra em nenhum contador de ignore do relatório — não chega à fase de matching).
4. **Matching inclui pausados e encerrados:** evento de 2023 cujo participante tem o e-mail de um cliente hoje com `status = 'closed'` casa normalmente e vira encontro individual desse cliente. Mesmas três regras do sync: e-mail do participante, nome normalizado ≥ 4 caracteres contido no texto, marca normalizada ≥ 4 caracteres contida no texto (título+descrição normalizados).
5. **Ignore por título:** evento cujo título bate no regex de ignore do sync (workshop AE, reunião interna, daily, almoço, bloqueio de agenda, reunião comercial, `1:1 |`) é descartado e contado em "ignorados por regra", mesmo que algum cliente case.
6. **Grupo por título:** evento cujo título bate no regex de grupo (plantão atacado exponencial, mentoria em grupo, clínica de vendas) vira encontro `type = 'group'` sem exigir correspondência de cliente (`individual_mentee_id = null`).
7. **Individual só com match único:** exatamente 1 cliente casa → encontro `type = 'individual'` com `individual_mentee_id`. 0 clientes → contado em "sem correspondência", nada criado. 2+ clientes → contado em "ambíguos", nada criado.
8. **Frente classificada:** cada encontro criado recebe `front` pela mesma classificação do sync (redes sociais → tráfego → comercial → estratégia como fallback), sobre título+descrição normalizados.
9. **Upsert idempotente:** reexecutar o script não duplica nenhum encontro; evento que o sync já tenha criado (ex.: encontro antigo ainda no banco) é atualizado pelo `on conflict (google_calendar_id, google_event_id) do update` com título/datas/meet_url/type/front/individual_mentee_id, nunca inserido de novo.
10. **Mentor automático conservador:** encontro criado pelo backfill cuja frente tem exatamente um mentor cadastrado e que não tem nenhum vínculo em `meeting_mentors` → recebe vínculo `source = 'auto'`. Encontro que já tem qualquer vínculo (auto ou manual) → intocado. Frente com 0 ou 2+ mentores → nenhum vínculo criado. Nenhum vínculo existente é removido ou alterado (o DELETE do sync não existe no script).
11. **Nada além de meetings/meeting_mentors:** o script não deleta encontros, não escreve em `meeting_participations`, não altera `attendance_recorded_at` nem qualquer campo de última participação dos clientes.
12. **Transação única:** erro no meio do loop (ex.: queda de conexão) → `rollback`, nenhum encontro parcial persiste, mensagem de erro no console e `process.exitCode = 1`.
13. **Relatório final:** ao commitar, imprime período coberto (timeMin/timeMax), total de eventos lidos por calendário (por `sourceId`), encontros individuais criados/atualizados, encontros em grupo criados/atualizados, ignorados por regra de título, sem correspondência e ambíguos — cada contagem separada.

## Arquivos

### Criar
- **`scripts/backfill-calendar.mjs`** — script completo, nesta estrutura:
  - Cabeçalho: comentário explicando que é backfill de execução única e que as regras de matching/ignore/grupo/frente/upsert/mentor-auto são cópia fiel de `app/api/calendar/sync/route.ts` + `lib/meeting-front.ts` + `lib/google-calendar.ts` (qualquer mudança lá deve ser espelhada aqui se o script for reexecutado).
  - `process.loadEnvFile(".env.local")`; validação de `DATABASE_URL`, `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, subjects (`GOOGLE_WORKSPACE_SUBJECTS`/`GOOGLE_WORKSPACE_SUBJECT`) — mesmo bloco de `scripts/sync-google-calendar.mjs:5-42`.
  - Réplicas comentadas: `normalize`, `classifyMeetingFront` (retorna valor do enum db), `eventDate`, regexes de ignore e grupo.
  - Janela: `timeMin` fixo 2023-02-01T00:00:00-03:00; `timeMax = agora − 24h` (comentário referenciando `activeSyncWindow()`).
  - Coleta paginada por fonte com contador por `sourceId`.
  - Conexão `pg` (`ssl` condicional a `localhost`, `connectionTimeoutMillis`), query de mentees **sem filtro de status**, `begin`, temp table `backfill_calendar_keys ... on commit drop`, loop de classificação + upsert (SQL idêntico ao do sync), INSERT set-based de `meeting_mentors` (só inserção), `commit`.
  - Relatório no console; `catch` com `rollback` + `process.exitCode = 1`; `finally` com `end()`.

### Modificar
- Nenhum.

### Não tocar
`app/api/calendar/sync/route.ts`, `lib/google-calendar.ts`, `lib/meeting-front.ts`, `lib/supabase/data.ts`, `scripts/sync-google-calendar.mjs`, `scripts/import-briefing.mjs`, `package.json`, `supabase/migrations/**`.

## Checklist

- [x] `scripts/backfill-calendar.mjs` criado no padrão dos scripts existentes (`.mjs`, `process.loadEnvFile(".env.local")`, `pg` via `DATABASE_URL`, transação com rollback, relatório no console)
- [x] Regras replicadas com comentário de origem (route do sync, `lib/meeting-front.ts`, `lib/google-calendar.ts`) — sem import de TypeScript e sem refatoração do app
- [x] Janela: `timeMin` fixo `2023-02-01T00:00:00-03:00` e `timeMax = agora − 24h`, calculados uma vez; nunca invade a janela ativa do sync
- [x] Coleta com paginação em todas as fontes configuradas (mesmos subjects × calendários do sync), descartando cancelados/sem id, com contagem de eventos por calendário
- [x] Query de mentees **sem** `where status <> 'closed'` (pausados e encerrados participam do matching), com comentário justificando a diferença ante o sync
- [x] Matching/ignore/grupo/individual-único/frente idênticos ao sync; contadores separados para ignorados por regra, sem correspondência e ambíguos
- [x] Upsert com `on conflict (google_calendar_id, google_event_id) do update` idêntico ao do sync — reexecuções e convivência com o sync não duplicam
- [x] Vínculo automático de mentor: apenas o INSERT (frente com exatamente um mentor, encontro sem vínculo, `source = 'auto'`, `on conflict do nothing`); o DELETE de vínculos divergentes do sync NÃO é replicado
- [x] Nenhuma limpeza de `meetings`, nenhuma escrita em `meeting_participations`, nenhum toque em `attendance_recorded_at`/última participação
- [x] Tudo em transação única: falha → rollback total + `process.exitCode = 1`
- [x] Relatório final imprime período, eventos por calendário, individuais, grupos, ignorados por regra, sem correspondência e ambíguos
- [x] Nenhum arquivo além de `scripts/backfill-calendar.mjs` criado/modificado
- [x] Verificação: `node --check scripts/backfill-calendar.mjs` passa; execução real só após issues 20 e 21 em produção
