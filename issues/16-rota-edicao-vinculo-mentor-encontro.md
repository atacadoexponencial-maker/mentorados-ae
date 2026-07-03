# 16: Rota Backend de Edição do Vínculo Mentor↔Encontro

**Tipo:** Implementação
**Página:** Módulo C (backend)

## Descrição
Criar a rota backend que permite à equipe **trocar** o mentor vinculado a um encontro para um mentor existente da equipe, marcando o vínculo resultante como `manual` (para que o sync nunca o sobrescreva). Não existe remoção de mentor: a edição sempre resulta em exatamente um mentor vinculado (spec, Módulo C — "a edição sempre resulta em um mentor"). Validar no servidor que o usuário está autenticado como equipe, que o encontro existe e que o mentor escolhido existe.

**Rota:** `PUT /api/meetings/[id]/mentor` — body `{ "mentorId": "<uuid>" }` — resposta `{ "ok": true }` ou `{ "error": "<mensagem>" }`.

**Decisão de escopo do cliente:** a função cliente `updateMeetingMentor(meetingId, mentorId)` em `lib/supabase/data.ts` **entra nesta issue** (mesmo padrão de `saveParticipation`, com `teamAuthHeader()`), deixando a issue 17 apenas com UI/estado.

## Cenários

### Happy Path
1. Usuário da equipe autenticado envia `PUT /api/meetings/{id}/mentor` com `Authorization: Bearer <token>` e body `{ "mentorId": "<uuid de mentor existente>" }`.
2. O servidor valida sessão (`requireTeamUser`), abre transação pg, confirma que o encontro existe e que o mentor existe.
3. Remove o(s) vínculo(s) atual(is) do encontro em `meeting_mentors` (0, 1 ou mais linhas, `auto` ou `manual`) e insere um único vínculo `(meeting_id, mentor_id, source='manual')`.
4. Commit e resposta `200 { ok: true }`.
5. Sincronizações futuras (`app/api/calendar/sync/route.ts`) preservam o vínculo por ser `source='manual'`.

### Edge Cases
- **Encontro já vinculado ao mesmo mentor (vínculo `auto`):** operação prossegue normalmente; o vínculo é recriado com `source='manual'` (é a forma de "fixar" o mentor atual contra o sync). Resposta 200.
- **Encontro sem vínculo nenhum:** o delete afeta 0 linhas e o insert cria o primeiro vínculo, `manual`. Resposta 200.
- **Encontro com mais de um vínculo (estado legado):** todos são removidos; fica exatamente um vínculo com o mentor escolhido.
- **Reenvio idempotente (mesmo mentor, vínculo já `manual`):** delete + insert produzem o mesmo estado final. Resposta 200.

### Cenários de Erro
- **Sem header Authorization / token inválido:** `401 { error: "Não autenticado." }` ou `401 { error: "Sessão inválida." }` (vem de `requireTeamUser`).
- **Body ausente, não-JSON, sem `mentorId`, `mentorId` não-string ou fora do formato UUID:** `400 { error: "Dados inválidos." }` (validar formato UUID antes de tocar o banco, para não virar erro de cast do pg).
- **Encontro não encontrado (`id` da URL não existe em `meetings`):** `404 { error: "Encontro não encontrado." }` e rollback.
- **Mentor não encontrado (`mentorId` não existe em `mentors`):** `404 { error: "Mentor não encontrado." }` e rollback.
- **Falha de banco (conexão, constraint):** rollback e `500 { error: <mensagem> }`, mesmo padrão do catch da rota de participação.
- **Cliente (`updateMeetingMentor`):** em `!response.ok`, lançar `Error(result.error || "Não foi possível alterar o mentor.")` — a issue 17 usa isso para manter o valor anterior e exibir a mensagem.

## Banco de Dados
Nenhuma migration nova. Reutiliza o schema existente:
- `public.meeting_mentors (meeting_id, mentor_id, source)` — PK `(meeting_id, mentor_id)`; coluna `source public.mentor_link_source ('auto'|'manual')` criada em `supabase/migrations/202607030001_mentor_front_and_link_source.sql`.
- Operação (dentro de uma transação, via `pg` com `DATABASE_URL`, como em `lib/participation-server.ts`):
  1. `select id from public.meetings where id = $1` → 404 se vazio.
  2. `select id from public.mentors where id = $1` → 404 se vazio.
  3. `delete from public.meeting_mentors where meeting_id = $1`.
  4. `insert into public.meeting_mentors (meeting_id, mentor_id, source) values ($1, $2, 'manual')`.

## Arquivos

### Criar
- `app/api/meetings/[id]/mentor/route.ts` — handler `PUT` com `export const runtime = "nodejs"`; usa `requireTeamUser` de `lib/api-auth.ts`; valida body (`mentorId` string em formato UUID); delega a persistência ao módulo server e mapeia erros para o formato `{ error }` com status correto (seguir o padrão de `app/api/meetings/[id]/participation/route.ts`, incluindo `params: Promise<{ id: string }>`).
- `lib/meeting-mentor-server.ts` — `import "server-only"`; função `setMeetingMentor(meetingId: string, mentorId: string): Promise<void>` com a transação pg descrita acima (mesmo padrão de conexão/rollback/finally de `lib/participation-server.ts`). Para distinguir 404 de 500 na rota, lançar erros com mensagens fixas ("Encontro não encontrado." / "Mentor não encontrado.") que a rota reconhece e mapeia para 404.

### Modificar
- `lib/supabase/data.ts` — adicionar `export async function updateMeetingMentor(meetingId: string, mentorId: string): Promise<void>` fazendo `fetch` PUT para `/api/meetings/${meetingId}/mentor` com `Content-Type: application/json` + `teamAuthHeader()` e body `{ mentorId }`; lançar erro com a mensagem do backend em falha (mesmo formato de `saveParticipation`).

Nenhum outro arquivo deve ser tocado (o sync já ignora vínculos `manual`; a UI é a issue 17).

## Checklist
- [x] Criar `lib/meeting-mentor-server.ts` com `setMeetingMentor` (transação: valida encontro, valida mentor, delete + insert com `source='manual'`)
- [x] Criar `app/api/meetings/[id]/mentor/route.ts` (PUT) com `requireTeamUser`, validação do body e mapeamento de status (400/401/404/500)
- [x] Garantir que a rota NÃO aceita `mentorId` nulo/vazio (não existe "remover mentor")
- [x] Adicionar `updateMeetingMentor` em `lib/supabase/data.ts` com `teamAuthHeader()`
- [ ] Testar happy path: trocar mentor de um encontro com vínculo `auto` → vínculo vira o mentor escolhido com `source='manual'`
- [ ] Testar encontro sem vínculo → cria vínculo `manual`
- [ ] Testar erros: sem token (401), body inválido (400), encontro inexistente (404), mentor inexistente (404)
- [ ] Rodar um sync após a edição e confirmar que o vínculo `manual` não é alterado
- [x] `npm run build` / typecheck sem erros (`npx tsc --noEmit` limpo)
