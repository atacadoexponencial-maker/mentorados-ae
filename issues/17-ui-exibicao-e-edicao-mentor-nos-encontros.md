# 17: UI de Exibição e Edição do Mentor nos Encontros

**Tipo:** Implementação
**Página:** Módulo C (Agenda e card "Agenda de hoje" da Visão geral)

## Descrição
Exibir o mentor vinculado (ou o estado "sem mentor") em cada encontro da Agenda e do card "Agenda de hoje" da Visão geral, com sinalização discreta quando o vínculo for manual, e integrar o controle de edição (seletor com todos os mentores da equipe) à rota da issue 16. **Spec ajustada: NÃO existe "remover mentor" — a edição sempre troca para um mentor da equipe.** A alteração é persistida imediatamente e refletida na tela sem recarregar a página; em caso de falha, exibir mensagem de erro e manter o valor anterior.

**Dependências prontas (issue 16):** `PUT /api/meetings/[id]/mentor` e o cliente `updateMeetingMentor(meetingId, mentorId)` em `lib/supabase/data.ts`. Esta issue é só UI/estado + exposição do `source` do vínculo no `loadAppData` (thin client: a UI apenas chama `updateMeetingMentor` e exibe).

**Decisão de dados:** o tipo `Meeting` ganha o campo `mentorSource: "auto" | "manual" | null` (null = sem vínculo). O `select("*")` de `meeting_mentors` já retorna `source`; basta mapear em `loadAppData`. Se o encontro tiver mais de um vínculo (estado legado), `manual` prevalece sobre `auto`.

**Decisão de estado:** atualização **otimista** no estado local do `MentoriaApp` (sem `refreshData()`, que dispararia a tela cheia de loading): ao confirmar a escolha, `meetingList` é atualizado com `mentorIds: [mentorId]` e `mentorSource: "manual"`, a chamada `updateMeetingMentor` é feita e, em erro, o estado anterior é restaurado e `notify()` exibe a mensagem. Como Dashboard e Agenda leem o mesmo `meetingList`, as duas telas refletem a mudança automaticamente.

## Cenários

### Happy Path
1. Equipe abre a **Agenda**; cada `AgendaItem` mostra, junto de horário/tipo/frente, um chip com o mentor vinculado (mini-avatar com iniciais + nome). Vínculo `auto` não tem sinalização extra.
2. Equipe clica no chip → abre um popover (padrão `.filter-overlay` para fechar clicando fora) listando **todos** os mentores de `mentorList`, com o mentor atual marcado (ícone `Check`).
3. Equipe escolhe outro mentor → popover fecha, o chip mostra o novo mentor **imediatamente** (otimista) com a flag discreta "manual", `updateMeetingMentor(meeting.id, mentorId)` persiste e o toast "Mentor atualizado" aparece.
4. O mesmo chip/fluxo funciona no card **"Agenda de hoje"** da Visão geral (`MeetingRow`), e a troca feita em uma tela aparece na outra (mesmo `meetingList`).
5. Encontros já corrigidos manualmente (issue 15/16, `mentorSource === "manual"`) exibem a flag "manual" desde o carregamento.

### Edge Cases
- **Encontro sem mentor (`mentorIds` vazio):** chip em estilo apagado com "Sem mentor"; clicar abre o mesmo seletor e escolher um mentor cria o vínculo (que nasce `manual` pela rota).
- **Escolher o mentor que já está vinculado (vínculo `auto`):** a chamada é feita normalmente — é a forma de "fixar" o mentor contra o sync (issue 16); no sucesso o chip ganha a flag "manual".
- **Encontro com mais de um `mentorId` (estado legado/dedupe):** o chip exibe o primeiro mentor e o sufixo "+N" para os demais; após qualquer edição o encontro passa a ter exatamente um mentor.
- **`mentorId` sem mentor correspondente em `mentorList` (mentor excluído):** tratar como "Sem mentor".
- **`mentorList` vazio:** o popover mostra o texto muted "Nenhum mentor cadastrado." (sem opções).
- **Mobile (≤760px):** o chip permanece visível dentro de `.agenda-copy`/`.meeting-info`; o popover não pode estourar a viewport (abrir alinhado à esquerda, largura ~220px como `.filter-popover`).

### Cenário de Erro
- **Falha na gravação (401 sessão expirada, 404 encontro/mentor não encontrado, 500, rede):** `updateMeetingMentor` lança `Error` com a mensagem do backend; o handler restaura o `meetingList` anterior (o chip volta ao mentor antigo, sem flag manual indevida) e `notify()` exibe a mensagem (fallback "Não foi possível alterar o mentor.").
- **Popover aberto e clique fora:** apenas fecha, sem chamada de rede nem mudança de estado.

## Arquivos

### Criar
Nenhum.

### Modificar

1. **`lib/types.ts`**
   - `Meeting`: adicionar `mentorSource: "auto" | "manual" | null`.

2. **`lib/supabase/data.ts`** (apenas `loadAppData`/`mapMeeting`; nada de novo endpoint)
   - Tipar `meetingLinks` como `Array<{ meeting_id: string; mentor_id: string; source: "auto" | "manual" }>` e acumular no map por `meeting_id` os pares `{ mentorId, source }` (hoje só guarda `mentor_id`).
   - `mapMeeting(row, links)`: derivar `mentorIds` de `links` e `mentorSource` = `null` se sem links; `"manual"` se algum link é manual; senão `"auto"`.
   - No merge do `dedupedMeetings`: além de unir `mentorIds`, `existing.mentorSource = existing.mentorSource === "manual" || meeting.mentorSource === "manual" ? "manual" : (existing.mentorSource ?? meeting.mentorSource)`.

3. **`components/mentoria-app.tsx`**
   - Import: adicionar `updateMeetingMentor` ao import de `@/lib/supabase/data`.
   - **`MentoriaApp`**: novo handler `async function handleMentorChange(meetingId: string, mentorId: string)` — guarda `meetingList` anterior, aplica update otimista (`mentorIds: [mentorId]`, `mentorSource: "manual"`), chama `updateMeetingMentor`, `notify("Mentor atualizado")`; no catch restaura a lista anterior e `notify(mensagem do erro)`. Passar `mentors={mentorList}` e `onMentorChange={handleMentorChange}` para `Dashboard` e `AgendaView`.
   - **`Dashboard`**: aceitar as props `mentors: Mentor[]` e `onMentorChange: (meetingId: string, mentorId: string) => void` e repassá-las a cada `MeetingRow`.
   - **`MeetingRow`**: aceitar `mentors`/`onMentorChange`; renderizar `<MentorChip meeting={meeting} mentors={mentors} onChange={(mentorId) => onMentorChange(meeting.id, mentorId)} />` dentro de `.meeting-info`, após `<small>{meeting.front}</small>`.
   - **`AgendaView`**: aceitar `mentors`/`onMentorChange` e repassar a cada `AgendaItem`.
   - **`AgendaItem`**: aceitar `mentors`/`onMentorChange`; renderizar o mesmo `<MentorChip>` dentro de `.agenda-copy`, após `<p>{item.front}</p>`.
   - **Novo componente `MentorChip({ meeting, mentors, onChange }: { meeting: Meeting; mentors: Mentor[]; onChange: (mentorId: string) => void })`** (único para as duas telas):
     - Resolve `current = mentors.find((m) => m.id === meeting.mentorIds[0])`; extras = `meeting.mentorIds.length - 1`.
     - Estado local `open` (useState). Render: `<div className="mentor-pick">` com o botão `.mentor-chip` (`.mentor-chip.empty` quando sem mentor) contendo `<span className="mini-avatar">{current.initials}</span>`, o nome (ou "Sem mentor"), sufixo `+N` se `extras > 0` e, se `meeting.mentorSource === "manual"`, `<em className="manual-flag">manual</em>`.
     - Quando `open`: `<div className="filter-overlay" onClick={fechar} />` (reuso) + `<div className="mentor-popover">` com um `<button>` por mentor (mini-avatar + nome + `Check` no atual, classe `selected`); clique = fechar + `onChange(mentor.id)`. Se `mentors.length === 0`, `<p className="muted">Nenhum mentor cadastrado.</p>`.

4. **`app/globals.css`** — nova seção ao final `/* Mentor no encontro (Agenda e Visão geral) */`, reutilizando `.mini-avatar` e `.filter-overlay` existentes:
   - `.mentor-pick{position:relative;margin-top:6px}`
   - `.mentor-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:rgba(255,255,255,.7);border-radius:999px;padding:3px 10px 3px 3px;font-size:10px;font-weight:600;color:#3a443d;cursor:pointer}` + `.mentor-chip:hover{border-color:#c7cabf;background:#fff}`
   - `.mentor-chip .mini-avatar{width:20px;height:20px;font-size:7px}`
   - `.mentor-chip.empty{color:#949b96;padding:5px 10px}` (sem avatar)
   - `.manual-flag{font-style:normal;font-size:8px;letter-spacing:.5px;background:#f1e8df;color:#956f52;border-radius:10px;padding:2px 7px;text-transform:uppercase}` (mesma linguagem visual do `.review-flag`)
   - `.mentor-popover{position:absolute;top:calc(100% + 6px);left:0;z-index:25;background:#fff;border:1px solid var(--line);border-radius:11px;box-shadow:0 16px 40px rgba(20,30,25,.14);padding:8px;width:220px;display:flex;flex-direction:column;gap:2px}` (mesmo padrão do `.filter-popover`, alinhado à esquerda para não estourar na Agenda)
   - `.mentor-popover button{border:0;background:none;border-radius:8px;display:flex;align-items:center;gap:9px;padding:8px 9px;font-size:11px;text-align:left;cursor:pointer}` + `.mentor-popover button:hover{background:#f4f6f2}` + `.mentor-popover button.selected{background:#efece4;font-weight:600}` + `.mentor-popover button svg{margin-left:auto;color:var(--green)}`

Nenhum outro arquivo deve ser tocado (rota e cliente já existem; sync e contador são de outras issues).

## Checklist
- [ ] `lib/types.ts`: adicionar `mentorSource: "auto" | "manual" | null` em `Meeting`
- [ ] `lib/supabase/data.ts`: mapear `source` de `meeting_mentors` em `loadAppData` (`mapMeeting` + merge do dedupe com `manual` prevalecendo)
- [ ] `components/mentoria-app.tsx`: criar `MentorChip` (chip + popover com todos os mentores, estado "Sem mentor", flag "manual", "+N" para vínculos legados)
- [ ] `components/mentoria-app.tsx`: `handleMentorChange` no `MentoriaApp` com update otimista, rollback no erro e `notify()`
- [ ] `components/mentoria-app.tsx`: threading das props `mentors`/`onMentorChange` para `Dashboard` → `MeetingRow` e `AgendaView` → `AgendaItem`, renderizando o chip nos dois
- [ ] `app/globals.css`: seção `/* Mentor no encontro */` com `.mentor-pick`, `.mentor-chip(.empty)`, `.manual-flag`, `.mentor-popover`
- [ ] Garantir que NÃO existe opção de remover mentor no seletor (edição sempre troca para um mentor)
- [ ] Testar: trocar mentor na Agenda → chip atualiza sem reload, flag "manual" aparece, toast de sucesso, Dashboard reflete
- [ ] Testar: encontro sem mentor → "Sem mentor" → escolher mentor cria vínculo
- [ ] Testar erro (ex.: sem sessão): chip volta ao valor anterior e toast mostra a mensagem
- [ ] Verificar mobile (≤760px): chip visível e popover dentro da viewport
- [ ] `npx tsc --noEmit` / `npm run build` sem erros
