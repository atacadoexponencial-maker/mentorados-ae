# 42: Confirmação manual prevalece sobre o dado automático
**Tipo:** Implementação
**Página:** Módulo B — Conferência e Sobrescrita Manual da Participação
## Descrição
No backend de gravação (`lib/participation-server.ts` e rota de save), marcar o registro como "confirmado pelo mentor" (origem manual) ao salvar — inclusive quando o mentor salva sem alterar nada ("conferi e está certo") — de modo que a coleta automática (issue 38) nunca mais toque naquele encontro. Cancelar não grava nada: o encontro permanece no estado em que estava (automático continua automático; sem registro continua sem registro).

## O que a issue 36 já cobre (verificar, não reimplementar)

A issue 36 já entrega, em `lib/participation-server.ts` (obrigatório lá por causa do check constraint `attendance_source_matches_recorded`):

1. Upsert das linhas do payload com `source = 'manual'` no `insert` **e** no `on conflict do update` — converte em definitivo qualquer linha `auto` que esteja no payload, mesmo sem alteração de valores.
2. Update do encontro com `attendance_recorded_at = now(), attendance_source = 'manual'` — converte o encontro `auto` (ou sem registro) em `'manual'` a cada save.

E a issue 38 já garante o outro lado do contrato: a coleta automática só escreve quando `attendance_source is null` (guarda `skipped_manual`, incluindo legado com `attendance_source` null e `attendance_recorded_at` preenchido) e o upsert `auto` tem `where meeting_participations.source = 'auto'` — nunca sobrescreve linha manual.

Também já está satisfeito, sem mudança alguma:

- **Frontend — salvar sem mudanças:** no `AttendanceModal` (`components/mentoria-app.tsx`), o botão "Salvar participação" só desabilita durante `saving`; individual abre pré-marcado "Sim" e grupo aceita salvar com zero selecionados (payload `entries: []` passa na validação `Array.isArray` da rota). Nenhum bloqueio a remover.
- **Frontend — cancelar não grava:** "Cancelar" e o X do modal chamam apenas `close()`; nenhum fetch acontece. O estado anterior do encontro é preservado por construção.
- **Rota:** `app/api/meetings/[id]/participation/route.ts` não muda — o payload é o mesmo e a origem `'manual'` é decidida no servidor, nunca enviada pelo cliente.

## Delta desta issue

Falta um único comportamento para o contrato "salvar converte em manual definitivo" ficar completo: **linhas `source = 'auto'` que NÃO estão no payload do save**. No grupo, o payload só contém os marcados como presentes; se a coleta automática marcou o mentorado X presente e o mentor o desmarca (ou X ficou inativo e nem aparece no modal), a linha `auto` de X sobraria com `attended = true` obsoleto — contradizendo a sobrescrita manual e deixando o encontro `'manual'` com resíduo `'auto'`.

Delta em `lib/participation-server.ts`, dentro da transação existente de `saveParticipation`, antes do loop de upsert:

```sql
delete from public.meeting_participations
 where meeting_id = $1
   and source = 'auto'
   and not (mentee_id = any($2::uuid[]))
```

com `$2 = entries.map(e => e.menteeId)`. Com `entries` vazio (`'{}'`), remove todas as linhas `auto` do encontro — "conferi, ninguém veio". Linhas `source = 'manual'` (inclusive todo o histórico legado, que tem `'manual'` pelo default da 36) nunca são apagadas — comportamento idêntico ao fluxo manual atual, em que re-salvar um grupo não remove presenças manuais anteriores.

## Cenários

### Happy Path
1. **"Conferi e está certo" (individual):** encontro com `attendance_source = 'auto'` e 1 linha `auto`; mentor abre o modal e salva sem alterar nada → upsert converte a linha para `source = 'manual'` (mesmos valores), encontro vira `attendance_source = 'manual'` com novo `attendance_recorded_at`; delete de resíduo não afeta nada (a linha está no payload). A coleta automática (issue 38) passa a retornar `skipped_manual` para este encontro, para sempre.
2. **"Conferi e está certo" (grupo):** presenças pré-marcadas (issue 41) enviadas como estão → todas as linhas `auto` do payload viram `manual`, zero linhas sobram no delete, encontro `'manual'`.
3. **Sobrescrita real (grupo):** coleta marcou A, B, C presentes; mentor desmarca B e marca D → upsert grava A, C, D com `source = 'manual'`; o delete remove a linha `auto` de B (não está no payload); encontro `'manual'`. Estado final é exatamente o que o mentor salvou.
4. **Cancelar sobre registro automático:** mentor abre o modal de um encontro `'auto'` e cancela → nenhuma requisição é feita; encontro continua `'auto'` com as mesmas linhas, e a rotina (issue 39) pode re-coletar normalmente.

### Edge Cases
- **Cancelar sem registro prévio:** encontro com `attendance_source` null continua null — segue elegível tanto para coleta automática quanto para registro manual futuro.
- **Grupo salvo com zero presentes:** payload `entries: []` → delete remove todas as linhas `auto`, loop de upsert não roda, encontro ainda assim vira `'manual'` ("ninguém veio" confirmado). A coleta nunca mais toca.
- **Linha `auto` de mentorado que ficou inativo:** não aparece no modal (filtro `status === "Ativo"` do grupo), logo não vem no payload → removida pelo delete; sem resíduo `auto` num encontro `'manual'`.
- **Linhas manuais pré-existentes:** re-salvar nunca apaga linha `source = 'manual'` fora do payload (delete filtra `source = 'auto'`) — histórico legado e saves anteriores preservados, idêntico ao comportamento atual.
- **`last_participation_at` de presença auto desfeita:** desmarcar B não retrocede `last_participation_at` de B (a regra `greatest(...)` só avança) — mesma limitação já existente no fluxo manual; fora de escopo.
- **Re-save de encontro já `'manual'`:** idempotente — upsert re-grava `'manual'`, delete não encontra linhas `auto`, timestamp atualiza.

### Cenário de Erro
- **Falha de banco no meio do save:** o delete participa da transação existente → `rollback` restaura tudo (linhas `auto` voltam, encontro permanece `'auto'`/null); erro propagado pela rota como 500 e exibido no modal (`saveError`), que permanece aberto para retry.
- **Escrita parcial impossível por constraint:** qualquer caminho que gravasse `attendance_recorded_at` sem `attendance_source` falha ruidosamente no constraint da 36 — não existe estado meio-convertido.

## Arquivos

### Criar
- Nenhum.

### Modificar
- `lib/participation-server.ts` — dentro da transação de `saveParticipation`, após validar o encontro e antes do loop de upsert, adicionar o `delete` de linhas `source = 'auto'` do encontro cujos `mentee_id` não estão em `entries` (SQL da seção "Delta desta issue"). Pré-requisito: as mudanças da issue 36 neste mesmo arquivo (`source = 'manual'` no upsert; `attendance_source = 'manual'` no update do encontro) já aplicadas — se a 36 tiver divergido, completar aqui conforme o contrato dela.

**Não tocar:** `app/api/meetings/[id]/participation/route.ts` (payload e validação inalterados), `components/mentoria-app.tsx` (salvar sem mudanças e cancelar já atendem o contrato; pré-marcação/indicador são as issues 41/43), `lib/supabase/data.ts`, `lib/auto-participation-server.ts` (guarda `skipped_manual` é a issue 38), migrations (modelagem é a issue 36).

## Checklist

- [ ] Verificado que a 36 entregou em `lib/participation-server.ts`: `source = 'manual'` no insert e no `on conflict do update`, e `attendance_source = 'manual'` no update do encontro (se ausente, completado aqui)
- [ ] Delete de linhas `auto` fora do payload adicionado dentro da transação, filtrando `source = 'auto'` (nunca apaga linha manual)
- [ ] Salvar sem alterar nada converte encontro e todas as linhas para `'manual'` (verificado via SQL: nenhum `source = 'auto'` restante no encontro salvo)
- [ ] Grupo: desmarcar um presente da coleta e salvar remove a linha `auto` dele; salvar com zero presentes remove todas as linhas `auto` e marca o encontro `'manual'`
- [ ] Cancelar não dispara requisição alguma (aba Network limpa); encontro `'auto'` continua `'auto'`, sem registro continua sem registro
- [ ] Após confirmação manual, `collectMeetingParticipation` (issue 38) retorna `skipped_manual` para o encontro
- [ ] Nenhum arquivo além de `lib/participation-server.ts` tocado
- [ ] `npm run lint` e `npm run build` passam
