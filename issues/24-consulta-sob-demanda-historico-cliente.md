# 24: Consulta Sob Demanda do Histórico do Cliente

**Tipo:** Implementação
**Página:** Módulo E — Aba "Histórico" na Ficha do Cliente (camada de dados)

## Descrição
Criar em `lib/supabase/data.ts` a consulta dedicada do histórico do cliente, no padrão de `loadBriefing`/`loadMenteeMonthMeetings` (sob demanda, nunca na carga geral): busca sem limite de data os encontros do cliente (individuais vinculados + encontros de qualquer tipo com participação registrada como presente), deduplica cópias entre calendários dos mentores (mesmo título + início + duração + tipo, mesma regra da carga geral, preservando o vínculo de mentor de qualquer cópia), busca todos os materiais do cliente da tabela da issue 19 e associa cada material ao encontro vinculado (ou a qualquer cópia deduplicada dele), retornando os dados prontos para a linha do tempo ordenada do mais recente ao mais antigo.

**Depende de:** issue 19 (tabela de materiais).

## Decisões de implementação

**Padrão sob demanda no browser:** mesma abordagem de `loadBriefing`/`loadMenteeMonthMeetings` (`lib/supabase/data.ts:195-216` e `296-315`): leitura direta via `getSupabaseBrowserClient()`, RLS já permite `select` a `authenticated` em `meetings`, `meeting_participations`, `meeting_mentors`, `mentors` e `mentee_materials` (migration `202607030002_mentee_materials.sql`). Nenhuma rota de API nova.

**Três consultas em paralelo (`Promise.all`), sem filtro de data:**
1. **Individuais vinculados:** `supabase.from("meetings").select("*, meeting_mentors(mentor_id, source, mentors(name))").eq("individual_mentee_id", menteeId)`.
2. **Com participação presente (qualquer tipo):** `supabase.from("meeting_participations").select("meetings!inner(*, meeting_mentors(mentor_id, source, mentors(name)))").eq("mentee_id", menteeId).eq("attended", true)` — mesmo padrão de join interno de `loadMenteeMonthMeetings`, porém sem `gte`/`lt` de data.
3. **Materiais:** `supabase.from("mentee_materials").select("*").eq("mentee_id", menteeId)`.

O embed `meeting_mentors(mentor_id, source, mentors(name))` traz o vínculo de mentor com nome em uma ida só (sem consulta dependente de ids). Tipar o embed com tipo local (ex.: `HistoryMeetingRow = MeetingRow & { meeting_mentors: Array<{ mentor_id: string; source: "auto" | "manual"; mentors: { name: string } | { name: string }[] | null }> }`) e tratar `mentors` defensivamente como objeto ou array (mesmo cuidado de `loadMenteeMonthMeetings` com `row.meetings`).

**Merge e dedupe (reuso máximo do código existente):**
- Unir as linhas das consultas 1 e 2 num `Map<string, HistoryMeetingRow>` por `row.id` (um individual com participação registrada aparece nas duas — não pode duplicar).
- Mapear cada linha com o `mapMeeting(row, links)` existente (links vêm do embed) e calcular a chave com o `meetingKey(meeting)` existente — exatamente a regra da carga geral (título normalizado + início + duração + tipo + menteeIds).
- Dedupe por chave preservando vínculo de mentor de qualquer cópia (merge de `mentorIds`, como em `loadAppData:102`), e manter um `Map` auxiliar `meetingIdParaChave` com o id de **toda** cópia (inclusive as descartadas) → chave da entrada deduplicada, para o casamento de materiais.
- Nome do mentor: mapa `mentorId → name` construído a partir do embed de todas as cópias; `mentorName` = nome do primeiro `mentorId` do encontro deduplicado, `null` se sem vínculo.

**Casamento de materiais:** para cada `MaterialRow`: se `meeting_id` está em `meetingIdParaChave`, anexa à entrada de encontro correspondente (gravações antes de resumos); senão (sem `meeting_id` **ou** apontando para encontro que não é do cliente), vira entrada avulsa posicionada por `happened_at`.

**Ordenação:** entradas (encontros + materiais avulsos) ordenadas do mais recente ao mais antigo por `startsAt`/`happenedAt`.

## Cenários

1. **Cliente com histórico longo:** individuais desde 2023 (backfill) + grupos com presença registrada retornam sem limite de data, ordenados do mais recente ao mais antigo, com `mentorName` preenchido e frente como rótulo (`frontDbToLabel`).
2. **Encontro duplicado entre calendários de 2 mentores:** vira uma única entrada (mesma chave de `meetingKey`), com `mentorName` preservado de qualquer cópia; material cujo `meeting_id` aponta para a cópia descartada aparece dentro da entrada deduplicada (via `meetingIdParaChave`).
3. **Individual com participação registrada:** aparece na consulta 1 e na 2 — dedupe por `row.id` garante entrada única antes do dedupe por chave.
4. **Encontro com gravação e resumo vinculados:** entrada do encontro carrega os dois materiais (`materials`), gravações antes de resumos.
5. **Material sem `meeting_id` (ou vinculado a encontro que não é do cliente, ex.: grupo sem presença registrada):** vira entrada avulsa própria (`kind: "material"`), posicionada por `happened_at` — nunca some da linha do tempo.
6. **Grupo em que o cliente tem participação `attended = false`:** não entra no histórico (filtro `.eq("attended", true)`).
7. **Encontro sem mentor vinculado:** `mentorName: null` (UI exibirá "Sem mentor").
8. **Cliente sem encontros nem materiais:** retorna `[]` (UI exibirá estado vazio).
9. **Erro do Supabase em qualquer consulta:** `assertNoError` lança; a UI (issue 25) mostra erro com retry.

## Arquivos

### Modificar
1. **`lib/supabase/data.ts`** (única modificação da issue):
   - Import: adicionar `MaterialRow` ao import de `./database.types` e o tipo `MeetingFront` de `@/lib/meeting-front` (ou usar `Meeting["front"]`).
   - Exportar tipos para a UI:
     - `export interface MenteeHistoryMaterial { id: string; type: "recording" | "summary"; title: string; driveUrl: string; happenedAt: string }`
     - `export type MenteeHistoryEntry = { kind: "meeting"; id: string; title: string; startsAt: string; type: "Individual" | "Grupo"; front: MeetingFront; mentorName: string | null; materials: MenteeHistoryMaterial[] } | { kind: "material"; happenedAt: string; material: MenteeHistoryMaterial }`
   - Nova função `export async function loadMenteeHistory(menteeId: string): Promise<MenteeHistoryEntry[]>` implementando as decisões acima (3 consultas em `Promise.all`, merge por id, `mapMeeting` + `meetingKey` reusados, dedupe com merge de mentores, casamento de materiais, sort decrescente).
   - Reusar sem alterar: `mapMeeting`, `meetingKey`, `frontDbToLabel`, `assertNoError`, `getSupabaseBrowserClient`.

### Criar
Nenhum.

### Não tocar
`components/mentoria-app.tsx` (aba/UI é a issue 25), `loadAppData` e demais funções de `lib/supabase/data.ts`, `lib/supabase/database.types.ts` (a `MaterialRow` já existe da issue 19), rotas de API, migrations.

## Checklist

- [x] Tipos `MenteeHistoryMaterial` e `MenteeHistoryEntry` exportados em `lib/supabase/data.ts`
- [x] `loadMenteeHistory(menteeId)` criada: 3 consultas em `Promise.all`, sem filtro de data, com `assertNoError` em cada resultado
- [x] Consulta de individuais por `individual_mentee_id` e de participações por `mentee_id` + `attended = true`, ambas com embed `meeting_mentors(mentor_id, source, mentors(name))`
- [x] Merge por `row.id` antes do dedupe (individual com participação não duplica)
- [x] Dedupe reusa `mapMeeting` + `meetingKey` (mesma regra da carga geral), com merge de `mentorIds` e mapa id-de-toda-cópia → entrada
- [x] Materiais com `meeting_id` de qualquer cópia entram na entrada do encontro; sem correspondência viram entrada avulsa por `happened_at`
- [x] `mentorName` resolvido do embed (primeiro mentor vinculado; `null` sem vínculo)
- [x] Retorno ordenado do mais recente ao mais antigo; cliente sem dados retorna `[]`
- [x] Nenhuma alteração em `loadAppData`, componentes ou rotas; `npm run build` (ou typecheck) passa
