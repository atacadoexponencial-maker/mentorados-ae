# 30: Preservação de meetings de mentorados encerrados (closed)
**Tipo:** Implementação
**Página:** Módulo D — Completude da Agenda
## Descrição
Garantir no sync (`app/api/calendar/sync/route.ts`) que meetings já persistidas e vinculadas a mentorados com `status = 'closed'` não sejam apagadas nem percam o vínculo quando o mentorado sai do universo de matching. O matching de eventos novos continua considerando apenas mentorados ativos; a mudança é apenas de preservação: evento já casado permanece na plataforma com seu vínculo original.

## Contexto e delta ante a issue 29 (pré-requisito)
A issue 29 (delete conservador) será implementada ANTES desta. Com ela, o bloco de limpeza só apaga meetings cujo evento foi de fato cancelado/removido no Google — "deixou de casar no matching" deixa de ser motivo de exclusão. Portanto, **a não-exclusão de meetings de mentorados closed já fica coberta pela 29** e esta issue NÃO mexe no bloco de delete.

O delta desta issue é o vetor restante de perda de vínculo: o **upsert** (`route.ts`, linhas ~66-79). O `on conflict ... do update set type = excluded.type, individual_mentee_id = excluded.individual_mentee_id` pode sobrescrever o vínculo de uma meeting já ligada a mentorado closed quando o mesmo evento volta a casar sob outra interpretação:
- o evento antes casava com 2 mentorados (ambíguo, mas a meeting foi criada quando só um casava); com o closed fora do universo, passa a casar unicamente com outro mentorado ativo → `individual_mentee_id` seria "roubado";
- o título do evento passa a casar `groupByTitle` → `type` viraria `group` e `individual_mentee_id` viraria `null`.

Correção: no `ON CONFLICT DO UPDATE`, preservar `type` e `individual_mentee_id` quando a linha existente já aponta para mentorado closed:

```sql
type = case
  when exists (select 1 from public.mentees m where m.id = meetings.individual_mentee_id and m.status = 'closed')
  then meetings.type else excluded.type end,
individual_mentee_id = case
  when exists (select 1 from public.mentees m where m.id = meetings.individual_mentee_id and m.status = 'closed')
  then meetings.individual_mentee_id else excluded.individual_mentee_id end
```

(`meetings.` referencia a linha existente dentro do `ON CONFLICT`.) Os demais campos (`title`, `starts_at`, `ends_at`, `meet_url`, `front`) continuam atualizando normalmente — é o mesmo evento do Google, apenas o vínculo é congelado. Alternativa, caso a subquery no `SET` cause problema: buscar `select id from public.mentees where status = 'closed'` junto à query da linha 22 e usar `meetings.individual_mentee_id = any($10::uuid[])` no `CASE`.

A query de matching da linha 22 (`where status <> 'closed'`) **não muda** — eventos novos de mentorado closed continuam sem virar meeting; apenas ganha comentário documentando que a exclusão é intencional e que a preservação do já-persistido é garantida pelo upsert + delete conservador.

## Cenários

### Happy Path
1. Mentorado A tem meetings sincronizadas e vira `closed`. No próximo sync: os eventos de A não casam mais (universo só ativos), não entram em `current_calendar_sync_keys`, mas os eventos seguem existindo no Google → o delete conservador (issue 29) não os apaga e o upsert não roda para eles. As meetings permanecem no banco com `individual_mentee_id = A` (histórico intacto).
2. Evento novo criado no calendário para mentorado closed: não casa, não vira meeting (comportamento atual preservado).

### Edge Cases
1. **Re-matching para outro mentorado**: evento já vinculado ao closed A passa a casar unicamente com o ativo B (antes eram 2 matches). Sem a guarda, o upsert reescreveria o vínculo para B; com a guarda, `type` e `individual_mentee_id` permanecem de A. (`title`/`starts_at`/`ends_at`/`meet_url`/`front` atualizam.)
2. **Título vira grupo**: evento vinculado ao closed A é renomeado para algo que casa `groupByTitle`. Sem a guarda, viraria `type='group'` com `individual_mentee_id=null`; com a guarda, mantém `individual`/A.
3. **Evento realmente cancelado no Google** (dentro da janela): a meeting do mentorado closed É apagada pelo delete conservador da 29 — correto, o encontro não aconteceu. Exceções da 29 continuam valendo (participação registrada/`attendance_recorded_at` nunca apaga).
4. **Reativação**: mentorado volta de `closed` para `active`. A guarda deixa de disparar (o `exists` só olha `status = 'closed'`) e o upsert volta a atualizar vínculo normalmente. Nenhum código extra necessário.
5. **Mentorado `paused`**: já está no universo (`<> 'closed'`), nada muda.
6. **Meetings fora da janela de sync**: nunca tocadas (garantia pré-existente do delete por `starts_at` dentro da janela).
7. **Backfill**: `scripts/backfill-calendar.mjs` inclui mentorados closed no matching de propósito (linha ~145-147), então o vínculo nunca "sai do universo" lá e a guarda não é necessária — apenas o comentário "SQL idêntico" (linha ~210) precisa registrar a divergência intencional.

### Cenário de Erro
- Falha no meio do sync: a guarda vive dentro do mesmo statement de upsert, coberto pela transação existente (`begin`/`commit`/`rollback`) — nenhum modo de falha novo.
- Se o Postgres rejeitar a subquery no `SET` do `ON CONFLICT` (não deve — subqueries são permitidas ali; a restrição é só no conflict target), usar a alternativa com array de ids closed passado por parâmetro.

## Banco de Dados
Nenhuma migração. Usa a coluna existente `public.mentees.status` (enum `public.mentee_status`: `'active' | 'paused' | 'closed'`, definido em `supabase/migrations/202606300001_initial_schema.sql`). A subquery da guarda busca por PK (`mentees.id`) — sem necessidade de índice novo.

## Arquivos
**Modificar:**
- `C:\Users\marce\OneDrive\gestao-de-mentorados\app\api\calendar\sync\route.ts`
  - Linhas ~66-79 (upsert): adicionar `CASE`/`EXISTS` preservando `type` e `individual_mentee_id` quando a meeting existente está vinculada a mentorado closed.
  - Linha ~22: comentário documentando que `status <> 'closed'` é intencional (só matching de novos eventos) e onde a preservação acontece.
- `C:\Users\marce\OneDrive\gestao-de-mentorados\scripts\backfill-calendar.mjs`
  - Apenas comentário (linha ~210-211): o SQL do upsert deixa de ser "idêntico" ao do sync; registrar que a guarda de closed não se aplica ao backfill porque lá o universo de matching inclui closed.

Fora do escopo (registrar, não tocar): `scripts/sync-google-calendar.mjs` é um espelho manual/legado com delete NÃO conservador (linha ~151) — se for reexecutado após esta issue, apagaria meetings de mentorados closed. Não alterar aqui; o cron de produção usa `route.ts`.

## Dependências Externas
Nenhuma dependência externa nova. Dependência interna: **issue 29 implementada antes** — esta issue assume o delete conservador em produção e não replica nada dele.

## Checklist
- [x] Confirmar que a issue 29 está implementada e que sua checagem de "evento ainda existe no Google" considera TODOS os eventos coletados por `listWorkspaceEvents` (inclusive os que não casaram no matching) — é isso que blinda as meetings de closed contra o delete.
- [x] `route.ts`: adicionar guarda de preservação de `type` e `individual_mentee_id` no `ON CONFLICT DO UPDATE` do upsert (linhas ~66-79).
- [x] `route.ts`: comentário na query de mentees (linha ~22) explicando a exclusão intencional de closed.
- [x] `scripts/backfill-calendar.mjs`: atualizar comentário do upsert (linha ~210) registrando a divergência intencional.
- [x] Não alterar o bloco de delete (issue 29), o delete/insert de `meeting_mentors`, nem o universo de matching.
- [x] Testar cenário de re-matching: meeting vinculada a mentorado closed cujo evento casa com outro mentorado ativo → vínculo original mantido após sync.
- [x] Testar cenário base: mentorado vira closed → após sync, meetings existentes permanecem com o vínculo; evento novo dele não cria meeting.
- [x] Testar reativação: mentorado volta a `active` → upsert volta a atualizar o vínculo normalmente.
