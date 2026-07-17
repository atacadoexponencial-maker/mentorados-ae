# 36: Fundação de dados — origem da participação (automática vs. manual)
**Tipo:** Implementação
**Página:** Módulo A — Coleta Automática de Participação
## Descrição
Criar migration adicionando a distinção de origem do registro de participação: origem por encontro em `public.meetings` (ex.: automática / manual, complementando `attendance_recorded_at`) e/ou por linha em `public.meeting_participations` (ex.: coluna `source`), além do controle necessário para a rotina de coleta (ex.: marcador de última tentativa de coleta). Atualizar `lib/supabase/database.types.ts` e os selects afetados, sem mudar comportamento visível ainda.

## Modelagem escolhida

- **Novo enum `public.participation_source`** com valores `'auto' | 'manual'` (novo tipo em vez de reutilizar `public.mentor_link_source` — mesmo shape, mas semântica distinta; acoplar os dois impediria evoluções independentes).
- **Por encontro (`public.meetings`):** coluna `attendance_source public.participation_source` **nullable**. Os três estados ficam: `null` = sem registro; `'auto'` = coletado do Google Meet; `'manual'` = confirmado pelo mentor. Complementa `attendance_recorded_at` (que continua sendo o timestamp do registro) com um check constraint garantindo que os dois andam juntos: `(attendance_source is null) = (attendance_recorded_at is null)`.
- **Por linha (`public.meeting_participations`):** coluna `source public.participation_source not null default 'manual'`. O default cobre todo o histórico existente (tudo que existe hoje foi registrado manualmente) e o fluxo manual atual.
- **Controle da rotina de coleta (issue 39):** coluna `meetings.auto_collect_last_attempt_at timestamptz` nullable — marcador da última tentativa de coleta automática, para retry sem re-varrer indefinidamente. Nenhum código a preenche nesta issue.
- **Regra "manual prevalece" viabilizada aqui, aplicada nas issues 38/39:** a coleta automática (issue 38) só poderá escrever quando `attendance_source is null`; nunca quando `'manual'`. O salvamento manual (`lib/participation-server.ts`) passa a gravar `attendance_source = 'manual'` e `source = 'manual'` em todas as linhas (inclusive no `on conflict do update`), o que converte em definitivo um registro automático anterior. Essa alteração no `participation-server.ts` é **obrigatória nesta issue**: com o check constraint, o `update ... set attendance_recorded_at = now()` atual falharia sem também setar `attendance_source`.

## Cenários

### Happy Path
1. **Migration aplicada em banco com dados existentes:** enum `participation_source` criado; encontros com `attendance_recorded_at` preenchido ficam com `attendance_source = 'manual'` (backfill), os demais ficam `null`; todas as linhas existentes de `meeting_participations` ficam com `source = 'manual'` (via default no `add column`); `auto_collect_last_attempt_at` nasce `null` em todos.
2. **Confirmação manual (fluxo atual inalterado na UI):** mentor salva participação pelo `AttendanceModal` → `saveParticipation` grava as linhas com `source = 'manual'` e o encontro com `attendance_recorded_at = now()` e `attendance_source = 'manual'`. Nada muda visivelmente.
3. **Carga geral do app:** `loadAppData`/`loadMenteeHistory` usam `select("*")`, então as novas colunas chegam sem mudança de query; `mapMeeting` passa a expor `attendanceSource` no tipo `Meeting` sem nenhum consumidor novo (fica disponível para as issues 35/43).

### Edge Cases
4. **Re-salvamento manual sobre registro automático (futuro, issues 38/39):** encontro com `attendance_source = 'auto'` e linhas `source = 'auto'` → mentor salva manualmente → upsert converte todas as linhas para `'manual'` e o encontro para `attendance_source = 'manual'`, em definitivo. A coleta automática nunca mais o toca (guarda `attendance_source is null` na issue 38).
5. **Encontro sem registro:** `attendance_recorded_at` e `attendance_source` ambos `null` — o check constraint impede estado meio-preenchido (origem sem timestamp ou timestamp sem origem).
6. **Sync/backfill do Calendar:** `app/api/calendar/sync/route.ts`, `scripts/sync-google-calendar.mjs` e `scripts/backfill-calendar.mjs` não tocam nas novas colunas; os deletes conservadores continuam guardados por `attendance_recorded_at is null` + ausência de participações — comportamento idêntico.
7. **Migration reaplicada em banco recém-criado (sem dados):** o `update` de backfill afeta 0 linhas e tudo aplica limpo na ordem `create type → add columns → backfill → add constraint`.

### Cenário de Erro
8. **Escrita inconsistente:** qualquer código que setar `attendance_recorded_at` sem `attendance_source` (ou vice-versa) é rejeitado pelo constraint `attendance_source_matches_recorded` — falha ruidosa em vez de estado silenciosamente inconsistente. É exatamente o que aconteceria com o `participation-server.ts` atual, por isso ele é atualizado nesta issue.

## Banco de Dados

Nova migration `supabase/migrations/202607170001_participation_source.sql`:

```sql
-- Origem do registro de participação (Módulo A — coleta automática).
-- 'manual' = confirmado pelo mentor; 'auto' = coletado do Google Meet.
-- Em meetings, attendance_source null = sem registro. Manual sempre prevalece:
-- a coleta automática nunca sobrescreve attendance_source = 'manual'.

create type public.participation_source as enum ('auto', 'manual');

alter table public.meetings
  add column attendance_source public.participation_source,
  add column auto_collect_last_attempt_at timestamptz;

-- Tudo que já tem presença registrada veio do fluxo manual existente.
update public.meetings
  set attendance_source = 'manual'
  where attendance_recorded_at is not null;

alter table public.meetings
  add constraint attendance_source_matches_recorded
  check ((attendance_source is null) = (attendance_recorded_at is null));

alter table public.meeting_participations
  add column source public.participation_source not null default 'manual';
```

Sem novas tabelas, sem novas policies (RLS das tabelas já cobre as colunas), sem novos índices (a rotina da issue 39 define os seus se precisar).

## Arquivos

### Criar
- `supabase/migrations/202607170001_participation_source.sql` — conteúdo da seção Banco de Dados.

### Modificar
- `lib/supabase/database.types.ts`
  - `MeetingRow`: adicionar `attendance_source: "auto" | "manual" | null; auto_collect_last_attempt_at: string | null`.
  - `ParticipationRow`: adicionar `source: "auto" | "manual"`.
  - `Enums`: adicionar `participation_source: "auto" | "manual"`.
  - Insert de `meeting_participations`: incluir `"source"` no `Omit` e reintroduzir como opcional (`source?: "auto" | "manual"`), refletindo o default do banco — mesmo padrão já usado em `meeting_mentors`.
- `lib/types.ts`
  - `Meeting`: adicionar `attendanceSource: "auto" | "manual" | null` (logo após `attendanceRecorded`). Nenhum componente consome ainda.
- `lib/supabase/data.ts`
  - `mapMeeting` (linha ~43): adicionar `attendanceSource: row.attendance_source`. Nenhuma query muda — os selects de `meetings` usam `select("*")`; os selects com colunas explícitas (`loadMenteeMonthMeetings`) não precisam das novas colunas.
- `lib/participation-server.ts`
  - Upsert (linhas 36–45): incluir a coluna `source` com valor literal `'manual'` no `insert` e `source = 'manual'` no `on conflict do update` (converte registro automático em manual em definitivo).
  - Update do encontro (linha 56): `update public.meetings set attendance_recorded_at = now(), attendance_source = 'manual' where id = $1`.

**Não tocar:** `app/api/meetings/[id]/participation/route.ts` (payload não muda), `app/api/calendar/sync/route.ts`, `scripts/*.mjs`, componentes de UI. Fora de escopo: qualquer escrita de `'auto'` ou de `auto_collect_last_attempt_at` (issues 38/39) e qualquer indicador visual (issue 43).

## Checklist

- [ ] Migration `202607170001_participation_source.sql` criada com enum, colunas, backfill e constraint na ordem da seção Banco de Dados
- [ ] `npm run db:migrate` aplica limpo no banco de desenvolvimento
- [ ] Backfill confirmado: encontros com `attendance_recorded_at` preenchido ficam `attendance_source = 'manual'`; os demais `null`; participações existentes ficam `source = 'manual'`
- [ ] `database.types.ts` atualizado (`MeetingRow`, `ParticipationRow`, `Enums`, Insert de `meeting_participations` com `source` opcional)
- [ ] `Meeting.attendanceSource` adicionado em `lib/types.ts` e mapeado em `mapMeeting` (`lib/supabase/data.ts`)
- [ ] `lib/participation-server.ts` grava `source = 'manual'` no upsert (insert e conflito) e `attendance_source = 'manual'` no update do encontro
- [ ] Salvar participação pelo modal continua funcionando idêntico (sem mudança visível); nova gravação respeita o check constraint
- [ ] `npm run build` (ou `tsc`) passa sem erros de tipo
- [ ] Nenhum outro arquivo tocado (sync, backfill, rotas e UI intactos)
