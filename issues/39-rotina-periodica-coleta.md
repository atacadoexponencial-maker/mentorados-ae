# 39: Rotina periódica de coleta com retry
**Tipo:** Implementação
**Página:** Módulo A — Coleta Automática de Participação
## Descrição
Criar o endpoint de rotina (`app/api/participation/collect/route.ts`, acionado por cron como o sync atual) que varre os encontros já encerrados com link do Meet, sem confirmação manual e sem coleta automática concluída, e executa o registro automático (issue 38). Se os dados da reunião ainda não estiverem disponíveis no Google, o encontro permanece pendente e é retentado nas próximas execuções, até conseguir ou até o mentor registrar manualmente; encontros sem link do Meet ficam fora da rotina.

## Decisões de Implementação
- **Rota:** `app/api/participation/collect/route.ts` (mantém o domínio "participation", consistente com `app/api/meetings/[id]/participation`). `GET` protegido por `CRON_SECRET` e `POST` protegido por sessão Supabase — mesmíssimo padrão de `app/api/calendar/sync/route.ts` (reusar a estrutura dos handlers de lá).
- **Frequência do cron:** `0 */3 * * *` (a cada 3 horas). Segundo entry em `vercel.json`, ao lado do sync diário. Observação: cron com frequência sub-diária exige plano Pro na Vercel; se o projeto estiver em Hobby, usar `30 10 * * *` (30 min após o sync) como fallback e registrar isso no PR.
- **Limite por execução:** máximo de **25 encontros por run**, ordenados por `auto_collect_attempted_at asc nulls first, ends_at asc` — nunca-tentados primeiro e depois round-robin pelos menos recentemente tentados, evitando que encontros "mortos" (link do Meet nunca usado) monopolizem o run. Com `export const maxDuration = 300` (Fluid Compute), 25 encontros × (conferenceRecords.list + participants.list + Directory) cabem com folga.
- **Elegibilidade (query):** `meet_url is not null` AND `ends_at <= now() - interval '15 minutes'` (buffer para o Google fechar o conference record) AND `ends_at >= now() - interval '7 days'` (janela de retry) AND `attendance_recorded_at is null` (sem confirmação manual) AND `auto_collected_at is null` (coleta ainda não concluída) AND `(auto_collect_attempted_at is null or auto_collect_attempted_at < now() - interval '2 hours')` (não retentar o mesmo encontro dentro do mesmo ciclo).
- **Desistência do retry:** implícita e sem estado extra — encontro com `ends_at` mais antigo que 7 dias sai da janela e nunca mais é tentado; encontro confirmado manualmente (`attendance_recorded_at` preenchido) sai imediatamente. Sem contador de tentativas.
- **Backfill retroativo inicial:** conservador e explícito — a janela padrão é 7 dias; o `POST` autenticado aceita `?days=N` (cap em **30**) para uma única execução manual pós-deploy cobrindo os últimos 30 dias. O cron (`GET`) ignora o parâmetro e usa sempre 7 dias.
- **Idempotência:** sucesso grava `auto_collected_at` no meeting (campo da issue 36) → encontro sai da query; o upsert da issue 38 respeita `unique (meeting_id, mentee_id)`; re-execução da rota não duplica nada nem toca encontros já confirmados manualmente. `auto_collect_attempted_at` é gravado no **início** da tentativa de cada encontro (evita hot-loop se o processo morrer no meio).

## Cenários

### Happy Path
1. Cron dispara `GET /api/participation/collect` com `Authorization: Bearer ${CRON_SECRET}`.
2. A rota seleciona até 25 encontros elegíveis (encerrados há ≥15 min, com `meet_url`, dentro da janela de 7 dias, sem `attendance_recorded_at` e sem `auto_collected_at`).
3. Para cada encontro: grava `auto_collect_attempted_at = now()`, chama a função da issue 38 (que usa `lib/google-meet.ts` da issue 37 para obter os participantes reais e grava as participações com origem automática).
4. Coleta bem-sucedida → issue 38 marca `auto_collected_at`; o encontro nunca mais entra na varredura.
5. Resposta JSON com o resumo: `{ scanned, collected, pending, failed }` (mesmo estilo do resumo do sync).

### Edge Cases
- **Dados ainda não disponíveis no Google** (conference record inexistente/incompleto — retorno distinguível da issue 37): encontro conta como `pending`, `auto_collect_attempted_at` fica gravado, e ele é retentado a partir do próximo run após 2h — até conseguir, ser confirmado manualmente ou sair da janela de 7 dias.
- **Encontro sem `meet_url`:** nunca entra na query — fora da rotina, registro só manual.
- **Encontro confirmado manualmente entre runs** (`attendance_recorded_at` preenchido): sai da elegibilidade; a rotina nunca sobrescreve confirmação manual (guarda dupla: query + regra da issue 38).
- **Link do Meet criado mas reunião nunca aconteceu:** permanece `pending` e é retentado em round-robin até `ends_at` completar 7 dias; depois desiste silenciosamente.
- **Mais de 25 encontros elegíveis** (ex.: backfill de 30 dias): processa 25 e os demais ficam para os próximos runs — a ordenação `nulls first` garante que os nunca-tentados têm prioridade.
- **Duas execuções próximas** (retry da Vercel, disparo manual + cron): o filtro `auto_collect_attempted_at < now() - 2h` e a idempotência do upsert impedem trabalho duplicado.
- **`POST ?days=45`:** cap em 30 dias — nunca varre além disso.

### Cenário de Erro
- **`CRON_SECRET` ausente ou header inválido no `GET`:** 401, nada executa (idêntico ao sync).
- **Token de sessão inválido no `POST`:** 401.
- **Falha em um encontro específico** (erro de API Google, quota, encontro deletado no meio): try/catch por encontro — loga com `console.error`, conta em `failed` e **continua** o loop; um encontro problemático nunca derruba o run. `auto_collect_attempted_at` já gravado garante que ele espera 2h antes do próximo retry.
- **Falha de conexão com o banco / erro fatal:** 500 com mensagem, mesmo formato do sync; encontros já processados neste run permanecem gravados (cada coleta da issue 38 é sua própria transação).

## Banco de Dados
Nenhuma migration nesta issue — usa os campos de controle criados na issue 36 (nomes assumidos; ajustar aos nomes reais da migration da 36 se divergirem):
- `public.meetings.auto_collected_at timestamptz` — coleta automática concluída (gravado pela issue 38; aqui só filtrado).
- `public.meetings.auto_collect_attempted_at timestamptz` — última tentativa de coleta (gravado por esta rotina no início de cada tentativa; filtrado na query de elegibilidade).
- `public.meeting_participations.source` — origem da linha (gravado pela issue 38; não tocado aqui).
- `public.meetings.attendance_recorded_at` (já existe) — confirmação manual; presença dele exclui o encontro da rotina.

## Arquivos

### Criar
- `app/api/participation/collect/route.ts` — rota com `runtime = "nodejs"`, `maxDuration = 300`; handler `GET` (CRON_SECRET) e `POST` (sessão Supabase, aceita `?days=N` cap 30) seguindo o padrão de `app/api/calendar/sync/route.ts`; função interna `runParticipationCollect(windowDays)` que faz a query de elegibilidade via `pg` (mesmo padrão de conexão do sync), grava `auto_collect_attempted_at` e chama a função de registro automático da issue 38 por encontro, acumulando o resumo.

### Modificar
- `vercel.json` — adicionar `{ "path": "/api/participation/collect", "schedule": "0 */3 * * *" }` ao array `crons`.

## Checklist
- [ ] `GET` sem/erro de `CRON_SECRET` retorna 401 e não executa nada
- [ ] `POST` exige sessão Supabase válida (mesmo fluxo do sync)
- [ ] Query de elegibilidade cobre todas as condições: `meet_url` presente, encerrado há ≥15 min, janela de 7 dias (ou `days` no POST, cap 30), sem `attendance_recorded_at`, sem `auto_collected_at`, última tentativa há mais de 2h
- [ ] Limite de 25 encontros por execução com ordenação `auto_collect_attempted_at asc nulls first, ends_at asc`
- [ ] `auto_collect_attempted_at` gravado no início da tentativa de cada encontro
- [ ] Falha em um encontro não interrompe os demais (try/catch por item, contado em `failed`)
- [ ] Retorno "dados indisponíveis" da issue 37/38 tratado como `pending` (não como erro)
- [ ] Encontros confirmados manualmente nunca são tocados
- [ ] Resposta JSON com resumo `{ scanned, collected, pending, failed }`
- [ ] `maxDuration = 300` e `runtime = "nodejs"` exportados na rota
- [ ] Novo entry de cron em `vercel.json` (`0 */3 * * *`)
- [ ] Nenhum arquivo fora da lista acima foi modificado
- [ ] Backfill inicial documentado: uma execução manual `POST ?days=30` após o deploy
