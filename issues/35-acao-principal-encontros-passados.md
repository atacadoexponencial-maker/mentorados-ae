# 35: Ação principal de encontros passados na Agenda
**Tipo:** Implementação
**Página:** Módulo C — Agenda: Navegação para Datas Passadas
## Descrição
Nos cards de encontros cuja data já passou, trocar a ação principal: o acesso à sala do Meet deixa de ter destaque (o encontro já ocorreu) e a ação principal passa a ser abrir a conferência/registro de participação. Encontros futuros mantêm o comportamento atual.

## Contexto técnico
- O card da Agenda é o componente `AgendaItem` em `components/mentoria-app.tsx` (~linha 330). Hoje ele renderiza, nesta ordem: `<a href={item.meetUrl}>` com rótulo "Entrar" (pill verde, ação de destaque) e `<button className="secondary-button" onClick={open}>` "Registrar participação", que abre o `AttendanceModal` existente (via `openMeeting`/`setSelectedMeeting` em `MentoriaApp`).
- "Passado" = o encontro já terminou: `new Date(meeting.startsAt).getTime() + meeting.duration * 60000 < Date.now()`. Encontro em andamento conta como futuro (o Meet ainda é útil).
- Escopo é SOMENTE o card da Agenda (`AgendaItem`). `MeetingRow` (Visão geral, que lista apenas o dia atual) não muda. A navegação para datas passadas é da issue 34; o indicador de origem da participação é da issue 43; pré-marcação no modal é da issue 41.

## Solução
Em `AgendaItem`, calcular `const past = isMeetingPast(item)` (novo helper puro ao lado de `meetingDayKey`/`todayDateKey`, ~linha 25). Quando `past`:
- Ação principal: `<button className="primary-button small" onClick={open}><UserCheck size={17} /> Conferir participação</button>`, renderizado na última coluna do grid (posição de destaque).
- Ação secundária: o link do Meet permanece no card, com o mesmo estilo discreto atual (`.agenda-item>a`), rótulo "Meet".
Quando futuro: card idêntico ao atual ("Entrar" + "Registrar participação" secundário).

## Cenários

### Happy Path
1. Usuário navega (issue 34) até um dia passado na Agenda → cada card exibe "Conferir participação" como ação principal (botão destacado) e o link do Meet como ação secundária discreta.
2. Clique em "Conferir participação" → abre o `AttendanceModal` do encontro (mesmo fluxo de `openMeeting` já existente), permitindo registrar/conferir presença.
3. Usuário volta para hoje/futuro → cards mantêm o comportamento atual: "Entrar" (Meet) em destaque e "Registrar participação" como botão secundário.

### Edge Cases
- Encontro de hoje que já terminou (ex.: às 18h olhando um encontro de 9h–10h): tratado como passado → "Conferir participação" vira a ação principal, mesmo sem navegar para outro dia.
- Encontro em andamento (começou mas `startsAt + duration` ainda não passou): tratado como futuro → "Entrar" no Meet continua sendo a ação principal.
- Encontro passado com `attendanceRecorded === true`: mesma ação "Conferir participação" (o modal serve para conferir/ajustar; nenhuma variação de rótulo nesta issue — o indicador visual de origem é da issue 43).
- Encontro passado com `meetUrl` vazio: o link secundário segue o comportamento atual do card (não é escopo desta issue alterar a renderização do link).
- Viewport ≤1100px: o CSS atual esconde `.agenda-item>a`; garantir que o botão "Conferir participação" (agora `primary-button small`) receba as mesmas regras responsivas hoje aplicadas a `.agenda-item .secondary-button` (grid-column etc.), para o card não quebrar no mobile.

### Cenário de Erro
- Falha ao salvar participação no modal: já tratada pelo `AttendanceModal` existente (`saveError` exibido no próprio modal) — nenhum tratamento novo necessário nesta issue.
- `startsAt` inválido (Date NaN): a comparação `NaN < Date.now()` retorna `false` → o card cai no comportamento atual (futuro), sem crash.

## Arquivos

### Modificar
- `components/mentoria-app.tsx`
  - ~linha 25 (junto de `meetingDayKey`/`todayDateKey`): adicionar helper `isMeetingPast(meeting: Meeting): boolean` usando `startsAt + duration`.
  - `AgendaItem` (~linhas 330–333): calcular `past` e renderizar condicionalmente as duas ações — passado: link Meet discreto ("Meet") + `<button className="primary-button small" onClick={open}>` "Conferir participação"; futuro: JSX atual inalterado.
- `app/globals.css`
  - Estender os seletores responsivos que hoje citam `.agenda-item .secondary-button` (regra `grid-column:3;width:max-content;margin-bottom:12px` no breakpoint pequeno) para cobrir também `.agenda-item .primary-button`, mantendo o layout do card em telas estreitas.

### Criar
- Nenhum arquivo novo.

## Checklist
- [ ] Helper `isMeetingPast` criado ao lado dos demais helpers de data em `components/mentoria-app.tsx` (sem duplicar lógica existente).
- [ ] Card de encontro passado na Agenda exibe "Conferir participação" como ação principal e abre o `AttendanceModal` existente ao clicar.
- [ ] Link do Meet permanece no card passado como ação secundária discreta.
- [ ] Card de encontro futuro (e em andamento) permanece exatamente como hoje ("Entrar" + "Registrar participação").
- [ ] Encontro de hoje já encerrado também mostra "Conferir participação" como principal.
- [ ] Layout do card não quebra em viewports ≤1100px e ≤640px (regras responsivas cobrem o novo botão).
- [ ] `MeetingRow` (Visão geral) e `AttendanceModal` não foram alterados.
- [ ] Nenhum arquivo fora dos listados foi tocado; nenhuma lógica de negócio nova no backend (decisão é puramente de apresentação no card).
