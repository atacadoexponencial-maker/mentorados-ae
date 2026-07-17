# 32: Protótipo — Agenda com navegação para datas passadas
**Tipo:** Protótipo
**Página:** Módulo C — Agenda: Navegação para Datas Passadas
## Descrição
Prototipar a Agenda com faixa de dias navegável (retroceder/avançar, dia a dia ou semana a semana), seletor de data, atalho "Hoje" e estado vazio claro para dias sem encontros. Os cards de encontros passados devem exibir o indicador de origem da participação (automática / confirmada / sem registro) e ter como ação principal "Conferir participação" no lugar do link do Meet.

## Contexto do plano
- Protótipo de UI apenas: usa os dados que `loadAppData()` já entrega (`lib/supabase/data.ts` corta meetings em `starts_at >= agora−24h`). **Não** criar queries novas — a issue 33 remove/parametriza esse corte. Dias passados sem dados carregados exibem o estado vazio normalmente.
- A `AgendaView` atual (`components/mentoria-app.tsx`, ~linhas 281–328) monta a tira `week-strip` com `groupedEntries.slice(0, 5)` (só dias que têm encontros) e guarda `selectedDayKey`. O protótipo troca isso por uma janela de 5 dias consecutivos ancorada em uma data navegável, independente de haver encontros.
- Indicador de origem é **placeholder**: deriva de `Meeting.attendanceRecorded` (`true` → "Confirmada", `false` → "Sem registro"); a variante "Automática" fica estilizada mas inalcançável até as issues 36/43. A troca definitiva da ação principal é a issue 35 — aqui só se define o visual/comportamento no protótipo.
- O projeto não usa shadcn: UI é CSS próprio em `app/globals.css` (classes como `week-strip`, `agenda-item`, `type-badge`, `status-badge`, `secondary-button`, `empty`) e ícones `lucide-react`. Reutilizar essas classes e o componente `Empty`; `<input type="date">` nativo já é o padrão (ver `NewMenteeModal`).

## Cenários

### Happy Path
1. Usuário abre a Agenda: a tira mostra 5 dias consecutivos começando no dia de hoje; o dia selecionado por padrão é hoje (ou, se hoje não tem encontros, o primeiro dia com encontros dentro da janela visível — preservando o espírito do comportamento atual).
2. Clica na seta "‹" (dia) ou "«" (semana): a janela da tira retrocede 1 ou 7 dias; "›"/"»" avançam. O dia selecionado acompanha o deslocamento (ou permanece se ainda visível na janela).
3. Usa o seletor de data (`<input type="date">`) e pula direto para 10/03/2026: a tira se reancora naquela data e o dia fica selecionado.
4. Clica em "Hoje": tira e seleção voltam para a data atual.
5. Seleciona um dia passado com encontros carregados: os cards aparecem com badge de origem ("Confirmada" quando `attendanceRecorded`, "Sem registro" caso contrário) e a ação principal é "Conferir participação" (abre o `AttendanceModal` via `openMeeting`, mesmo fluxo do botão atual "Registrar participação"); o link "Entrar" no Meet perde o destaque/some nesses cards.
6. Seleciona um dia futuro com encontros: card idêntico ao atual — "Entrar" no Meet como ação principal, sem badge de origem.

### Edge Cases
- Dia selecionado sem nenhum encontro: exibir estado vazio claro no painel do dia ("Nenhum encontro em <data>"), reutilizando o componente `Empty`, mantendo a tira e os controles visíveis (não usar o vazio global "Nenhum encontro sincronizado").
- Dias passados além da janela de dados carregada (antes de agora−24h): comportam-se como dias sem encontros (estado vazio) — limitação conhecida do protótipo, resolvida na issue 33.
- Encontros de hoje: os que já começaram (`startsAt < agora`) contam como passados (badge + "Conferir participação"); os que ainda vão começar mantêm "Entrar".
- Navegação para o futuro segue ilimitada e funcional como hoje; dias futuros sem encontros também mostram o estado vazio do dia.
- Nenhum encontro carregado no app inteiro: a tira e os controles continuam renderizando (ancorados em hoje) com o estado vazio do dia — sem crash por `groupedEntries` vazio.
- Encontro `Grupo` vs `Individual`: badge de origem convive com o `type-badge` existente sem quebrar o grid do `.agenda-item` (conferir responsivo ≤1100px e ≤780px, que já reordena colunas).

### Cenário de Erro
- Falha de carregamento do Supabase: já tratada globalmente pelo banner `data-error` + `data-loading` no `MentoriaApp`; a Agenda não adiciona chamadas de rede novas, portanto nenhum estado de erro novo é necessário. Datas inválidas no seletor nativo são bloqueadas pelo próprio `<input type="date">` (valor vazio → ignorar, mantendo a âncora atual).

## Arquivos

### Criar
- (nenhum)

### Modificar
- `C:\Users\marce\OneDrive\gestao-de-mentorados\components\mentoria-app.tsx`
  - `AgendaView` (~linhas 281–328): substituir a tira baseada em `groupedEntries.slice(0, 5)` por janela de 5 dias consecutivos derivada de um estado `anchorKey` (string `yyyy-MM-dd`, inicial = `todayDateKey()`); helper local `addDays(key, n)` reutilizando `meetingDateKeyFormatter`; barra de navegação com botões «/‹/›/» (`ChevronLeft`/`ChevronsLeft`/`ChevronsRight` novos no import do `lucide-react`; `ChevronRight` já importado), `<input type="date">` e botão "Hoje"; painel do dia com estado vazio por dia via `Empty`.
  - `AgendaItem` (~linhas 330–333): prop/derivação `isPast` (`new Date(item.startsAt).getTime() < Date.now()`); quando passado, renderizar badge de origem placeholder (a partir de `item.attendanceRecorded`) e botão principal "Conferir participação" (`UserCheck`, chama `open()`) no lugar do link destacado do Meet.
- `C:\Users\marce\OneDrive\gestao-de-mentorados\app\globals.css`
  - Novas classes no padrão visual existente: `.agenda-nav` (barra com setas + date input + "Hoje"), modificador para dia sem encontros na `week-strip` (ex.: dia esmaecido/sem contador), `.origin-badge` com variantes `auto` / `confirmada` / `sem-registro` (mesma linguagem de `status-badge`/`risk-badge`), e ajustes mínimos no grid `.agenda-item` para o card passado; incluir os casos nos breakpoints ≤1100px / ≤780px já existentes.

### Não tocar (dependências de outras issues)
- `lib/supabase/data.ts` (`loadAppData`) — issue 33.
- `lib/types.ts` / `lib/supabase/database.types.ts` (origem real da participação) — issue 36.

## Checklist
- [x] Em `AgendaView`, criar estado `anchorKey` (default `todayDateKey()`) e helper `addDays` baseado em `meetingDateKeyFormatter` (fuso `America/Sao_Paulo`); gerar `weekDays` como 5 dias consecutivos a partir da âncora, com `total` vindo de `groupedMeetings.get(key)` (0 quando ausente).
- [x] Manter `selectedDayKey` com default = hoje, caindo para o primeiro dia com encontros da janela quando hoje não tiver; remover o `useEffect` atual que reseta a seleção para `groupedEntries[0]`.
- [x] Adicionar barra `.agenda-nav`: retroceder/avançar dia (‹ ›) e semana (« »), `<input type="date">` que reancora e seleciona a data escolhida (ignorar valor vazio), botão "Hoje".
- [x] Renderizar o painel do dia selecionado: encontros do dia ou `Empty` com "Nenhum encontro em <data longa>"; garantir funcionamento com zero encontros carregados no app.
- [x] Em `AgendaItem`, derivar `isPast` por `startsAt < agora`; card passado exibe `.origin-badge` placeholder (`attendanceRecorded` → "Confirmada"; senão "Sem registro"; variante "Automática" estilizada com comentário apontando issues 36/43) e ação principal "Conferir participação" chamando `open()`; card futuro permanece idêntico ao atual.
- [x] Importar apenas os ícones novos necessários (`ChevronLeft`, `ChevronsLeft`, `ChevronsRight`) no topo de `mentoria-app.tsx`.
- [x] Adicionar em `app/globals.css` os estilos `.agenda-nav`, `.origin-badge` (3 variantes) e o modificador de dia vazio na `week-strip`, seguindo tokens/cores existentes (`var(--line)`, `var(--green)`, etc.) e cobrindo os breakpoints ≤1100px e ≤780px.
- [ ] Verificar manualmente: navegação para trás e para frente, pulo por data, "Hoje", dia vazio, card passado vs futuro, mobile — sem chamadas novas ao Supabase (nenhuma alteração em `lib/supabase/data.ts`).
