# 26: Fundação de Dados — Coluna de Apelidos de Marca

**Tipo:** Implementação
**Página:** Módulo A — Armazenamento dos Apelidos (base de dados)

## Descrição
Criar a migration que adiciona a coluna `brand_aliases text[] not null default '{}'` em `public.mentees`, com carga inicial dos dois casos reais conhecidos no corpo da mesma migration, e refletir a coluna nos tipos do app (`MenteeRow.brand_aliases` e `Mentee.brandAliases`, mapeados em `mapMentee`).

## Cenários

### Happy Path
- Após a migration, todo cliente existente tem `brand_aliases = '{}'` (lista vazia, nunca nulo).
- A cliente de e-mail `soniaalbuquerquebadu@gmail.com` fica com `brand_aliases = array['Lady Hair']`.
- O cliente cuja `company` é `Barraca do Willinha` fica com `brand_aliases = array['Barraca do Wilinha']`.
- Cliente novo criado sem informar apelidos nasce com lista vazia — o default da coluna cobre o insert existente (`createMentee` não muda).
- `mapMentee` passa a expor `brandAliases: string[]` a partir de `row.brand_aliases`.

### Edge Cases
- Se não existir cliente com `company = 'Barraca do Willinha'`, o `update` com `where` não afeta linha alguma e a migration segue sem erro.
- Se não existir cliente com o e-mail da Lady Mega Hair, idem — carga inicial é inócua.
- Reaplicar a migration em base já migrada não é requisito (padrão do projeto: migrations rodam uma vez, em sequência).

### Cenário de Erro
- Insert manual com `brand_aliases = null` falha (constraint `not null`).

## Banco de Dados

Migration `supabase/migrations/202607030003_mentee_brand_aliases.sql` (próximo número da sequência), no estilo das existentes (comentário de cabeçalho):

```sql
alter table public.mentees
  add column brand_aliases text[] not null default '{}';

-- Carga inicial dos casos reais conhecidos
update public.mentees
  set brand_aliases = array['Lady Hair']
  where lower(email) = 'soniaalbuquerquebadu@gmail.com';

update public.mentees
  set brand_aliases = array['Barraca do Wilinha']
  where company = 'Barraca do Willinha';
```

Notas:
- Sem tabela nova, sem índice, sem mudança de RLS — a coluna herda as policies existentes de `mentees`.
- Nenhuma outra tabela é alterada.

## Arquivos

### Criar
- `supabase/migrations/202607030003_mentee_brand_aliases.sql` — coluna `brand_aliases` + carga inicial (SQL acima).

### Modificar
- `lib/supabase/database.types.ts` — adicionar `brand_aliases: string[]` em `MenteeRow` (linha 24).
- `lib/types.ts` — adicionar `brandAliases: string[]` em `Mentee` (linhas 14-32).
- `lib/supabase/data.ts` — mapear `brandAliases: row.brand_aliases` em `mapMentee` (linhas 20-40).

Nenhum outro arquivo é tocado (matching é a issue 27; UI e persistência são a issue 28).

## Checklist
- [x] Migration `202607030003_mentee_brand_aliases.sql` criada com coluna `text[] not null default '{}'` e os dois `update` de carga inicial
- [ ] `npm run db:migrate` aplica a migration sem erro (aplicação em produção é passo de deploy)
- [ ] `MenteeRow`, `Mentee` e `mapMentee` atualizados e `npx tsc --noEmit` passa
- [x] `createMentee` e demais escritas de mentees permanecem intocadas
- [x] Nenhum arquivo além dos quatro listados foi modificado
