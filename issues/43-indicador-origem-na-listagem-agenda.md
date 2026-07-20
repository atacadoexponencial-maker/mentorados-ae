# 43: Indicador de origem da participação na listagem da Agenda
**Tipo:** Implementação
**Página:** Módulo B — Conferência e Sobrescrita Manual da Participação
## Descrição
Exibir nos cards da Agenda (`AgendaView` em `components/mentoria-app.tsx`) o estado da participação de cada encontro — automática / confirmada pelo mentor / sem registro — para o mentor identificar de relance quais encontros já foram conferidos. Requer que o data layer (`lib/supabase/data.ts`) exponha a origem carregada na issue 36.

## Contexto do plano
- **Pré-requisitos (não são escopo desta issue):** issue 32 (protótipo da Agenda já renderiza no card passado o badge placeholder `.origin-badge` — derivado de `Meeting.attendanceRecorded`: `true` → "Confirmada", `false` → "Sem registro" — com a variante `auto` estilizada em `app/globals.css` porém inalcançável), issue 35 (helper `isMeetingPast` + ação principal "Conferir participação" nos cards passados) e issue 36 (`Meeting.attendanceSource: "auto" | "manual" | null` em `lib/types.ts`, mapeado em `mapMeeting` a partir de `meetings.attendance_source`; check constraint garante que `attendance_source` e `attendance_recorded_at` andam juntos).
- **Delta desta issue:** trocar, no `AgendaItem` (`components/mentoria-app.tsx`, ~linhas 330–333), a derivação placeholder do badge (baseada em `attendanceRecorded`, booleana, 2 estados) pela derivação real de 3 estados a partir de `item.attendanceSource`, tornando a variante "Automática" alcançável. Nenhuma query nova: `loadAppData` usa `select("*")` em `meetings` e `mapMeeting` já entrega `attendanceSource` (issue 36).
- **Mapeamento estado → badge:** `attendanceSource === "auto"` → rótulo "Automática (Meet)", classe `origin-badge auto`; `"manual"` → "Confirmada", classe `origin-badge confirmada`; `null` → "Sem registro", classe `origin-badge sem-registro`.
- **Escopo do badge inalterado em relação à 32:** somente cards de encontros passados (`isMeetingPast`); cards futuros seguem sem badge. `MeetingRow` (Visão geral) e `AttendanceModal` não mudam — o indicador dentro do fluxo de registro é a issue 41.

## Cenários

### Happy Path
1. Mentor navega até um dia passado na Agenda: encontro com participação coletada automaticamente (`attendanceSource = "auto"`, gravado pelas issues 38/39) exibe o badge "Automática (Meet)" (variante `auto`, até então inalcançável no placeholder).
2. Encontro passado confirmado pelo mentor (`attendanceSource = "manual"`) exibe o badge "Confirmada" (variante `confirmada`).
3. Encontro passado sem nenhum registro (`attendanceSource = null`) exibe o badge "Sem registro" (variante `sem-registro`).
4. Mentor confirma manualmente um encontro que estava "Automática (Meet)" via `AttendanceModal` ("Conferir participação"): após o `onSaved` recarregar os dados (`loadAppData`), o card passa a exibir "Confirmada" — a regra "manual prevalece" (issues 36/42) fica visível de relance.
5. Cards de encontros futuros (e em andamento, conforme `isMeetingPast` da issue 35) permanecem idênticos: sem badge de origem, "Entrar" no Meet como ação principal.

### Edge Cases
- **Registro manual legado (pré-migration 36):** o backfill da migration marca `attendance_source = 'manual'` para todo encontro com `attendance_recorded_at` preenchido, então chega ao front como "Confirmada" — nenhum tratamento extra no componente.
- **Derivação exclusivamente por `attendanceSource`:** o campo `attendanceRecorded` deixa de participar da derivação do badge (o check constraint `attendance_source_matches_recorded` garante que os dois nunca divergem); `attendanceRecorded` continua existindo no tipo para os demais consumidores (ex.: dashboard).
- **Encontro futuro que já tem registro** (mentor registrou antecipadamente pela Visão geral): segue sem badge — o indicador é exclusivo dos cards passados, como definido no protótipo 32; nenhuma mudança aqui.
- **Grupo vs Individual:** o badge de origem convive com o `type-badge` existente no `.agenda-copy`; o rótulo mais longo "Automática (Meet)" não pode quebrar o grid do `.agenda-item` nos breakpoints ≤1100px e ≤780px (layout já preparado pela issue 32 — apenas conferir).
- **`attendanceSource` com valor inesperado:** impossível em tempo de execução vindo do enum do banco e o tipo TS restringe a `"auto" | "manual" | null`; a derivação usa ternário exaustivo com `null` → "Sem registro" como caso final.

### Cenário de Erro
- **Falha de carregamento do Supabase:** já tratada globalmente pelo banner `data-error` + `data-loading` no `MentoriaApp`; esta issue não adiciona chamadas de rede, portanto nenhum estado de erro novo.
- **Banco sem a migration da issue 36 aplicada:** `select("*")` não retornaria `attendance_source` e `mapMeeting` produziria `attendanceSource: undefined` → todos os cards passados cairiam em "Sem registro" (degradação silenciosa, sem crash). É cenário de ambiente inconsistente, não de código — a issue 36 é pré-requisito de deploy.

## Arquivos

### Criar
- (nenhum)

### Modificar
- `C:\Users\marce\OneDrive\gestao-de-mentorados\components\mentoria-app.tsx`
  - `AgendaItem` (~linhas 330–333, já com o shape das issues 32/35): substituir a derivação placeholder do badge (`item.attendanceRecorded ? "Confirmada" : "Sem registro"`) por derivação de `item.attendanceSource` — `"auto"` → `{ rótulo: "Automática (Meet)", classe: "origin-badge auto" }`; `"manual"` → `{ "Confirmada", "origin-badge confirmada" }`; `null` → `{ "Sem registro", "origin-badge sem-registro" }`. Remover o comentário do placeholder que aponta para as issues 36/43. Sem novos imports, sem novos ícones.

### Não tocar (pré-requisitos entregues por outras issues)
- `lib/types.ts`, `lib/supabase/data.ts` (`mapMeeting`), `lib/supabase/database.types.ts` — `attendanceSource` já exposto pela issue 36.
- `app/globals.css` — `.origin-badge` e as 3 variantes (`auto` / `confirmada` / `sem-registro`) já criadas pela issue 32; só ajustar aqui se, na prática, o rótulo "Automática (Meet)" estourar o layout nos breakpoints (ajuste mínimo na própria `.origin-badge`).
- `MeetingRow`, `AttendanceModal`, `lib/participation-server.ts`, rotas de API e scripts — fora de escopo (indicador no modal é a issue 41; sobrescrita manual é a 42).

## Checklist
- [ ] Pré-requisitos confirmados no branch: `.origin-badge` com variante `auto` em `app/globals.css` (issue 32), `isMeetingPast` + "Conferir participação" (issue 35) e `Meeting.attendanceSource` mapeado em `mapMeeting` (issue 36).
- [ ] Em `AgendaItem`, badge do card passado derivado exclusivamente de `item.attendanceSource` (ternário exaustivo de 3 estados); nenhuma referência a `attendanceRecorded` restante na derivação do badge nem comentário de placeholder.
- [ ] Encontro passado com `attendanceSource = "auto"` exibe "Automática (Meet)" (variante `auto` agora alcançável).
- [ ] Encontro passado com `attendanceSource = "manual"` exibe "Confirmada"; com `null` exibe "Sem registro".
- [ ] Confirmar manualmente um encontro "Automática (Meet)" pelo modal atualiza o card para "Confirmada" após o reload dos dados (fluxo `onSaved` existente, sem código novo).
- [ ] Cards futuros/em andamento permanecem sem badge e idênticos ao comportamento atual.
- [ ] Layout do card passado íntegro com o rótulo "Automática (Meet)" nos breakpoints ≤1100px e ≤780px (Grupo e Individual).
- [ ] `MeetingRow`, `AttendanceModal` e todo o data layer intactos; nenhuma chamada nova ao Supabase.
- [ ] `npm run build` (ou `tsc`) passa sem erros de tipo.
- [ ] Nenhum arquivo fora de `components/mentoria-app.tsx` tocado (exceto ajuste mínimo em `app/globals.css` apenas se o rótulo estourar o layout).
