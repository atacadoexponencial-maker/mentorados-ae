# 27: Matching por Apelido no Sync e nos Scripts

**Tipo:** Implementação
**Página:** Módulo B — Matching por Apelido (sync, backfill e importação do Drive)

## Descrição
Fazer os três pontos de matching evento/pasta↔cliente considerarem cada apelido de `brand_aliases` exatamente como consideram a marca (`company`): sync do Calendar (`app/api/calendar/sync/route.ts`), backfill (`scripts/backfill-calendar.mjs`) e importação do Drive (`scripts/import-drive-materials.mjs`). Regra única replicada nos três lugares, como o projeto já faz com `normalized`/`normalize` (cópias documentadas em comentário).

## Cenários

### Happy Path
- **Sync** (`runCalendarSync`): a consulta de mentees (route.ts:22) passa a trazer `brand_aliases`; no filtro de matches (route.ts:31-36), um evento casa quando algum apelido normalizado tem 4+ caracteres e está contido no texto normalizado de título+descrição — mesma regra da marca (route.ts:35). Ex.: evento "Lady Hair | Mentoria" casa com a cliente de apelido "Lady Hair".
- **Backfill** (`scripts/backfill-calendar.mjs`): a consulta de mentees (linha 147) passa a trazer `brand_aliases`; no filtro (linhas 161-174), apelido entra como identificador forte junto de e-mail e marca — **sem** a guarda de data de entrada (`joinedCutoff`), que continua se aplicando apenas ao nome de pessoa. Evento de 2023 casa por apelido mesmo que o cliente tenha `joined_at` em 2025.
- **Importação do Drive** (`scripts/import-drive-materials.mjs`): a consulta de mentees (linha 82) passa a trazer `brand_aliases`; o matching pasta↔cliente (linhas 105-123) considera apelidos ao lado de `company` e `name` nas duas etapas — igualdade exata primeiro, depois continência parcial nos dois sentidos. Pasta "Barraca do Wilinha" casa com o cliente de apelido "Barraca do Wilinha".

### Edge Cases
- Apelido com menos de 4 caracteres após normalização nunca casa por continência em texto de evento (mesma proteção da marca contra falsos positivos, nos dois pontos de Calendar).
- Apelidos vazios ou lista vazia não alteram nenhum resultado de matching — clientes sem apelido se comportam exatamente como hoje.
- Evento que casa com dois clientes distintos (ex.: apelido de um contém a marca de outro) cai na regra existente de ambiguidade: só casa quando há exatamente 1 cliente (route.ts:39, backfill-calendar.mjs:178, import-drive-materials.mjs:120-122). No import do Drive, o mesmo cliente casando por marca e por apelido não é ambíguo (deduplicação por `distinctIds` já existente).
- Cliente que casa simultaneamente por marca e por apelido casa uma vez só (o `filter` retorna o mentee uma única vez).

### Cenário de Erro
- Não há novos estados de erro: comportamento em falha de conexão/transação permanece o atual dos três pontos.

## Regra (idêntica nos três lugares)

Ao lado do critério de `company`, para cada apelido de `mentee.brand_aliases`:
- **Calendar (sync e backfill):** `aliasMatch = brand_aliases.some((alias) => { const a = normalize(alias); return a.length >= 4 && eventText.includes(a); })` — sem `joinedCutoff`.
- **Drive (etapa exata):** `folderKey === normalize(alias)`.
- **Drive (etapa parcial):** `a && (a.includes(folderKey) || folderKey.includes(a))`.

Nenhuma outra regra muda: ignore/grupo por título, classificação de frente, upserts, vínculo de mentor, limpeza, contadores e relatórios permanecem intocados.

## Arquivos

### Modificar
- `app/api/calendar/sync/route.ts` — `select` de mentees (linha 22) inclui `brand_aliases`; filtro de matches (linhas 31-36) ganha o critério de apelido.
- `scripts/backfill-calendar.mjs` — `select` de mentees (linha 147) inclui `brand_aliases`; filtro (linhas 161-174) ganha o critério de apelido como identificador forte (fora da guarda `joinedCutoff`); atualizar o comentário de cópia fiel se necessário.
- `scripts/import-drive-materials.mjs` — `select` de mentees (linha 82) inclui `brand_aliases`; matching pasta↔cliente (linhas 105-123) considera apelidos nas etapas exata e parcial.

Nenhum arquivo criado. `scripts/import-briefing.mjs` fica fora do escopo (fluxo já concluído). Reexecução dos scripts não faz parte da issue — ela apenas os prepara.

## Checklist
- [x] Sync: consulta traz `brand_aliases` e o filtro casa por apelido normalizado com 4+ caracteres contido no texto do evento
- [x] Backfill: mesmo critério de apelido, sem `joinedCutoff` (guarda continua só no nome de pessoa)
- [x] Import do Drive: apelido participa da etapa exata e da etapa de continência parcial nos dois sentidos
- [x] Regra de ambiguidade preservada nos três pontos (só casa com exatamente 1 cliente)
- [x] Lista vazia de apelidos não muda nenhum resultado atual de matching
- [x] Ignore/grupo, frente, upserts, mentor auto e limpeza intocados; `npx tsc --noEmit` passa
- [x] Nenhum arquivo além dos três listados foi modificado
