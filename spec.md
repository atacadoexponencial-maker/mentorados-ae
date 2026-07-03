# Spec: Apelidos de Marca no Cadastro do Cliente

## Visão Geral

O casamento automático evento↔cliente (sync do Calendar) e pasta↔cliente (importação do Drive) depende do nome exato da marca (`company`) ou do nome da pessoa (`name`). Quando o time escreve a marca de outro jeito, o casamento falha silenciosamente:

- Cliente cadastrada como **"Lady Mega Hair"**, mas os títulos dos eventos dizem **"Lady Hair"** → os encontros não entram no sync nem no backfill.
- Pasta do Drive **"Barraca do Wilinha"** vs cliente cadastrado como **"Barraca do Willinha"** (grafia) → a pasta não casa e os materiais não são importados.

A solução é permitir que cada cliente tenha uma **lista de apelidos de marca** — nomes alternativos que todos os pontos de matching tratam **exatamente como se fossem a marca**: identificador forte, normalizado (`normalized` de `app/api/calendar/sync/route.ts:9-11`), mínimo de 4 caracteres, contido no texto do evento (ou comparado ao nome da pasta). Como a marca, apelido **não** recebe a guarda de data de entrada que existe para nome de pessoa no backfill (`scripts/backfill-calendar.mjs:166-173`) — marca e apelido valem para qualquer época.

**Atores:**
- **Equipe (interna):** cadastra e edita os apelidos na ficha do cliente (drawer), na mesma edição já existente de Instagram/Pasta.
- **Sistema (sync da agenda):** passa a casar eventos também pelos apelidos, automaticamente, sem ação da equipe.
- **Operador (dev/gestão):** ao reexecutar os scripts de backfill/importação do Drive, os apelidos já valem.

**Problemas que resolve:**
- (a) encontros da "Lady Hair" passam a casar com a cliente "Lady Mega Hair" no sync e no backfill;
- (b) a pasta "Barraca do Wilinha" passa a casar com o cliente "Barraca do Willinha" na importação do Drive;
- (c) qualquer variação futura de grafia/nome de marca vira um cadastro simples na ficha, sem mexer em código.

**Fora do escopo:** apelidos de nome de pessoa; sugestão automática de apelidos a partir de eventos não casados; interface para revisar eventos "sem correspondência"; reexecução dos scripts (a feature apenas os prepara para quando forem reexecutados); casamento no `scripts/import-briefing.mjs` (fluxo de importação já concluído).

---

## Páginas / Módulos

### Módulo A — Armazenamento dos Apelidos (base de dados)

**Descrição:** Coluna nova na tabela `mentees` com a lista de apelidos de marca, via migration no padrão de `supabase/migrations/` (próximo número da sequência `2026MMDDNNNN_*.sql`). A migration também faz a carga inicial dos dois casos reais conhecidos.

**Componentes:**
- Coluna `brand_aliases` em `public.mentees`: lista de textos (`text[]`), obrigatória com padrão lista vazia (`not null default '{}'`) — nenhum cliente existente fica com valor nulo.
- Carga inicial (no corpo da mesma migration):
  - `array['Lady Hair']` para a cliente de e-mail `soniaalbuquerquebadu@gmail.com`;
  - `array['Barraca do Wilinha']` para o cliente cuja `company` é `Barraca do Willinha` — se existir (o `update` com `where` é naturalmente inócuo se não houver linha).
- Tipos do app: `brand_aliases: string[]` em `MenteeRow` (`lib/supabase/database.types.ts:24`) e `brandAliases: string[]` em `Mentee` (`lib/types.ts:14-32`), mapeado em `mapMentee` (`lib/supabase/data.ts:20-40`).

**Comportamentos:**
- Todo cliente novo nasce com lista de apelidos vazia, sem exigir nada no cadastro (`createMentee` não muda).
- Após a migration, a cliente da Lady Mega Hair (e-mail `soniaalbuquerquebadu@gmail.com`) tem o apelido "Lady Hair".
- Após a migration, o cliente de `company` "Barraca do Willinha", se existir, tem o apelido "Barraca do Wilinha".
- Reaplicar a migration em base já migrada não é requisito (padrão do projeto: migrations rodam uma vez, em sequência).

### Módulo B — Matching por Apelido (sync, backfill e importação do Drive)

**Descrição:** Os três pontos de matching passam a considerar cada apelido exatamente como consideram a marca (`company`). A regra é uma só, replicada nos três lugares como o projeto já faz com `normalized`/`normalize` (cópias documentadas em comentário — `scripts/backfill-calendar.mjs:8-12`, `scripts/import-drive-materials.mjs:8-11`).

**Componentes:**
- **Sync do Calendar** — `app/api/calendar/sync/route.ts`, função `runCalendarSync`: consulta de mentees (linha 22) passa a trazer `brand_aliases`; o filtro de matches (linhas 31-36) ganha o critério de apelido ao lado do de `company`.
- **Backfill do Calendar** — `scripts/backfill-calendar.mjs`: consulta de mentees (linha 147) passa a trazer `brand_aliases`; o filtro (linhas 161-174) ganha o critério de apelido como identificador forte, junto de e-mail e marca.
- **Importação do Drive** — `scripts/import-drive-materials.mjs`: consulta de mentees (linha 82) passa a trazer `brand_aliases`; o matching pasta↔cliente (linhas 105-123) considera os apelidos ao lado de `company` e `name` nas duas etapas (exato primeiro, depois continência parcial nos dois sentidos).

**Comportamentos:**
- No sync, um evento casa com o cliente quando algum apelido normalizado tem 4+ caracteres e está contido no texto normalizado de título+descrição do evento — mesma regra da marca (`route.ts:35`).
- No backfill, o mesmo critério de apelido vale **sem** a guarda de data de entrada (`joinedCutoff`), que continua se aplicando apenas ao nome de pessoa — apelido é identificador forte como e-mail e marca (`backfill-calendar.mjs:166-173`).
- Na importação do Drive, a pasta casa com o cliente quando o nome normalizado da pasta é igual a um apelido normalizado (etapa exata) ou quando há continência parcial em qualquer sentido entre pasta e apelido (etapa parcial) — mesmas etapas já aplicadas a `company` e `name`.
- Apelido com menos de 4 caracteres após normalização nunca casa por continência em texto de evento (mesma proteção da marca contra falsos positivos).
- Apelidos vazios ou lista vazia não alteram nenhum resultado de matching (comportamento atual preservado).
- Um evento que case com dois clientes distintos (ex.: apelido de um contém a marca de outro) continua caindo na regra existente de ambiguidade: só casa quando há exatamente 1 cliente (`route.ts:39`, `backfill-calendar.mjs:178`, `import-drive-materials.mjs:120-122`).
- Nenhuma outra regra muda: ignore/grupo por título, classificação de frente, upserts, vínculo de mentor e limpeza permanecem intocados.

### Módulo C — Ficha do Cliente: Apelidos na Seção "CONTATO E MATERIAIS"

**Descrição:** No drawer da ficha (`MenteeDrawer` em `components/mentoria-app.tsx:339-373`), a seção "CONTATO E MATERIAIS" (linha 366) já tem modo de edição para Instagram e Pasta, persistindo via `updateMenteeContact` (`lib/supabase/data.ts:398-405`). Adicionar o campo "Apelidos de marca" nessa mesma edição, com exibição na visão de leitura quando existirem apelidos. Thin client: a tela só captura e exibe; nenhuma lógica de matching no frontend.

**Componentes:**
- Campo de edição "Apelidos de marca": input de texto único com os apelidos separados por vírgula (placeholder ex.: `Lady Hair, LMH`), ao lado dos campos Instagram e Pasta no `risk-form` da seção (padrão dos estados `instagram`/`folder`, linhas 345-347).
- Exibição na leitura: dentro do `resource-grid` existente, bloco `APELIDOS DE MARCA` com os apelidos separados por vírgula — exibido apenas quando a lista não está vazia (padrão condicional dos links de Instagram/Pasta).
- Persistência: `updateMenteeContact` (`lib/supabase/data.ts:398-405`) passa a gravar também `brand_aliases` a partir de `input.brandAliases`, no mesmo `update` de `instagram_url`/`folder_url`.

**Comportamentos:**
- Ao abrir a edição, o campo mostra os apelidos atuais do cliente unidos por vírgula (`", "`); lista vazia mostra campo vazio.
- Ao salvar, o texto vira lista: separa por vírgula, apara espaços de cada item e descarta itens vazios — `"Lady Hair, , LMH "` persiste como `["Lady Hair", "LMH"]`.
- Salvar com o campo vazio persiste lista vazia (remove todos os apelidos).
- Salvar segue o fluxo existente do botão da seção: chama `updateContact` com o mentee atualizado (agora incluindo `brandAliases`) e fecha o modo de edição; Instagram e Pasta continuam salvando juntos, como hoje.
- Cancelar restaura o valor original dos três campos e fecha a edição (padrão existente da linha 366).
- Na leitura, cliente sem apelidos não exibe o bloco "APELIDOS DE MARCA" (nada muda visualmente para quem não usa a feature).
- Depois de salvar, a ficha reflete os apelidos imediatamente (o `updateContact` existente já substitui o mentee no estado do app com a linha retornada pelo banco).
