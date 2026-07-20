# 41: Pré-marcação automática e indicador de origem no registro do encontro
**Tipo:** Implementação
**Página:** Módulo B — Conferência e Sobrescrita Manual da Participação
## Descrição
Ao abrir o registro de participação de um encontro em `components/mentoria-app.tsx`: se houver participação automática, pré-marcar a presença conforme o dado real do Meet e exibir o indicador de origem; se não houver (sem Meet, dado indisponível ou não coletado), abrir em branco como hoje. O mentor pode alterar livremente qualquer presença pré-marcada antes de salvar.

## Dependências assumidas (contratos das issues 36 e 40)

**Issue 36 (modelagem — já consumível aqui):**
- `Meeting.attendanceSource: "auto" | "manual" | null` existe em `lib/types.ts` e é preenchido por `mapMeeting` em `lib/supabase/data.ts` — chega ao `AttendanceModal` via prop `meeting` sem nenhum fetch extra (o `loadAppData` usa `select("*")`).
- `meeting_participations.source` existe; quando `meetings.attendance_source = 'auto'`, todas as linhas do encontro são `source = 'auto'` (qualquer salvamento manual converte o encontro inteiro para `'manual'`).

**Issue 40 (protótipo — esta issue liga o dado real, não cria UI nova):**
- O `AttendanceModal` já renderiza o indicador de origem com os três rótulos ("Preenchida automaticamente (Google Meet)", "Confirmada pelo mentor", "Sem registro") e o layout de pré-marcação (individual Sim/Não; grupo com presentes marcados), alimentados por dado mockado/estático do protótipo.
- Esta issue substitui o mock pelo estado real: indicador dirigido por `meeting.attendanceSource` e pré-marcação dirigida pelas linhas reais de `meeting_participations`. Se os nomes/estrutura do protótipo divergirem, adaptar aos nomes reais — a semântica é a descrita aqui.

## Delta funcional sobre o protótipo

1. **Indicador de origem (sem fetch):** derivar direto de `meeting.attendanceSource` — `'auto'` → "Preenchida automaticamente (Google Meet)"; `'manual'` → "Confirmada pelo mentor"; `null` → "Sem registro".
2. **Nova função de leitura em `lib/supabase/data.ts`:**
   ```ts
   export interface MeetingParticipationEntry { menteeId: string; attended: boolean }
   export async function loadMeetingParticipation(meetingId: string): Promise<MeetingParticipationEntry[]>
   ```
   Implementada com o Supabase browser client (mesmo padrão de leitura de `loadMenteeMonthMeetings`, que já lê `meeting_participations` sob RLS): `supabase.from("meeting_participations").select("mentee_id, attended").eq("meeting_id", meetingId)`. **Não** criar GET em `app/api/meetings/[id]/participation/route.ts` — a rota permanece só com POST.
3. **Pré-marcação no `AttendanceModal`:** `useEffect` na abertura, **somente quando `meeting.attendanceSource === "auto"`** (manual e `null` abrem em branco como hoje, sem fetch):
   - Estado `loadingPrefill` inicia `true` no caso auto; enquanto carrega, os controles de presença e o botão "Salvar participação" ficam desabilitados (evita corrida entre clique do mentor e chegada do prefill). Guard `let active = true` no cleanup (padrão de `MenteeDrawer`).
   - **Individual:** linha do `meeting.menteeIds[0]` com `attended = true` → `setPresent(meeting.menteeIds)` (Sim); `attended = false` → `setPresent([])` (Não); sem linha → manter default atual.
   - **Grupo:** `setPresent` com os `menteeId` de linhas `attended = true`, filtrados aos mentorados renderizados na grade (status "Ativo" na prop `mentees`) para que o estado da UI corresponda ao que será salvo.
   - Notas/observação nunca são pré-preenchidas (coleta automática grava nota vazia e scores null).
4. **Salvar/cancelar inalterados:** o submit continua chamando `saveParticipation` como hoje; a conversão para manual no save é responsabilidade das issues 36/42.

## Cenários

### Happy Path
1. **Individual com coleta automática, presente:** `meeting.attendanceSource === 'auto'` e linha `attended = true` → modal abre com indicador "Preenchida automaticamente (Google Meet)" e "Sim" selecionado; mentor pode trocar para "Não" livremente antes de salvar.
2. **Individual com coleta automática, ausente:** linha `attended = false` → "Não" pré-selecionado (hoje o default é "Sim" — o dado real prevalece).
3. **Grupo com coleta automática:** linhas `attended = true` para 4 mentorados ativos → grade abre com os 4 marcados e os demais desmarcados; indicador "Preenchida automaticamente (Google Meet)"; mentor marca/desmarca livremente.
4. **Sem registro (`attendanceSource === null`):** nenhum fetch; indicador "Sem registro"; presença em branco exatamente como hoje (individual com default atual, grupo sem marcados).
5. **Confirmado manualmente (`attendanceSource === 'manual'`):** nenhum fetch; indicador "Confirmada pelo mentor"; campos em branco como hoje (comportamento atual preservado — reedição prevalecente é a issue 42).

### Edge Cases
6. **Auto sem nenhuma linha `attended = true` em grupo** (coleta concluída com zero detectados): indicador "Preenchida automaticamente (Google Meet)" e grade sem marcados — estado real, não é erro.
7. **Mentorado pré-marcado que foi pausado/encerrado após a coleta:** filtrado da pré-marcação (não aparece na grade de ativos); sua linha `auto` no banco permanece intocada, pois o save só envia os entries da grade.
8. **Modal fechado antes do fetch terminar:** guard `active` impede `setState` após unmount.
9. **Individual auto sem linha para o mentorado do encontro** (dado inconsistente): mantém o default atual do modal, indicador continua "Preenchida automaticamente (Google Meet)".

### Cenário de Erro
10. **Falha na leitura de `meeting_participations`** (rede/RLS): `loadingPrefill` encerra, modal libera os controles em branco (comportamento atual) — o mentor registra manualmente sem bloqueio; indicador continua refletindo `meeting.attendanceSource` (que veio da carga geral). Sem mensagem bloqueante; falha silenciosa é aceitável porque o caminho manual permanece íntegro.

## Arquivos

### Criar
- Nenhum.

### Modificar
- `lib/supabase/data.ts` — adicionar `MeetingParticipationEntry` e `loadMeetingParticipation(meetingId)` (browser client, select `mentee_id, attended` por `meeting_id`).
- `components/mentoria-app.tsx` — `AttendanceModal` (função na região das linhas ~376–403): estado `loadingPrefill`, `useEffect` de pré-marcação condicionado a `attendanceSource === 'auto'`, indicador de origem dirigido por `meeting.attendanceSource` (substituindo o mock do protótipo da 40), controles desabilitados durante o carregamento.

**Não tocar:** `app/api/meetings/[id]/participation/route.ts` (sem GET; POST inalterado), `lib/participation-server.ts`, `lib/types.ts` e `lib/supabase/database.types.ts` (já atualizados pela 36), `lib/auto-participation-server.ts` (issue 38), migrations. Fora de escopo: prevalência do manual no save (42) e indicador na listagem da agenda (43).

## Checklist

- [ ] `loadMeetingParticipation` criada em `lib/supabase/data.ts` no padrão de leitura browser-client existente; nenhuma rota nova criada
- [ ] Indicador de origem no `AttendanceModal` reflete `meeting.attendanceSource` real (auto / manual / sem registro)
- [ ] Fetch de participações ocorre apenas quando `attendanceSource === 'auto'`; manual e sem registro abrem em branco sem fetch (comportamento atual)
- [ ] Individual pré-marca Sim/Não conforme `attended` da linha do mentorado do encontro
- [ ] Grupo pré-marca somente mentorados ativos com `attended = true`; demais desmarcados
- [ ] Controles de presença e botão salvar desabilitados enquanto `loadingPrefill`; guard de unmount no effect
- [ ] Falha no fetch degrada para modal em branco sem bloquear o registro manual
- [ ] Mentor consegue alterar livremente qualquer presença pré-marcada antes de salvar; submit/`saveParticipation` inalterados
- [ ] Notas/observação nunca pré-preenchidas
- [ ] Nenhum arquivo além dos dois listados foi tocado
- [ ] `npm run lint` e `npm run build` passam
