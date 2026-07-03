# 21: Janela Ativa na Carga Geral (Agenda e Visão geral)

**Tipo:** Implementação
**Página:** Módulo F — Janela Ativa na Carga Geral

## Descrição
Restringir a consulta de encontros da carga geral (`loadAppData` em `lib/supabase/data.ts`) a encontros com início a partir de agora − 24h (mesma borda inferior da janela ativa do sync), mantendo a ordenação crescente por início — assim a Agenda continua abrindo no presente/futuro mesmo após o backfill. Nenhuma tela muda: "Agenda de hoje" e "Próximos encontros" já filtram para hoje/futuro, o card "Mentorias do mês" (calculado no servidor) e a consulta "Mentorias deste mês" da ficha ficam inalterados, e nenhuma tela além da aba "Histórico" pode depender de encontros anteriores a agora − 24h.

## Decisões de implementação

**Borda inferior (agora − 24h):** a mesma expressão do sync (`activeSyncWindow().timeMin` em `lib/google-calendar.ts:71-76`, ou seja `new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()`) **não pode ser importada**: `lib/google-calendar.ts` tem `import "server-only"` e puxa `googleapis`, enquanto `lib/supabase/data.ts` roda no browser. A expressão será **inlined** em `loadAppData` como constante local (`const activeWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();`), com comentário de uma linha referenciando `activeSyncWindow()` para manter as bordas alinhadas. Só borda inferior — sem `lte` superior (o sync já limita a criação a +90d e encontros manuais futuros devem aparecer).

**Filtro no `meetings`:** adicionar `.gte("starts_at", activeWindowStart)` à consulta existente, mantendo `.order("starts_at")`.

**`meeting_mentors` — decisão: filtrar também.** Justificativa: com o backfill haverá milhares de vínculos históricos; o `select("*")` atual traria todos, inflando payload e o `Map` de links sem nenhum uso (vínculos de encontros fora da carga são descartados). O filtro usa o mesmo padrão de join interno já existente no arquivo (`loadMenteeMonthMeetings`, `lib/supabase/data.ts:298-304`): `supabase.from("meeting_mentors").select("meeting_id, mentor_id, source, meetings!inner(starts_at)").gte("meetings.starts_at", activeWindowStart)`. Isso preserva o paralelismo do `Promise.all` (não depende dos ids do resultado de `meetings`) e restringe a projeção às colunas realmente usadas pelo mapeamento (`meeting_id`, `mentor_id`, `source` — o cast em `data.ts:88` já espera só esses campos; o `meetings!inner(starts_at)` embutido é ignorado pelo mapeamento). Usar a **mesma constante** `activeWindowStart` nas duas consultas para as bordas serem idênticas.

**Não afetados (não tocar):** `components/mentoria-app.tsx` (Dashboard já filtra hoje/futuro em `mentoria-app.tsx:193-194`; AgendaView agrupa por dia em `mentoria-app.tsx:282-301` — com a carga restrita o primeiro grupo volta a ser presente/futuro sem mudança de código); rota `/api/mentors/monthly-stats` (calcula no servidor); `loadMenteeMonthMeetings` (sob demanda, baseada em participações); aba "Histórico" (consulta própria sob demanda, Módulo E). `meetingList` só é consumido por Dashboard e AgendaView — nenhuma outra tela depende de encontros anteriores a agora − 24h.

## Cenários

1. **Carga geral após backfill (milhares de encontros desde 2023):** `loadAppData` retorna apenas encontros com `starts_at >= agora − 24h`, em ordem crescente; a Agenda abre com o primeiro grupo de dias no presente (ontem dentro da janela, hoje ou futuro), não em 2023.
2. **Encontro de ontem dentro da janela (ex.: começou há 20h):** aparece na carga e na Agenda (primeiro grupo de dias), mas não regride "Agenda de hoje" (filtra por dia de hoje) nem "Próximos encontros" (filtra `>= Date.now()`).
3. **Encontro histórico fora da janela (ex.: 2023):** não vem na carga geral; segue visível apenas na aba "Histórico" (consulta sob demanda) e contado no card "Mentorias do mês" quando for do mês corrente.
4. **Vínculos de mentor:** encontros dentro da janela continuam com seus mentores corretos (`auto`/`manual`), inclusive após o dedupe entre calendários (merge de `mentorIds`); vínculos de encontros históricos não são baixados e nada quebra por sua ausência (`meetingMentors.get(row.id) ?? []`).
5. **Nenhum encontro na janela:** `meetings` retorna `[]`; Dashboard mostra "Nenhum encontro na agenda de hoje.", métrica "Próximos encontros" = 0, AgendaView mostra estado vazio — sem erro.
6. **Erro do Supabase em qualquer das consultas:** comportamento atual preservado (`assertNoError` lança e a tela de erro/retry do app cobre).

## Arquivos

### Modificar
1. **`lib/supabase/data.ts`** (apenas `loadAppData`):
   - Criar `const activeWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();` no início de `loadAppData`, com comentário referenciando a borda de `activeSyncWindow()` (`lib/google-calendar.ts`).
   - Consulta `meetings`: `supabase.from("meetings").select("*").gte("starts_at", activeWindowStart).order("starts_at")`.
   - Consulta `meeting_mentors`: `supabase.from("meeting_mentors").select("meeting_id, mentor_id, source, meetings!inner(starts_at)").gte("meetings.starts_at", activeWindowStart)`.
   - Nada mais muda: mapeamento, dedupe, sort final e retorno permanecem idênticos.

### Criar
Nenhum.

### Não tocar
`components/mentoria-app.tsx`, `lib/google-calendar.ts`, `app/api/mentors/monthly-stats/**`, `app/api/calendar/sync/route.ts`, tipos em `lib/types` / `lib/supabase/database.types`.

## Checklist

- [x] `loadAppData`: constante `activeWindowStart` (agora − 24h, ISO) definida uma única vez e usada nas duas consultas, com comentário apontando para `activeSyncWindow()`
- [x] Consulta `meetings` com `.gte("starts_at", activeWindowStart)` mantendo `.order("starts_at")`
- [x] Consulta `meeting_mentors` filtrada via `meetings!inner(starts_at)` + `.gte("meetings.starts_at", activeWindowStart)`, projetando `meeting_id, mentor_id, source`
- [x] Nenhuma alteração em `components/mentoria-app.tsx` nem em qualquer rota de API
- [x] Mapeamento/dedupe/sort de `loadAppData` inalterados (mentores `auto`/`manual` e merge do dedupe continuam funcionando)
- [x] `npm run build` (ou typecheck) passa sem erros
- [ ] Verificação manual: Agenda abre no presente/futuro; "Agenda de hoje", "Próximos encontros", "Mentorias do mês" e "Mentorias deste mês" da ficha inalterados; aba "Histórico" segue trazendo encontros antigos
