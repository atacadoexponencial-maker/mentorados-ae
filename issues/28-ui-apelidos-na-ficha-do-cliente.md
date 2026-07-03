# 28: UI — Apelidos de Marca na Ficha do Cliente

**Tipo:** Implementação
**Página:** Módulo C — Ficha do Cliente: Apelidos na Seção "CONTATO E MATERIAIS"

## Descrição
Adicionar o campo "Apelidos de marca" à edição existente da seção "CONTATO E MATERIAIS" do drawer da ficha (`MenteeDrawer`, `components/mentoria-app.tsx:366`), com exibição condicional na leitura, e fazer `updateMenteeContact` (`lib/supabase/data.ts:398-405`) gravar `brand_aliases` junto de `instagram_url`/`folder_url`. Thin client: a tela só captura e exibe; nenhuma lógica de matching no frontend.

## Cenários

### Happy Path
- Ao clicar em "Editar" na seção, aparece o campo "Apelidos de marca" (input de texto único, placeholder ex.: `Lady Hair, LMH`) ao lado de Instagram e Pasta, pré-preenchido com os apelidos atuais unidos por `", "`.
- Ao salvar, o texto vira lista: separa por vírgula, apara espaços de cada item e descarta itens vazios — `"Lady Hair, , LMH "` persiste como `["Lady Hair", "LMH"]`.
- Salvar segue o fluxo existente do botão da seção: chama `updateContact` com o mentee atualizado (agora incluindo `brandAliases`) e fecha o modo de edição; Instagram e Pasta continuam salvando juntos, como hoje.
- Na leitura, cliente com apelidos exibe no `resource-grid` o bloco `APELIDOS DE MARCA` com os apelidos separados por vírgula (padrão condicional dos links de Instagram/Pasta).
- Depois de salvar, a ficha reflete os apelidos imediatamente (o `updateContact` existente já substitui o mentee no estado do app com a linha retornada pelo banco).

### Edge Cases
- Cliente sem apelidos: campo de edição abre vazio; na leitura, o bloco "APELIDOS DE MARCA" não é exibido (nada muda visualmente para quem não usa a feature).
- Salvar com o campo vazio persiste lista vazia (remove todos os apelidos).
- Cancelar restaura o valor original dos três campos (Instagram, Pasta, Apelidos) e fecha a edição (padrão existente da linha 366).

### Cenário de Erro
- Falha na gravação segue o tratamento existente de `updateContact`/`assertNoError` — nenhum fluxo de erro novo é introduzido.

## Arquivos

### Modificar
- `components/mentoria-app.tsx` — em `MenteeDrawer`:
  - estado `aliases` inicializado com `mentee.brandAliases.join(", ")`, ao lado dos estados `instagram`/`folder` (linhas 345-347);
  - campo "Apelidos de marca" no `risk-form` da seção CONTATO E MATERIAIS (linha 366);
  - no Salvar, converter texto → lista (split por vírgula, trim, descartar vazios) e incluir `brandAliases` no objeto passado a `updateContact`; no Cancelar, restaurar também `aliases`;
  - na leitura, bloco condicional `APELIDOS DE MARCA` dentro do `resource-grid` quando `mentee.brandAliases.length > 0`.
- `lib/supabase/data.ts` — `updateMenteeContact` (linhas 398-405) passa a gravar também `brand_aliases: input.brandAliases` no mesmo `update` de `instagram_url`/`folder_url`.

Nenhum arquivo criado. Depende da issue 26 (coluna e tipos `brandAliases`).

## Checklist
- [x] Campo "Apelidos de marca" na edição da seção, pré-preenchido com `join(", ")`
- [x] Salvar converte texto em lista (trim + descarte de vazios) e persiste via `updateMenteeContact` junto de Instagram/Pasta
- [x] Campo vazio persiste lista vazia; Cancelar restaura os três campos
- [x] Bloco "APELIDOS DE MARCA" na leitura apenas quando há apelidos
- [x] Nenhuma lógica de matching no frontend; `npx tsc --noEmit` passa
- [x] Nenhum arquivo além dos dois listados foi modificado
