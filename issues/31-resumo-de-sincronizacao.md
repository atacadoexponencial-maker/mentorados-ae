# 31: Resumo de sincronização (sincronizados / ignorados / removidos)
**Tipo:** Implementação
**Página:** Módulo D — Completude da Agenda
## Descrição
Fazer cada execução de `app/api/calendar/sync/route.ts` retornar (e logar) um resumo de auditoria: total de encontros sincronizados, lista de eventos ignorados com título e motivo (regex de ignore, sem matching, matching ambíguo, etc.) e lista de removidos. Serve para a equipe detectar falsos positivos dos filtros — as regex de ignore em si NÃO devem ser alteradas (regra de negócio confirmada).

## Contexto do código atual
- `runCalendarSync()` (route.ts:13-142) já retorna `{ synced, individual, group, ignored, removed }`, mas `ignored` é um contador único que soma quatro situações distintas sem registrar título nem motivo:
  1. **Duplicado** — mesmo evento presente no calendário de 2+ mentores, `seenEvents` (route.ts:35);
  2. **Regra de negócio** — `ignoreByTitle` (route.ts:51-56): workshop AE, reunião interna, daily, almoço, bloqueio, reunião comercial, `1:1 |`, `R1/R2`, `EXT |`, CRM, Kommo, Entrevista(s);
  3. **Sem correspondência** — `matches.length === 0` e não é grupo (route.ts:58-59);
  4. **Ambíguo** — `matches.length > 1` e não é grupo (route.ts:58-59).
- Removidos: o `delete from public.meetings` (route.ts:120-133) retorna só `rowCount`; os títulos se perdem.
- Disparo: cron diário da Vercel via `GET` (`vercel.json`, `0 10 * * *`, autenticado por `CRON_SECRET`) e botão "Sincronizar agora" na sidebar via `POST` (`components/mentoria-app.tsx:185` → `syncGoogleCalendar()` em `lib/supabase/data.ts:175-186`).
- Não existe nenhuma tabela de log no schema (`supabase/migrations/`): é preciso criar uma.

## Cenários

### Happy Path
- Execução do sync (cron ou manual) processa a janela ativa e, dentro da mesma transação já existente, insere **1 linha** em `public.calendar_sync_runs` com: origem (`trigger`: `cron` | `manual`), totais (`synced`, `individual`, `group`, `ignored`, `removed`) e dois arrays jsonb — `ignored_events` (`[{ title, starts_at, reason }]`) e `removed_events` (`[{ title, starts_at }]`).
- Motivos possíveis em `reason` (strings fixas): `"duplicado"`, `"regra_de_negocio"`, `"sem_correspondencia"`, `"ambiguo"`. No caso `"ambiguo"`, o item inclui também `matches: string[]` com os nomes/marcas dos mentorados que casaram, para a equipe auditar o conflito.
- Para capturar os removidos, o `DELETE` de limpeza ganha `returning title, starts_at` (nenhuma condição do delete muda).
- A resposta HTTP (POST e GET) passa a incluir os mesmos dados: `{ synced, individual, group, ignored, removed, ignoredEvents, removedEvents }` — campos atuais preservados, nada é renomeado.
- O botão da sidebar continua funcionando sem alteração (`notify` usa só `result.synced`, que permanece na resposta).

### Edge Cases
- **Nenhum evento na janela**: linha de log gravada com totais zerados e arrays vazios (`[]`) — a ausência de linha significaria "sync não rodou", o que é informação diferente.
- **Duplicado de um evento que seria ignorado por título**: a checagem de dedupe vem antes (route.ts:35), então o motivo registrado é `"duplicado"` — comportamento atual preservado, apenas documentado no log.
- **Evento de grupo** (`groupByTitle`): nunca entra em `ignored_events` — é sincronizado como hoje.
- **Janela grande com muitos ignorados**: os arrays jsonb crescem linearmente com a janela ativa (limitada por `activeSyncWindow()`); sem paginação nem truncamento nesta issue.
- **Volume da tabela**: cron diário ≈ 30 linhas/mês; sem rotina de retenção nesta issue.

### Cenário de Erro
- Falha em qualquer ponto do sync: `rollback` descarta também o insert do log (ele está na mesma transação) — execuções com erro não geram linha de resumo, e a resposta continua sendo o `500 { error }` atual. Nenhum novo estado de erro é introduzido.
- `CRON_SECRET` ausente/sessão inválida: 401 atual, sem log (o sync nem inicia).

## Banco de Dados
Nova migration `supabase/migrations/202607170001_calendar_sync_runs.sql`:

```sql
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
```

Sem alteração em `lib/supabase/database.types.ts`: a tabela é escrita e lida apenas pelo backend via `pg` nesta issue (nenhum acesso via cliente Supabase do browser).

## Arquivos

### Criar
- `supabase/migrations/202607170001_calendar_sync_runs.sql` — tabela de log + RLS (SQL acima).

### Modificar
- `app/api/calendar/sync/route.ts` —
  1. `runCalendarSync(trigger: "cron" | "manual")` recebe a origem (POST passa `"manual"`, GET passa `"cron"`);
  2. no loop (route.ts:32-80), substituir os três `ignored += 1` por push em um array `ignoredEvents` com `{ title: event.title, starts_at: event.startsAt, reason }` (motivos: `duplicado` na linha 35; `regra_de_negocio` quando `ignoreByTitle`; `sem_correspondencia` quando `matches.length === 0`; `ambiguo` quando `matches.length > 1`, incluindo `matches` com os nomes) — `ignored` vira `ignoredEvents.length`;
  3. adicionar `returning title, starts_at` ao DELETE de limpeza (route.ts:120-133) e montar `removedEvents` a partir de `removed.rows`;
  4. antes do `commit`, `insert into public.calendar_sync_runs (...)` com os totais e os dois arrays (`JSON.stringify` para os jsonb);
  5. retorno de `runCalendarSync` passa a incluir `ignoredEvents` e `removedEvents`.
  **As regex `ignoreByTitle`/`groupByTitle` e todas as condições de matching, upsert, mentor auto e delete permanecem intocadas.**

Nenhum outro arquivo é tocado: `vercel.json`, `lib/supabase/data.ts`, `components/mentoria-app.tsx` e `scripts/backfill-calendar.mjs` ficam fora do escopo (o backfill é script único de execução manual e tem relatório próprio; a UI não muda nesta issue).

## Dependências Externas
Nenhuma nova. Usa `pg` e a transação já existentes; migration aplicada com o fluxo padrão do projeto (`npm run db:migrate`).

## Checklist
- [x] Migration cria `public.calendar_sync_runs` com RLS habilitado e policy de leitura para `authenticated`
- [x] Cada execução bem-sucedida do sync (cron e manual) grava exatamente 1 linha de log com `trigger` correto (gravada após a fase de verificação pós-commit, para incluir os removidos dos dois estágios do delete conservador)
- [x] Cada evento ignorado aparece em `ignored_events` com título, data e um dos quatro motivos; caso `ambiguo` inclui os nomes dos mentorados que casaram
- [x] Eventos removidos aparecem em `removed_events` com título e data (via `returning` nos dois estágios do DELETE, sem mudar as condições do delete)
- [x] Resposta HTTP mantém `{ synced, individual, group, ignored, removed }` (e `kept`) e adiciona `ignoredEvents` / `removedEvents` (botão da sidebar segue funcionando sem alteração)
- [x] Regex de ignore e de grupo byte a byte idênticas às atuais; matching, upsert, mentor auto e delete inalterados
- [x] Falha no sync faz rollback sem gravar linha de log; resposta de erro igual à atual
- [x] `npx tsc --noEmit` passa; nenhum arquivo além dos dois listados foi criado/modificado
