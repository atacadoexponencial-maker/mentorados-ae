# 14: Fundação de Dados — Frente do Mentor, Origem do Vínculo e Carga Inicial

**Tipo:** Implementação
**Página:** Módulo A / Módulo B (base para tudo)

## Descrição
Criar a estrutura de dados da feature: coluna de frente de atuação no mentor (restrita às quatro frentes existentes — Tráfego, Redes sociais, Comercial, Estratégia — e opcional, podendo ficar vazia) e marcação de origem do vínculo mentor↔encontro no encontro (automático ou manual). Inclui a carga inicial (migration/seed) das frentes dos quatro mentores atuais: Marcelle Mesquita → Tráfego; Day Maciel → Redes sociais; Bárbara Lazzari → Comercial; Felipe Santos → Estratégia.

## Decisões de Design

- **Reutilizar o enum `public.meeting_front`** (criado em `202606300004_meeting_front.sql`, valores `'trafego' | 'redes_sociais' | 'comercial' | 'estrategia'`) para a coluna `mentors.front`. As frentes do mentor são exatamente as mesmas dos encontros — criar um segundo enum duplicaria a fonte de verdade.
- **Sem constraint de unicidade em `mentors.front`.** A spec (Módulo A) diz que, havendo mais de um mentor na mesma frente, o sistema apenas **não atribui automaticamente** — ou seja, duplicidade é permitida no dado; a ambiguidade é tratada na lógica do sync (issue 15), não no banco.
- **Origem do vínculo como enum novo `public.mentor_link_source`** (`'auto' | 'manual'`) na coluna `meeting_mentors.source`, `not null default 'auto'`. Default `'auto'` porque o escritor primário da tabela é o sync; a rota de edição manual (issue 16) gravará `'manual'` explicitamente. As linhas existentes (se houver) nunca foram corrigidas manualmente, então `'auto'` é o backfill correto.
- **Carga inicial dentro da própria migration**, via `update ... where email = ...` (e-mail é `unique` em `mentors`), para valer em produção quando `npm run db:migrate` rodar — mesmo padrão do backfill feito em `202606300004_meeting_front.sql`.

## Cenários

### Happy Path
1. Desenvolvedor roda `npm run db:migrate` (scripts/migrate.mjs lê `DATABASE_URL` de `.env.local` e aplica as migrations pendentes em transação única).
2. A migration `202607030001_mentor_front_and_link_source.sql` é aplicada: `mentors` ganha a coluna `front` (nullable), `meeting_mentors` ganha a coluna `source` (`not null default 'auto'`) e o enum `mentor_link_source` passa a existir.
3. A carga inicial atualiza os 4 mentores por e-mail: `marcelle@seteads.com` → `'trafego'`, `day@seteads.com` → `'redes_sociais'`, `barbara@seteads.com` → `'comercial'`, `felipe@seteads.com` → `'estrategia'`.
4. `lib/supabase/database.types.ts` reflete as duas colunas novas e o enum novo; `npx tsc --noEmit` passa sem erros.

### Edge Cases
- **Mentor sem frente:** coluna `front` é nullable — mentor novo criado sem frente fica `null` e nunca recebe atribuição automática (comportamento definido na issue 15).
- **E-mail da carga inicial não existe no banco:** o `update` afeta 0 linhas e a migration segue sem erro (comportamento aceitável — em bancos vazios de dev não há mentores para semear).
- **Linhas pré-existentes em `meeting_mentors`:** recebem `source = 'auto'` pelo default no `alter table` — correto, pois nenhum vínculo atual foi definido manualmente.
- **Re-execução do `db:migrate`:** `scripts/migrate.mjs` registra o id em `app_private.schema_migrations` e pula migrations já aplicadas — a carga inicial não roda duas vezes.
- **Dois mentores na mesma frente:** permitido no banco (sem unique); o guard fica na lógica de atribuição do sync (issue 15).
- **`lib/supabase/data.ts` faz `select("*")` em `meeting_mentors`:** a coluna nova entra automaticamente no retorno; apenas o tipo `Row` precisa ser atualizado — nenhuma query muda.

### Cenário de Erro
- **`DATABASE_URL` ausente em `.env.local`:** `scripts/migrate.mjs` lança "DATABASE_URL não configurada em .env.local" e nada é aplicado.
- **Falha no meio da migration** (ex.: enum já existente por aplicação manual anterior): o script executa tudo em uma transação e faz `rollback` — o banco não fica em estado parcial e o id não é registrado em `schema_migrations`.
- **Valor de frente inválido** (fora das quatro frentes): rejeitado pelo próprio Postgres, pois a coluna usa o enum `meeting_front` — não existe caminho para gravar frente inválida.

## Banco de Dados

- Tipo: `public.mentor_link_source` (enum) — **novo**
  - Valores: `'auto'`, `'manual'` — origem do vínculo mentor↔encontro.
- Tabela: `mentors` — **alterada**
  - `front` (`public.meeting_front`, nullable) — frente de atuação permanente do mentor; `null` = sem frente definida (nunca recebe atribuição automática).
- Tabela: `meeting_mentors` — **alterada**
  - `source` (`public.mentor_link_source`, `not null default 'auto'`) — `'auto'` quando o vínculo foi criado/atualizado pelo sync; `'manual'` quando definido pela equipe (o sync nunca sobrescreve vínculo `'manual'`).
- Carga inicial (na mesma migration, `update` por e-mail — coluna `email` é `unique`):
  - `marcelle@seteads.com` → `front = 'trafego'`
  - `day@seteads.com` → `front = 'redes_sociais'`
  - `barbara@seteads.com` → `front = 'comercial'`
  - `felipe@seteads.com` → `front = 'estrategia'`

## Arquivos

- **Criar:** `supabase/migrations/202607030001_mentor_front_and_link_source.sql` — cria o enum `public.mentor_link_source`; adiciona `mentors.front public.meeting_front` (nullable); adiciona `meeting_mentors.source public.mentor_link_source not null default 'auto'`; executa a carga inicial das frentes dos 4 mentores por e-mail. Segue o estilo das migrations existentes (comentário de contexto no topo, `public.` explícito, sem `IF NOT EXISTS` — o migrate.mjs controla aplicação única).
- **Modificar:** `lib/supabase/database.types.ts` — (1) `MentorRow`: adicionar `front: "trafego" | "redes_sociais" | "comercial" | "estrategia" | null`; (2) `meeting_mentors`: `Row` ganha `source: "auto" | "manual"` e `Insert` ganha `source?: "auto" | "manual"` (opcional, pois há default no banco); (3) `Enums`: adicionar `mentor_link_source: "auto" | "manual"`.

Nenhum outro arquivo é tocado nesta issue — rotas de sync, edição de vínculo e UI ficam nas issues 15, 16 e 17.

## Checklist

- [x] Criar `supabase/migrations/202607030001_mentor_front_and_link_source.sql` com: enum `mentor_link_source`, coluna `mentors.front` (nullable, tipo `meeting_front`), coluna `meeting_mentors.source` (`not null default 'auto'`)
- [x] Incluir na migration a carga inicial das frentes dos 4 mentores via `update public.mentors set front = ... where email = ...`
- [x] Atualizar `MentorRow` em `lib/supabase/database.types.ts` com `front` nullable
- [x] Atualizar `meeting_mentors` (`Row` e `Insert`) em `lib/supabase/database.types.ts` com `source`
- [x] Adicionar `mentor_link_source` ao bloco `Enums` de `lib/supabase/database.types.ts`
- [ ] Rodar `npm run db:migrate` e confirmar "1 migration(s) aplicada(s) com sucesso." *(não executado — aplicação contra o banco é passo do deploy)*
- [ ] Verificar no banco: `select name, email, front from mentors` retorna as 4 frentes corretas e `select distinct source from meeting_mentors` retorna apenas `'auto'` *(depende do db:migrate no deploy)*
- [x] Rodar `npx tsc --noEmit` sem erros
