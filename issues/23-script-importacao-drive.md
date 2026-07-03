# 23: Script de Importação de Gravações e Resumos do Drive

**Tipo:** Implementação
**Página:** Módulo D — Importação de Gravações e Resumos do Drive

## Descrição
Criar script de execução única no padrão dos `scripts/import-*.mjs` que autentica no Drive com a conta de serviço delegada (subject configurável por variável de ambiente), lista com paginação as subpastas de cliente de "1 ATIVOS AE" (id `1mD-icXalCyRuVp8_gcNEh3ifSF8eusHM` como padrão, parametrizável), casa pasta↔cliente pela marca normalizada (exato, depois continência parcial; ambíguos não importam), localiza a subpasta de gravações (nome normalizado contendo "GRAVA"), classifica arquivos em gravação (vídeo) / resumo (Doc ou .docx "Anotações do Gemini") / ignorado, extrai a data/hora do nome ("AAAA/MM/DD HH:MM GMT-03:00", com fallback para data de criação no Drive), grava os materiais na tabela da issue 19 de forma idempotente (upsert pelo id do arquivo) em transação, e casa cada material com o encontro individual do cliente cuja janela (−15min do início a +15min do fim) contém a data/hora — vinculando só com candidato único. Imprime relatório completo: pastas casadas/sem correspondência/ambíguas, clientes sem pasta, pastas sem subpasta de gravações, totais por tipo, ignorados, datas de fallback e materiais sem encontro casado.

**Depende de:** issue 19 (tabela de materiais) e issue 22 (encontros históricos precisam existir para o casamento material↔encontro).

## Cenários

1. **Autenticação delegada no Drive:** JWT com `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (mesmo tratamento de chave de `scripts/backfill-calendar.mjs:28-31`), `subject` vindo de `GOOGLE_DRIVE_SUBJECT` com fallback para o primeiro subject de `GOOGLE_WORKSPACE_SUBJECTS`/`GOOGLE_WORKSPACE_SUBJECT` (em produção: `marcelle@seteads.com`), e escopo EXATAMENTE `https://www.googleapis.com/auth/drive` (é o único autorizado no Workspace — nenhum `.readonly`/`.metadata`). Ausência de qualquer variável obrigatória → erro imediato antes de tocar Drive ou banco.
2. **Pasta raiz parametrizável:** id da pasta "1 ATIVOS AE" vem de `process.argv[2]`, senão de `DRIVE_ATIVOS_FOLDER_ID`, senão do padrão `1mD-icXalCyRuVp8_gcNEh3ifSF8eusHM`.
3. **Listagem em Drive compartilhado com paginação:** toda chamada `files.list` usa `includeItemsFromAllDrives: true`, `supportsAllDrives: true`, `pageSize: 1000`, `fields: "nextPageToken, files(id, name, mimeType, webViewLink, createdTime)"` e loop de `pageToken` até esgotar. Primeira listagem: subpastas diretas da raiz (`q: "'<id>' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"`) — retorna as 64 pastas de cliente.
4. **Casamento pasta↔cliente (mesma estratégia de `scripts/import-briefing.mjs:59-79`):** nome da pasta normalizado (mesma `normalize` do sync, cópia de `app/api/calendar/sync/route.ts:9-11`) contra `company` e `name` normalizados de todos os mentees (`select id, name, company from public.mentees`, sem filtro de status). Exato primeiro (pasta = company ou pasta = name); zero exatos → continência parcial nos dois sentidos (pasta ⊆ campo ou campo ⊆ pasta, campos não vazios). Resultado com exatamente 1 mentee distinto → casada. 0 → "sem correspondência" no relatório, nada importado dela. 2+ mentees distintos → "ambígua" no relatório, nada importado dela.
5. **Visão inversa:** mentees cadastrados que não receberam nenhuma pasta são listados no relatório ("clientes sem pasta") para detectar erros de grafia.
6. **Subpasta de gravações:** dentro de cada pasta casada, listar subpastas e escolher a primeira cujo nome normalizado contém `"grava"` (cobre "1_GRAVAÇÕES", "01_GRAVAÇÕES" e variações — a normalização remove acentos). Pasta de cliente sem essa subpasta (1 caso conhecido em 64) → relatório "sem subpasta de gravações", segue para a próxima.
7. **Classificação de arquivos:** dentro da subpasta de gravações (com paginação): `mimeType` começando com `video/` → gravação (`type = 'recording'`); `mimeType = 'application/vnd.google-apps.document'` OU `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) com nome normalizado contendo `"anotacoes do gemini"` → resumo (`type = 'summary'`); qualquer outro arquivo → ignorado e contabilizado no relatório.
8. **Extração de data/hora tolerante às duas grafias:** regex única cobre "… - 2026/05/20 16:46 GMT-03:00 - Recording" e "… - 2026_03_05 15_32 GMT-03_00 - Recording.mp4": `/(\d{4})[\/_](\d{2})[\/_](\d{2})\s+(\d{2})[:_](\d{2})\s*GMT([+-]\d{2})[:_](\d{2})/`. `happened_at` construído respeitando o offset do nome (`AAAA-MM-DDTHH:MM:00±HH:MM`). Nome sem data extraível → fallback para `createdTime` do arquivo no Drive e entrada no relatório "data não extraída do nome" (arquivo + cliente).
9. **Gravação idempotente:** upsert em `public.mentee_materials` por `drive_file_id` (`on conflict (drive_file_id) do update set mentee_id, meeting_id, type, title, drive_url, happened_at = excluded.…`), com `drive_url = webViewLink`, `title = nome do arquivo` e o enum da migration 202607030002 (`type`, valores `recording`/`summary`). Reexecutar o script não duplica nada; alterações no Drive (renome, mudança de pasta) atualizam o registro existente.
10. **Casamento material↔encontro:** candidatos = encontros com `type = 'individual'` e `individual_mentee_id` = cliente da pasta (carregados uma vez, `select id, individual_mentee_id, starts_at, ends_at from public.meetings where type = 'individual' and individual_mentee_id is not null`, agrupados em memória por mentee) cuja janela `[starts_at − 15min, ends_at + 15min]` contém `happened_at`. Exatamente 1 candidato → `meeting_id` preenchido. 0 ou 2+ (inclui cópias do mesmo encontro vindas de calendários de mentores diferentes) → `meeting_id = null` e entrada no relatório "sem encontro casado" (arquivo + cliente). Vários materiais podem apontar para o mesmo encontro (gravação + resumo).
11. **Transação única:** coleta do Drive fora da transação; todas as escritas entre `begin` e `commit`. Falha em qualquer ponto → `rollback`, `console.error` e `process.exitCode = 1` (padrão de `scripts/import-briefing.mjs:99-105`) — nenhuma importação parcial.
12. **Relatório final completo:** pastas casadas (total), sem correspondência (nomes), ambíguas (nomes), clientes sem pasta (nomes), pastas casadas sem subpasta de gravações (nomes), gravações registradas (total), resumos registrados (total), arquivos ignorados (total), datas de fallback (arquivo + cliente) e materiais sem encontro casado (arquivo + cliente).

## Arquivos

### Criar
- **`scripts/import-drive-materials.mjs`** — script completo, nesta estrutura:
  - Cabeçalho: comentário de execução única; auth/chave privada no padrão de `scripts/backfill-calendar.mjs`; matching/relatório no espírito de `scripts/import-briefing.mjs`; `normalize` cópia de `app/api/calendar/sync/route.ts:9-11`.
  - `process.loadEnvFile(".env.local")`; validação de `DATABASE_URL`, `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` e do subject resolvido (`GOOGLE_DRIVE_SUBJECT` → fallback primeiro de `GOOGLE_WORKSPACE_SUBJECTS`/`GOOGLE_WORKSPACE_SUBJECT`); id da pasta raiz por `argv[2]` → `DRIVE_ATIVOS_FOLDER_ID` → padrão.
  - JWT único (`google.auth.JWT` com `scopes: ["https://www.googleapis.com/auth/drive"]`) + `google.drive({ version: "v3", auth })`; helper `listAll(q)` paginado com os parâmetros de shared drive do cenário 3.
  - Coleta completa do Drive em memória (pastas de cliente → matching → subpasta de gravações → arquivos classificados + data extraída) ANTES da transação.
  - Conexão `pg` (mesmas opções de `ssl`/`connectionTimeoutMillis` dos scripts existentes); queries de mentees e de meetings individuais; `begin` → loop de upserts em `mentee_materials` → `commit`; relatório; `catch` com `rollback` + `process.exitCode = 1`; `finally` com `end()`.
  - Execução: `node scripts/import-drive-materials.mjs [folderId]` (sem entrada em `package.json`, como os demais).

### Modificar
- Nenhum.

### Não tocar
`scripts/backfill-calendar.mjs`, `scripts/import-briefing.mjs`, `scripts/sync-google-calendar.mjs`, `app/api/calendar/sync/route.ts`, `lib/google-calendar.ts`, `lib/supabase/**`, `supabase/migrations/**`, `package.json`.

## Checklist

- [x] `scripts/import-drive-materials.mjs` criado no padrão dos scripts existentes (`.mjs`, `process.loadEnvFile(".env.local")`, `pg` via `DATABASE_URL`, transação com rollback, relatório no console)
- [x] Auth JWT delegada com escopo exatamente `https://www.googleapis.com/auth/drive` e subject configurável (`GOOGLE_DRIVE_SUBJECT` com fallback para os subjects do Calendar); tratamento da chave privada idêntico ao de `backfill-calendar.mjs`
- [x] Pasta raiz parametrizável (argv → `DRIVE_ATIVOS_FOLDER_ID` → `1mD-icXalCyRuVp8_gcNEh3ifSF8eusHM`)
- [x] Todas as `files.list` com `includeItemsFromAllDrives`/`supportsAllDrives` e paginação por `pageToken` até esgotar
- [x] Matching pasta↔cliente com a `normalize` do sync contra `company` e `name` (exato → continência parcial); ambíguas e sem correspondência vão ao relatório sem importar nada
- [x] Subpasta de gravações localizada por nome normalizado contendo "grava"; cliente sem ela vai ao relatório
- [x] Classificação: `video/*` → recording; Google Doc ou `.docx` com "anotações do gemini" (normalizado) → summary; resto ignorado e contado
- [x] Regex de data tolerante a `/`+`:` e `_` nas duas posições, respeitando o offset GMT do nome; sem data → fallback `createdTime` + relatório
- [x] Upsert por `drive_file_id` em `public.mentee_materials` (colunas `mentee_id`, `meeting_id`, `type`, `title`, `drive_file_id`, `drive_url` = `webViewLink`, `happened_at`) — reexecução não duplica
- [x] Casamento material↔encontro: individuais do cliente com janela `[starts_at − 15min, ends_at + 15min]` contendo `happened_at`; só candidato único vincula; 0 ou 2+ → `meeting_id` nulo + relatório
- [x] Escritas em transação única: falha → rollback total + `process.exitCode = 1`
- [x] Relatório imprime: pastas casadas / sem correspondência / ambíguas, clientes sem pasta, pastas sem subpasta de gravações, totais de gravações e resumos, ignorados, datas de fallback e materiais sem encontro casado (com arquivo e cliente)
- [x] Nenhum arquivo além de `scripts/import-drive-materials.mjs` criado/modificado
- [x] Verificação: `node --check scripts/import-drive-materials.mjs` passa; execução real só com issues 19 e 22 já aplicadas em produção
