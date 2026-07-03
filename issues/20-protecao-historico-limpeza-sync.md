# 20: Proteção do Histórico na Limpeza do Sync + Janela Ativa em Um Único Lugar

**Tipo:** Implementação
**Página:** Módulo C — Proteção do Histórico na Limpeza do Sync

## Descrição
Definir os limites da janela ativa do sync (agora − 24h a agora + 90d) em um único lugar (`lib/google-calendar.ts`), calculados uma vez por execução e reutilizados pela busca de eventos e pela limpeza em `app/api/calendar/sync/route.ts`. A limpeza passa a remover apenas encontros cujo início está dentro da janela ativa e ausentes das chaves da execução atual — encontros anteriores ou posteriores à janela nunca são apagados —, mantendo todas as salvaguardas atuais (origem Calendar, calendários configurados, sem presença registrada, sem participações) e sem alterar upsert nem vínculo automático de mentor.

## Cenários

1. **Janela definida em um único lugar:** `lib/google-calendar.ts` exporta `activeSyncWindow()`, que retorna `{ timeMin, timeMax }` em ISO (timeMin = agora − 24h; timeMax = agora + 90d). Os cálculos hardcoded dentro de `listWorkspaceEvents` (linhas 71–72 atuais) são removidos e substituídos pela janela recebida.
2. **Janela calculada uma vez por execução:** `runCalendarSync` chama `activeSyncWindow()` uma única vez, passa o resultado para `listWorkspaceEvents(window)` e usa exatamente os mesmos `timeMin`/`timeMax` como parâmetros da query de limpeza. Busca e limpeza nunca divergem (sem segundo `Date.now()`).
3. **Histórico do passado protegido:** encontro sincronizado (`google_event_id` preenchido, calendário configurado) com `starts_at` anterior a `timeMin` — por exemplo, um encontro do backfill de 2023 — NÃO é apagado pela limpeza, mesmo ausente de `current_calendar_sync_keys`, mesmo sem presença registrada e sem participações.
4. **Futuro além da janela protegido:** encontro com `starts_at` posterior a `timeMax` (além de +90d) NÃO é apagado pela limpeza, mesmo ausente das chaves da execução atual.
5. **Limpeza dentro da janela continua funcionando:** encontro com `starts_at` dentro da janela, dos calendários configurados, ausente das chaves atuais (sumiu/foi cancelado no Calendar), sem `attendance_recorded_at` e sem participações → É apagado, exatamente como hoje.
6. **Salvaguardas atuais preservadas:** dentro da janela, encontro com presença registrada (`attendance_recorded_at` não nulo) OU com participações OU de calendário não configurado OU sem `google_event_id` continua nunca sendo apagado.
7. **Upsert e vínculo de mentor inalterados:** o upsert de encontros e as duas queries de `meeting_mentors` (remoção de vínculo `auto` divergente e inserção de vínculo `auto`) não mudam — já operam somente sobre `current_calendar_sync_keys`, portanto não tocam o histórico.
8. **Busca de eventos idêntica:** `listWorkspaceEvents` continua consultando o Google com os mesmos limites de hoje (−24h a +90d); apenas a origem dos valores muda. `POST` e `GET` (cron) do route seguem com o mesmo comportamento externo.

## Arquivos

### Modificar

- **`lib/google-calendar.ts`**
  - Exportar `interface SyncWindow { timeMin: string; timeMax: string }` e `function activeSyncWindow(): SyncWindow`, com os mesmos cálculos hoje inline em `listWorkspaceEvents`: `timeMin = new Date(Date.now() − 24*60*60*1000).toISOString()`, `timeMax = new Date(Date.now() + 90*24*60*60*1000).toISOString()`.
  - Alterar a assinatura para `listWorkspaceEvents(window: SyncWindow = activeSyncWindow())` e usar `window.timeMin`/`window.timeMax` no `calendar.events.list`, removendo os dois cálculos locais.
- **`app/api/calendar/sync/route.ts`**
  - Importar `activeSyncWindow` (junto de `configuredCalendarSources, listWorkspaceEvents`).
  - Em `runCalendarSync`: `const window = activeSyncWindow();` antes da busca; `const events = await listWorkspaceEvents(window);`.
  - Na query de limpeza (delete de `public.meetings`), acrescentar às condições existentes: `and meeting.starts_at >= $2::timestamptz and meeting.starts_at <= $3::timestamptz`, passando `[configuredCalendarIds, window.timeMin, window.timeMax]`. Nenhuma outra condição da query muda.

### Criar

- Nenhum arquivo novo.

## Checklist

- [x] `activeSyncWindow()` e `SyncWindow` exportados de `lib/google-calendar.ts`, com timeMin/timeMax idênticos aos valores atuais (−24h / +90d)
- [x] `listWorkspaceEvents` recebe a janela por parâmetro (default `activeSyncWindow()`) e não tem mais cálculo de data hardcoded
- [x] `runCalendarSync` calcula a janela uma única vez e usa o mesmo objeto na busca e na limpeza
- [x] Query de limpeza filtra `starts_at` entre `timeMin` e `timeMax` via parâmetros (sem interpolação de string)
- [x] Encontros com `starts_at` fora da janela nunca são apagados, mesmo ausentes de `current_calendar_sync_keys`
- [x] Salvaguardas existentes intactas: `google_event_id is not null`, calendários configurados, `attendance_recorded_at is null`, sem participações
- [x] Upsert de encontros e queries de `meeting_mentors` sem nenhuma alteração
- [x] Nenhum arquivo além de `lib/google-calendar.ts` e `app/api/calendar/sync/route.ts` modificado
- [x] `npx tsc --noEmit` (ou build do projeto) passa sem erros
