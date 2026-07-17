# 38: Registro automático de participação de um encontro encerrado
**Tipo:** Implementação
**Página:** Módulo A — Coleta Automática de Participação
## Descrição
Implementar a função backend que, dado um encontro encerrado com link do Meet e a lista real de participantes (issue 37), casa participante↔mentorado por e-mail cadastrado e grava a participação com origem "automática": individual = presente/ausente para o mentorado do encontro; grupo = presentes todos os mentorados ativos detectados; participantes sem correspondência (mentores, externos) são ignorados. Presença positiva atualiza `last_participation_at` (mesma regra de `lib/participation-server.ts`), apenas presença/ausência é gravada (notas ficam vazias), a deduplicação é respeitada (um registro por mentorado por encontro) e encontros já confirmados manualmente nunca são tocados.

## Dependências assumidas (contratos das issues 36 e 37)

**Issue 36 (modelagem — esta issue NÃO cria migration, apenas consome):**
- Enum `public.participation_source` = `'manual' | 'auto'`.
- `public.meeting_participations.source participation_source not null default 'manual'`.
- `public.meetings.attendance_source participation_source` (nullable; `null` = sem registro; complementa `attendance_recorded_at`).
- `public.meetings.auto_collect_last_attempt_at timestamptz` (nullable; marcador de última tentativa de coleta).
- `lib/supabase/database.types.ts` já atualizado pela 36 (`ParticipationRow.source`, `MeetingRow.attendance_source`, `MeetingRow.auto_collect_last_attempt_at`, enum `participation_source`).

**Issue 37 (cliente Meet — esta issue NÃO implementa chamadas ao Google):**
- `lib/google-meet.ts` exporta `fetchMeetParticipants(meetUrl: string): Promise<MeetParticipantsResult>` com:
  - `{ status: "ok"; participants: Array<{ email: string | null; displayName: string | null }> }` — e-mails já resolvidos via Directory quando possível;
  - `{ status: "unavailable" }` — o Google ainda não tem `conferenceRecord`/participantes para essa reunião (retry depois).

> Se a implementação real da 36/37 divergir nos nomes acima, adaptar esta issue aos nomes reais — a semântica é a descrita aqui.

## Comportamento da função

Criar `lib/auto-participation-server.ts` (padrão de `lib/participation-server.ts`: `"server-only"`, `pg.Client` com `DATABASE_URL`, transação) exportando:

```ts
export type AutoCollectStatus =
  | "recorded"            // coleta concluída e gravada
  | "unavailable"         // Google ainda sem dados — retry pela rotina (issue 39)
  | "skipped_manual"      // encontro já confirmado manualmente — nunca tocar
  | "skipped_not_eligible" // sem meet_url, ainda não encerrado ou encontro inexistente
  | "error";              // falha inesperada (API/DB) — retry pela rotina

export interface AutoCollectResult {
  status: AutoCollectStatus;
  presentCount?: number;   // linhas gravadas com attended = true
  absentCount?: number;    // linhas gravadas com attended = false (só individual)
  message?: string;        // detalhe em caso de "error"
}

export async function collectMeetingParticipation(meetingId: string): Promise<AutoCollectResult>
```

Passos internos:
1. **Carregar o encontro**: `select id, type, individual_mentee_id, meet_url, starts_at, ends_at, attendance_recorded_at, attendance_source from public.meetings where id = $1`. Inexistente → `skipped_not_eligible`.
2. **Guardas (nesta ordem, antes de chamar o Google)**:
   - `attendance_recorded_at is not null` e `coalesce(attendance_source, 'manual') = 'manual'` → `skipped_manual` (cobre registros manuais legados anteriores à issue 36, que têm `attendance_source` null). Não gravar nada, nem `auto_collect_last_attempt_at`.
   - `meet_url` nulo/vazio ou `ends_at > now()` → `skipped_not_eligible`.
3. **Buscar participantes** via `fetchMeetParticipants(meet_url)` (issue 37).
   - `status: "unavailable"` → `update public.meetings set auto_collect_last_attempt_at = now() where id = $1` e retornar `unavailable` (a issue 39 retenta).
   - Exceção do cliente → `auto_collect_last_attempt_at = now()` e retornar `error` com `message` (não relançar; a rotina decide logar/seguir).
4. **Matching participante↔mentorado** (tudo em minúsculas; e-mails comparados por igualdade exata após `trim().toLowerCase()`):
   - **Individual**: carregar o mentorado de `individual_mentee_id` (qualquer status — o encontro é dele). Presente se o e-mail cadastrado dele aparece entre os participantes; senão, fallback: algum participante **sem e-mail resolvido** cujo `displayName` normalizado (mesma normalização NFD/lowercase/sem pontuação usada em `app/api/calendar/sync/route.ts` — replicar helper local, não importar de rota) é igual ao `name` normalizado do mentorado. Grava **uma** linha: `attended = true` ou `attended = false`.
   - **Grupo**: carregar mentorados com `status = 'active'` (`select id, name, lower(email) as email from public.mentees where status = 'active'`). Presentes: (a) todo mentorado cujo e-mail casa com o e-mail de algum participante; (b) fallback — participante **sem e-mail resolvido** cujo `displayName` normalizado casa com o `name` normalizado de **exatamente 1** mentorado ativo ainda não marcado (0 ou 2+ candidatos → participante ignorado). Grava linhas `attended = true` **somente** para os detectados; ausentes NÃO ganham linha. Participantes sem correspondência (mentores, convidados externos) são ignorados silenciosamente.
5. **Gravação (transação única)**:
   - Upsert por linha, protegendo linha manual pré-existente (defesa em profundidade):
     ```sql
     insert into public.meeting_participations (meeting_id, mentee_id, attended, engagement_score, evolution_score, note, source)
     values ($1, $2, $3, null, null, '', 'auto')
     on conflict (meeting_id, mentee_id) do update set
       attended = excluded.attended,
       source = 'auto'
     where meeting_participations.source = 'auto'
     ```
     (nunca escreve notas/scores; nunca sobrescreve linha `manual`).
   - Para cada linha com `attended = true`: `update public.mentees set last_participation_at = greatest(coalesce(last_participation_at, '-infinity'::timestamptz), $2) where id = $1` usando `starts_at` do encontro (regra idêntica a `lib/participation-server.ts`).
   - Marcar o encontro: `update public.meetings set attendance_recorded_at = now(), attendance_source = 'auto', auto_collect_last_attempt_at = now() where id = $1`. Isso vale inclusive para grupo com zero detectados — a coleta foi concluída com sucesso (dados existiam no Google); a conferência humana é o Módulo B (issues 40–42).
   - `commit`; qualquer erro → `rollback` e retorno `error`.

A função é idempotente: reexecutar sobre um encontro já coletado automaticamente apenas reaplica as mesmas linhas `auto` (o unique `(meeting_id, mentee_id)` impede duplicação) e nunca toca encontro/linha manual.

## Cenários

### Happy Path
1. **Individual, presente por e-mail**: encontro individual encerrado com `meet_url`; e-mail do mentorado aparece nos participantes → 1 linha `attended=true, source='auto'`, `last_participation_at` avança para `starts_at` (se maior), encontro marcado `attendance_source='auto'` + `attendance_recorded_at`. Retorno `recorded` com `presentCount=1`.
2. **Individual, ausente**: mentorado não aparece (nem por e-mail nem por displayName) → 1 linha `attended=false`, `last_participation_at` intocado, encontro marcado como coletado. Retorno `recorded` com `absentCount=1`.
3. **Grupo, presenças mistas**: 10 participantes, 4 casam com mentorados ativos por e-mail, mentores e externos no meio → 4 linhas `attended=true`, 4 `last_participation_at` atualizados, demais participantes ignorados, nenhum "ausente" gravado.
4. **Fallback por displayName**: participante sem e-mail resolvido com `displayName` "Maria Souza" casa (normalizado) com exatamente 1 mentorada ativa → marcada presente.

### Edge Cases
- **Encontro confirmado manualmente** (`attendance_source='manual'` ou legado `attendance_recorded_at` preenchido com `attendance_source` null) → `skipped_manual`, sem chamada ao Google e sem escrita alguma.
- **Sem `meet_url` ou ainda não encerrado** → `skipped_not_eligible`, sem escrita.
- **displayName ambíguo** (casa 2+ mentorados) ou sem match → participante ignorado; fallback nunca é usado quando o participante já tem e-mail resolvido (e-mail que não casa = não é mentorado).
- **Mentorado sem e-mail cadastrado** (`email` null) → só pode ser detectado via fallback de displayName.
- **Mentorado pausado/encerrado em grupo** → fora da lista de ativos, nunca marcado. No individual, o mentorado do encontro é registrado independentemente do status.
- **Individual sem `individual_mentee_id`** (dado inconsistente) → `skipped_not_eligible`.
- **Reexecução sobre encontro já coletado (`attendance_source='auto'`)** → idempotente: upserta as mesmas linhas, sem duplicar.
- **Linha manual pré-existente para um mentorado** → cláusula `where source='auto'` do upsert preserva a linha manual intacta.
- **Grupo com zero mentorados detectados** → nenhuma linha, mas encontro marcado como coletado (evita retry infinito na issue 39).
- **E-mails com caixa/espaços divergentes** → comparação sempre `trim().toLowerCase()` dos dois lados.

### Cenário de Erro
- **Google ainda sem dados** (`fetchMeetParticipants` → `unavailable`): grava apenas `auto_collect_last_attempt_at=now()` e retorna `unavailable`; `attendance_recorded_at`/`attendance_source` permanecem null, permitindo retry pela rotina (issue 39) e registro manual pelo mentor a qualquer momento.
- **Falha de API do Google** (auth, quota, rede — exceção do cliente): grava `auto_collect_last_attempt_at=now()`, retorna `error` com `message`; nada de participação é escrito.
- **Falha de banco no meio da gravação**: `rollback` da transação — nenhuma linha parcial, encontro não marcado como coletado; retorno `error`.
- **`DATABASE_URL` ausente**: erro imediato (mesmo comportamento de `lib/participation-server.ts`).

## Banco de Dados
Nenhuma migration nesta issue. Consome integralmente a modelagem da issue 36 (`meeting_participations.source`, `meetings.attendance_source`, `meetings.auto_collect_last_attempt_at`, enum `participation_source`) e colunas já existentes (`meetings.individual_mentee_id`, `meetings.meet_url`, `meetings.attendance_recorded_at`, `mentees.email`, `mentees.status`, `mentees.last_participation_at`, unique `(meeting_id, mentee_id)`).

## Arquivos

### Criar
- `lib/auto-participation-server.ts` — função `collectMeetingParticipation(meetingId)` e tipos `AutoCollectStatus`/`AutoCollectResult` descritos acima; helper local `normalized()` (mesmo padrão de `app/api/calendar/sync/route.ts`) para o fallback por displayName.

### Modificar
- Nenhum. A rota/cron que varre encontros e chama esta função é a issue 39; o cliente Meet é a issue 37; migration e types são a issue 36; a marcação "manual prevalece" no save manual é a issue 42.

## Checklist
- [ ] `lib/auto-participation-server.ts` criado com `"server-only"`, `pg` e transação no padrão de `lib/participation-server.ts`
- [ ] Guarda de confirmação manual (incluindo legado `attendance_recorded_at` sem `attendance_source`) executa ANTES de qualquer chamada ao Google e não escreve nada
- [ ] Individual grava exatamente 1 linha (presente OU ausente) para `individual_mentee_id`
- [ ] Grupo grava apenas presenças de mentorados `status='active'`; nenhum registro de ausência
- [ ] Matching por e-mail case-insensitive; fallback por displayName só sem e-mail resolvido e com exatamente 1 candidato
- [ ] Participantes sem correspondência (mentores/externos) ignorados
- [ ] Upsert com `source='auto'` e `where source='auto'` (nunca sobrescreve linha manual); notas vazias e scores null
- [ ] `last_participation_at` atualizado com `greatest(...)` usando `starts_at`, só em presença positiva
- [ ] Sucesso marca `attendance_recorded_at=now()` + `attendance_source='auto'` + `auto_collect_last_attempt_at=now()` na mesma transação
- [ ] `unavailable`/exceção do cliente gravam somente `auto_collect_last_attempt_at` e retornam status distinguível para retry
- [ ] Nenhum arquivo além do listado foi tocado (sem rota, sem cron, sem migration)
- [ ] `npm run lint` e `npm run build` passam
