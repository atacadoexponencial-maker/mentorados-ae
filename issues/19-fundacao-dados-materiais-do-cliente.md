# 19: Fundação de Dados — Tabela de Materiais do Cliente

**Tipo:** Implementação
**Página:** Módulo A — Armazenamento de Materiais do Cliente

## Descrição
Criar a migration da tabela de materiais (gravações e resumos do Drive) e refletir os tipos em `lib/supabase/database.types.ts`. Cada material pertence a exatamente um cliente (obrigatório, remoção em cascata), pode ter um encontro vinculado (opcional, desvincula sem excluir quando o encontro é removido), tem tipo restrito a gravação/resumo, id do arquivo no Drive único (reimportações atualizam em vez de duplicar), título, link de visualização e data/hora da reunião, com índice por cliente ordenado por data e a mesma política de acesso das demais tabelas do MVP (equipe autenticada lê; escrita só via script com conexão direta).

## Cenários

### Happy Path
- Um insert com `mentee_id` de cliente existente, `type = 'recording'`, `title`, `drive_file_id` inédito, `drive_url` e `happened_at` cria o material; `id`, `created_at` e `updated_at` são preenchidos por default.
- Um material pode ser criado com `meeting_id` de um encontro existente (gravação casada com o encontro) ou com `meeting_id` nulo (material avulso) — ambos válidos.
- Upsert por `drive_file_id` (`on conflict (drive_file_id) do update`, como o Módulo D fará) atualiza o registro existente em vez de criar outro; o trigger `set_updated_at` renova `updated_at`.
- Consulta "materiais do cliente X ordenados por data desc" (padrão da aba Histórico) usa o índice `mentee_materials_mentee_date_idx`.
- Usuário autenticado da equipe lê e escreve via policy "team access" (o script de import usa conexão direta `DATABASE_URL`, que ignora RLS).

### Edge Cases
- Excluir o cliente (`delete from mentees`) remove todos os seus materiais em cascata.
- Excluir o encontro vinculado (`delete from meetings`) apenas anula `meeting_id` do material; o material permanece.
- Vários materiais podem apontar para o mesmo `meeting_id` (gravação + resumo, ou duas gravações da mesma reunião) — sem constraint de unicidade em `meeting_id`.
- Dois materiais com mesmo título/data mas `drive_file_id` diferentes são registros distintos (unicidade é só pelo id do Drive).

### Cenário de Erro
- Insert sem `mentee_id`, ou com `mentee_id` inexistente, falha (not null + FK).
- Insert com `drive_file_id` duplicado sem cláusula de upsert falha com violação de unique.
- Insert com `type` fora de `recording`/`summary` falha (enum `material_type`).
- Cliente `anon` (não autenticado) não lê nem escreve — RLS habilitado sem policy para `anon`.

## Banco de Dados

Migration `supabase/migrations/202607030002_mentee_materials.sql`, no estilo das existentes (comentário de cabeçalho, enum em `public`, trigger `set_updated_at` já existente, RLS + policy "team access"):

```sql
create type public.material_type as enum ('recording', 'summary');

create table public.mentee_materials (
  id uuid primary key default gen_random_uuid(),
  mentee_id uuid not null references public.mentees(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete set null,
  type public.material_type not null,
  title text not null,
  drive_file_id text not null unique,
  drive_url text not null,
  happened_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mentee_materials_mentee_date_idx
  on public.mentee_materials(mentee_id, happened_at desc);

create trigger mentee_materials_updated_at before update on public.mentee_materials
for each row execute function public.set_updated_at();

alter table public.mentee_materials enable row level security;
create policy "team access mentee materials" on public.mentee_materials for all to authenticated
using (true) with check (true);
```

Notas:
- `happened_at` = data/hora da reunião extraída do nome do arquivo (o índice por cliente ordena por ela, não por `created_at`).
- Sem índice extra em `meeting_id`: a aba Histórico consulta por cliente; o casamento material↔encontro no Módulo D acontece em memória no script.
- Nenhuma alteração em tabelas existentes.

## Arquivos

### Criar
- `supabase/migrations/202607030002_mentee_materials.sql` — enum `material_type`, tabela `mentee_materials`, índice, trigger, RLS + policy (SQL acima).

### Modificar
- `lib/supabase/database.types.ts` —
  - adicionar em `Database.public.Tables` a entrada `mentee_materials` seguindo o padrão das demais: `{ Row: MaterialRow; Insert: Omit<MaterialRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<...["Insert"]>; Relationships: [] }`;
  - adicionar `material_type: "recording" | "summary"` em `Enums`;
  - adicionar `export interface MaterialRow { id: string; mentee_id: string; meeting_id: string | null; type: "recording" | "summary"; title: string; drive_file_id: string; drive_url: string; happened_at: string; created_at: string; updated_at: string }`.

Nenhum outro arquivo é tocado (as consultas em `lib/supabase/data.ts` e o script de import são das issues dos Módulos D e E).

## Checklist
- [x] Migration `202607030002_mentee_materials.sql` criada com enum, tabela, índice `(mentee_id, happened_at desc)`, trigger `updated_at`, RLS e policy "team access"
- [x] FK `mentee_id` not null com `on delete cascade`; FK `meeting_id` nullable com `on delete set null`
- [x] `drive_file_id` com constraint `unique` (base do upsert idempotente do Módulo D)
- [ ] `npm run db:migrate` aplica a migration sem erro (não executado — aplicação da migration é passo de deploy)
- [x] `database.types.ts` atualizado (Tables + Enums + `MaterialRow`) e `npx tsc --noEmit` passa
- [x] Nenhum arquivo além dos dois listados foi modificado
