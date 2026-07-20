# 34: Navegação da Agenda para trás e para frente no tempo

**Tipo:** Implementação
**Página:** Módulo C — Agenda: Navegação para Datas Passadas

## Descrição
Substituir em `AgendaView` (`components/mentoria-app.tsx`) o recorte fixo `groupedEntries.slice(0, 5)` por navegação livre: controles para retroceder/avançar na faixa de dias, seletor de data para pular a uma data específica, atalho "Hoje" e estado vazio claro em dias sem encontros. O padrão ao abrir continua sendo o dia atual (ou próximo dia com encontros) e a navegação para o futuro segue funcionando como hoje.

## Plano

Modelo de estado: `selectedDayKey` (formato `YYYY-MM-DD` via `meetingDateKeyFormatter`, timezone `America/Sao_Paulo`) vira a única fonte de verdade da navegação e passa a aceitar qualquer dia-calendário, com ou sem encontros. A faixa (`week-strip`) deixa de ser derivada de `groupedEntries.slice(0, 5)` (só dias com encontros, a partir de agora−24h) e passa a ser os **5 dias-calendário consecutivos centrados no dia selecionado** — dias vazios aparecem na faixa com estilo esmaecido.

Dados: os encontros de hoje/futuro continuam vindo da prop `meetings` (janela ativa carregada por `loadAppData()`). Ao navegar para dias anteriores à borda da janela ativa (agora−24h), `AgendaView` busca sob demanda os encontros passados chamando a função de intervalo entregue pela issue 33 em `lib/supabase/data.ts` (contrato assumido: `loadMeetingsRange(fromIso, toIso): Promise<Meeting[]>`, mesmo mapeamento/dedupe do `loadAppData`), guarda em estado local `pastMeetings` com cache da borda mais antiga já buscada (só busca o intervalo faltante ao retroceder mais) e mescla com a prop deduplicando por `id`. Padrão segue thin client já usado no app (`MenteeDrawer` → `loadMenteeMonthMeetings`); nenhuma prop nova em `MentoriaApp`.

Padrão inicial ao abrir: dia atual se `todayDateKey()` tiver encontros; senão o próximo dia com encontros na janela carregada; senão o dia atual. O `useEffect` atual que força `selectedDayKey` para o primeiro grupo (linhas 293-301) é removido — dia selecionado sem encontros agora é estado válido.

Controles (na linha da faixa): `ChevronsLeft`/`ChevronLeft`/`ChevronRight`/`ChevronsRight` (lucide, adicionar aos imports) movem a seleção em −7/−1/+1/+7 dias; `<input type="date">` pula para data específica; botão "Hoje" reaplica o padrão inicial. Fora do escopo desta issue: `AgendaItem` (ação principal de encontros passados é a issue 35; indicador de origem é a 43) e qualquer mudança na Visão geral.

## Cenários

### Happy Path
- Abrir a Agenda: seleciona o dia atual (ou o próximo dia com encontros, se hoje estiver vazio); a faixa mostra 5 dias-calendário com o selecionado ao centro e os encontros do dia listados como hoje.
- Clicar em `‹` retrocede a seleção 1 dia (e `‹‹` 7 dias); ao cruzar a borda de agora−24h, os encontros passados são buscados via data layer da issue 33 e exibidos agrupados pelo mesmo layout (`day-label` + `AgendaItem`).
- Clicar em `›`/`››` avança 1/7 dias; dias futuros continuam vindo da prop `meetings`, sem nova consulta.
- Escolher uma data no seletor pula direto para ela; a faixa se recentra e o painel mostra os encontros daquele dia.
- Clicar em "Hoje" volta ao padrão inicial de abertura.
- Clicar em um chip da faixa seleciona aquele dia (comportamento atual preservado).

### Edge Cases
- Dia selecionado sem encontros: painel mostra estado vazio claro e específico ("Nenhum encontro neste dia.", componente `Empty` existente) em vez da mensagem genérica de sync; o chip do dia aparece esmaecido na faixa.
- Nenhum encontro sincronizado: a Agenda ainda abre no dia atual com faixa e navegação funcionais, painel com estado vazio.
- Intervalo passado já buscado: navegar de volta não refaz a consulta (cache pela borda mais antiga carregada); enquanto uma busca está em andamento, o painel mostra "Carregando..." (padrão `p.muted` existente).
- Encontro presente na janela ativa e também no retorno da busca passada (sobreposição na borda de agora−24h): mesclagem deduplica por `id`.
- Virada de dia/timezone: agrupamento e navegação usam a mesma chave `meetingDateKey` em `America/Sao_Paulo` (aritmética de dias via `T12:00:00-03:00`, padrão já usado no arquivo), sem off-by-one.
- Registrar participação recarrega o app (`refreshData`) e remonta a `AgendaView`, que volta ao padrão inicial — comportamento aceito nesta issue (fluxo de encontros passados é escopo da 35).

### Cenário de Erro
- Falha na busca de dias passados: painel do dia exibe mensagem de erro com botão "Tentar novamente" (padrão do `data-error` existente), sem afetar a navegação nem os dias já carregados.

## Arquivos

### Modificar
- `components/mentoria-app.tsx` — tudo em `AgendaView` (linhas 281-328) e imports:
  - helper puro de aritmética de dias (`addDaysToKey(key, days)`) junto de `meetingDayKey`/`todayDateKey`;
  - faixa de 5 dias-calendário centrada em `selectedDayKey` (substitui `groupedEntries.slice(0, 5)`), chip esmaecido para dia sem encontros;
  - remoção do `useEffect` das linhas 293-301; inicialização do `selectedDayKey` pelo padrão "hoje ou próximo dia com encontros";
  - estados `pastMeetings`/borda mais antiga buscada/loading/erro + efeito que chama a função de intervalo da issue 33 quando a faixa cruza agora−24h; mesclagem com a prop `meetings` deduplicando por `id` antes do agrupamento;
  - controles de navegação (setas ±1/±7 dias, `<input type="date">`, botão "Hoje") e estado vazio "Nenhum encontro neste dia." via `Empty`;
  - imports lucide: `ChevronLeft`, `ChevronsLeft`, `ChevronsRight` (`ChevronRight` já existe).
- `app/globals.css` — regras novas para os controles de navegação da Agenda (linha de setas + input date + botão "Hoje", ex.: `.agenda-nav`) e para o chip esmaecido de dia vazio na `.week-strip`, junto das regras existentes de `.week-strip`/`.agenda-full`.

Nenhum arquivo criado. Depende da issue 33 (carga de meetings por intervalo em `lib/supabase/data.ts` — esta issue apenas consome a função; nenhuma alteração própria em `data.ts`). O protótipo visual de referência é a issue 32.

## Checklist
- [ ] Faixa mostra 5 dias-calendário consecutivos centrados no dia selecionado, incluindo dias vazios (esmaecidos)
- [ ] Setas movem a seleção em ±1 e ±7 dias; seletor de data pula para data específica; "Hoje" volta ao padrão
- [ ] Padrão inicial: dia atual, ou próximo dia com encontros se hoje estiver vazio
- [ ] Dias passados carregados sob demanda pela função da issue 33, com cache do intervalo já buscado e dedupe por `id`
- [ ] Dia sem encontros mostra "Nenhum encontro neste dia." (componente `Empty`); loading e erro com retry na busca de passados
- [ ] `AgendaItem`, Visão geral e `lib/supabase/data.ts` intocados (delta das issues 35/43/33)
- [ ] `npx tsc --noEmit` passa; apenas `components/mentoria-app.tsx` e `app/globals.css` modificados
