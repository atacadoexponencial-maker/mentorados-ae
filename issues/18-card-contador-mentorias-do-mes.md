# 18: Card "Mentorias do Mês" na Visão Geral

**Tipo:** Implementação
**Página:** Módulo D (Visão geral)

## Descrição
Calcular no servidor, para cada mentor, quantos encontros vinculados a ele (vínculo vigente, automático ou manual) têm início dentro do mês corrente e já passaram, separados por tipo (Individual e Grupo) com total por mentor — sem contar encontros futuros, de meses anteriores ou sem mentor. Exibir o card "Mentorias do mês" na Visão geral com uma linha por mentor que tenha ao menos um vínculo (mesmo com contagem zero), a referência do mês corrente e o estado vazio quando não houver mentoria realizada; a contagem reflete correções manuais e novos syncs.

## Decisões de Implementação

- **Cálculo 100% no servidor** (thin client): novo serviço `lib/mentor-month-stats-server.ts` com `pg`, seguindo exatamente o padrão de `lib/participation-server.ts` / `lib/meeting-mentor-server.ts` (connectionString via `DATABASE_URL`, ssl condicional, `connectionTimeoutMillis: 15_000`, `db.end()` no finally). Aqui é só leitura — sem transação.
- **Rota autenticada** `GET /api/mentors/monthly-stats` seguindo o padrão de `app/api/meetings/[id]/mentor/route.ts`: `requireTeamUser` de `lib/api-auth.ts`, `export const runtime = "nodejs"`, erros como `{ error }` com status.
- **Fuso horário**: "mês corrente" definido em `America/Sao_Paulo` direto no SQL via `date_trunc('month', now() at time zone 'America/Sao_Paulo')` comparado com `starts_at at time zone 'America/Sao_Paulo'`. "Já passou" é comparação de instante: `starts_at <= now()` (independe de fuso). A referência do mês retorna do servidor (`to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM')`) para o cliente apenas formatar — evita divergência de fuso do navegador na virada do mês.
- **Resposta da rota**: `{ month: "2026-07", stats: [{ mentorId, name, individual, group, total }] }`, ordenado por nome. `stats` contém apenas mentores com ao menos uma linha em `meeting_mentors` (vínculo vigente, `source` auto ou manual — a coluna `source` não filtra nada).
- **Cliente**: função `loadMentorMonthStats()` em `lib/supabase/data.ts` com `fetch` + `teamAuthHeader()` (mesmo padrão de `updateMeetingMentor`). Estado `mentorMonthStats` no `MentoriaApp`; carregado dentro de `refreshData()` (com try/catch próprio para não derrubar o dashboard inteiro se só essa chamada falhar) e recarregado após `handleMentorChange` bem-sucedido (correção manual altera contagem) — o sync do Calendar já chama `refreshData()` e cobre o caso de novos syncs.
- **UI**: quinto card na `.dashboard-grid` do `Dashboard` em `components/mentoria-app.tsx`, reusando `CardTitle` (eyebrow com a referência do mês, ex.: `CARGA DO TIME · JULHO DE 2026`, title "Mentorias do mês", action "Ver agenda" → `seeAll("agenda")`) e `Empty` para o estado vazio. Formatação do mês com `Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })` sobre `"${month}-15T12:00:00-03:00"` (dia 15 para evitar rollover de fuso).
- **Estado vazio vs. linhas zeradas** (conciliação das duas regras da spec): se a soma dos totais do mês for 0 (ou não houver mentor com vínculo), exibe o estado vazio; caso contrário, exibe uma linha por mentor com vínculo, incluindo os que estão zerados no mês.
- **Sem migration**: tabelas `mentors`, `meeting_mentors` (com `source`) e `meetings` já têm tudo o que a consulta precisa.

## Cenários

### Happy Path
1. Equipe autenticada abre a Visão geral em julho/2026. Existem 2 mentores com vínculos: Ana tem 3 encontros individuais e 1 em grupo já realizados no mês, Bruno tem 0 individual e 2 em grupo.
2. O card "Mentorias do mês" mostra a referência "julho de 2026", uma linha "Ana — Individual 3 · Grupo 1 · Total 4" e uma linha "Bruno — Individual 0 · Grupo 2 · Total 2", ordenadas por nome.
3. A equipe corrige o mentor de um encontro já realizado do mês (de Ana para Bruno) via chip de mentor: após salvar, o card recarrega e passa a mostrar Ana com total 3 e Bruno com total 3, sem reload da página.

### Edge Cases
- **Encontro futuro do mês corrente** (`starts_at > now()`): não conta, mesmo estando em julho.
- **Encontro de mês anterior ou posterior** (em horário de SP): não conta. Encontro em 30/06 23:00 SP (01/07 02:00 UTC) NÃO conta em julho; encontro em 31/07 22:00 SP conta em julho — a comparação usa `at time zone 'America/Sao_Paulo'`, não o mês UTC.
- **Encontro sem mentor vinculado**: não aparece em nenhuma contagem (join por `meeting_mentors`).
- **Mentor com vínculo só em meses passados**: aparece no card com Individual 0 · Grupo 0 · Total 0 (desde que algum mentor tenha realizado mentoria no mês; senão vale o estado vazio).
- **Mentor sem nenhum vínculo em `meeting_mentors`**: não aparece no card.
- **Nenhuma mentoria realizada no mês** (soma total = 0) ou nenhum mentor com vínculo: card exibe o estado vazio ("Nenhuma mentoria realizada neste mês.").
- **Vínculo manual** (`source = 'manual'`): conta igual ao automático — o filtro é só o vínculo vigente.
- **Encontro com mais de um mentor vinculado** (dados legados pré-issue 17): conta 1 para cada mentor vinculado.
- **Sync do Calendar altera vínculos automáticos**: `handleCalendarSync` já chama `refreshData()`, que recarrega as contagens.

### Cenário de Erro
- **Requisição sem token ou sessão inválida**: rota responde 401 `{ error }` (via `requireTeamUser`); nunca retorna dados.
- **`DATABASE_URL` ausente ou falha do banco**: rota responde 500 `{ error: "Falha ao carregar mentorias do mês." }` (mensagem interna não vaza).
- **Falha do fetch no cliente**: o card exibe a mensagem inline "Não foi possível carregar as mentorias do mês." — o restante do dashboard continua funcional (o erro dessa chamada não seta `dataError`).

## Banco de Dados

Sem migration. Consulta de leitura esperada em `lib/mentor-month-stats-server.ts` (uma única query):

```sql
with sp as (
  select date_trunc('month', now() at time zone 'America/Sao_Paulo') as month_start
)
select
  m.id as mentor_id,
  m.name,
  to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM') as month,
  count(*) filter (
    where mt.type = 'individual'
      and mt.starts_at <= now()
      and (mt.starts_at at time zone 'America/Sao_Paulo') >= sp.month_start
      and (mt.starts_at at time zone 'America/Sao_Paulo') < sp.month_start + interval '1 month'
  )::int as individual_count,
  count(*) filter (
    where mt.type = 'group'
      and mt.starts_at <= now()
      and (mt.starts_at at time zone 'America/Sao_Paulo') >= sp.month_start
      and (mt.starts_at at time zone 'America/Sao_Paulo') < sp.month_start + interval '1 month'
  )::int as group_count
from public.mentors m
join public.meeting_mentors mm on mm.mentor_id = m.id
join public.meetings mt on mt.id = mm.meeting_id
cross join sp
group by m.id, m.name, sp.month_start
order by m.name asc;
```

- O `join` (inner) em `meeting_mentors` garante "uma linha por mentor com ao menos um vínculo"; os `filter` zeram quem não tem encontro realizado no mês.
- `total` = `individual_count + group_count`, somado no TypeScript do serviço.
- Se a query retornar zero linhas, o serviço devolve `{ month, stats: [] }` calculando `month` no TS com `Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })`.

## Arquivos

### Criar
- `lib/mentor-month-stats-server.ts` — serviço server-only com `pg`: `getMentorMonthStats(): Promise<{ month: string; stats: MentorMonthStat[] }>` executando a query acima (padrão de `lib/participation-server.ts`, sem transação).
- `app/api/mentors/monthly-stats/route.ts` — `GET` com `requireTeamUser`, `runtime = "nodejs"`; retorna o resultado do serviço em JSON; 401/500 no formato `{ error }`.

### Modificar
- `lib/supabase/data.ts` — exportar `interface MentorMonthStat { mentorId: string; name: string; individual: number; group: number; total: number }`, `interface MentorMonthStats { month: string; stats: MentorMonthStat[] }` e `loadMentorMonthStats(): Promise<MentorMonthStats>` via `fetch("/api/mentors/monthly-stats", { headers: await teamAuthHeader() })` (padrão de `markBriefingReviewed`).
- `components/mentoria-app.tsx` —
  - `MentoriaApp`: estado `mentorMonthStats: MentorMonthStats | null` + `mentorStatsError: boolean`; carregar em `refreshData()` (try/catch isolado) e recarregar após sucesso em `handleMentorChange`; passar `monthStats`/`statsError` como props para `Dashboard`.
  - `Dashboard`: novo `<div className="card mentor-month-card">` como quinto card dentro de `<section className="dashboard-grid">`, com `CardTitle` (eyebrow com mês por extenso em caixa alta, title "Mentorias do mês", action "Ver agenda" → `seeAll("agenda")`), cabeçalho de colunas (Individual / Grupo / Total), linhas `.mentor-stat-row` (nome + 3 contagens) e `Empty` quando soma total = 0 ou lista vazia; mensagem inline em caso de `statsError`.
- `app/globals.css` — estilos `.mentor-month-card` / `.mentor-stat-row` (grid `1fr repeat(3, 52px)` alinhado à direita nas contagens, linha divisória `var(--line)`, total em negrito), na camada base junto aos demais estilos de card, respeitando a camada de marca existente.

## Checklist
- [x] `lib/mentor-month-stats-server.ts` criado com a query única (filtros de mês em `America/Sao_Paulo` e `starts_at <= now()`)
- [x] `GET app/api/mentors/monthly-stats/route.ts` criado com `requireTeamUser` e `runtime = "nodejs"`
- [x] Rota responde 401 sem token e 500 com mensagem genérica em falha de banco
- [x] `loadMentorMonthStats()` + tipos exportados em `lib/supabase/data.ts` usando `teamAuthHeader()`
- [x] Card "Mentorias do mês" renderizado na `.dashboard-grid` com referência do mês por extenso (pt-BR)
- [x] Uma linha por mentor com vínculo, com Individual, Grupo e Total, ordenada por nome (zeros incluídos)
- [x] Estado vazio exibido quando nenhuma mentoria foi realizada no mês
- [x] Contagem recarregada após correção manual de mentor (`handleMentorChange`) e após sync do Calendar (`refreshData`)
- [x] Falha da chamada de stats não bloqueia o restante do dashboard (erro inline no card)
- [x] Estilos novos em `app/globals.css` (`.mentor-month-card`, `.mentor-stat-row`) coerentes com a camada de marca
- [x] Nenhum arquivo fora da lista acima foi tocado; nenhuma lógica de contagem no frontend
- [x] `npm run build` (ou `npx tsc --noEmit`) sem erros
