# 25: Aba "Histórico" na Ficha do Cliente (UI)

**Tipo:** Implementação
**Página:** Módulo E — Aba "Histórico" na Ficha do Cliente

## Descrição
Adicionar a terceira aba "Histórico" ao drawer do mentorado em `components/mentoria-app.tsx` (após "Visão geral" e "Briefing"), carregando os dados apenas ao abrir a aba via a consulta da issue 24, com estados de carregamento ("Carregando..."), erro com tentar de novo e vazio ("Nenhum encontro registrado ainda."). A linha do tempo lista do mais recente ao mais antigo: encontros com data/hora, título, selo de tipo Individual/Grupo (mesmo selo visual existente), frente e mentor vinculado (ou "Sem mentor"), com links "Assistir gravação" e "Resumo da reunião" abrindo o Drive em nova aba; materiais sem encontro casado aparecem como itens próprios posicionados pela data. Somente leitura — nenhuma edição a partir da aba.

**Depende de:** issue 24 (consulta sob demanda).

## Cenários

1. **Aba visível:** ao abrir a ficha de qualquer mentorado, a barra `.drawer-tabs` mostra três botões na ordem "Visão geral", "Briefing", "Histórico". A ficha abre na aba "Visão geral", como hoje.
2. **Carga sob demanda:** abrir o drawer NÃO dispara `loadMenteeHistory`. A consulta roda apenas quando o usuário clica em "Histórico" (o painel só é montado nessa aba — mesmo padrão de `MenteeBriefingPanel`, que busca no mount via `useEffect` por `menteeId`). Enquanto roda, exibe `Carregando...` com a classe `muted`.
3. **Encontro na linha do tempo:** cada entrada `kind: "meeting"` exibe: data e hora formatadas (`fullDate` + `time`, formatters já existentes no topo de `mentoria-app.tsx`), título, selo `type-badge` (com modificador `group` quando `type === "Grupo"`, idêntico ao usado em `MeetingRow`/`AgendaItem`), a frente (`entry.front`) e o nome do mentor (`entry.mentorName`) ou o texto "Sem mentor" quando `mentorName` é `null`.
4. **Materiais do encontro:** para cada item de `entry.materials`, renderizar um link com `href={material.driveUrl}`, `target="_blank"` e `rel="noreferrer"`: rótulo "Assistir gravação" quando `type === "recording"` e "Resumo da reunião" quando `type === "summary"`. Vários materiais no mesmo encontro geram vários links (a ordem gravação→resumo já vem da consulta).
5. **Material avulso:** entradas `kind: "material"` aparecem como itens próprios na linha do tempo, na posição cronológica dada por `happenedAt` (a ordenação decrescente já vem pronta de `loadMenteeHistory` — o componente NÃO reordena). O item tem estilo/ícone distinto do encontro (ícone `Video` para gravação, `FileText` para resumo), com data/hora, título do arquivo e o link correspondente (mesmos rótulos e `target`/`rel` do cenário 4).
6. **Vazio:** consulta retorna `[]` → exibir "Nenhum encontro registrado ainda." (via `muted` ou `Empty`, coerente com o painel).
7. **Erro + tentar de novo:** se `loadMenteeHistory` rejeitar, exibir mensagem de erro com botão "Tentar novamente" que refaz a mesma consulta (voltando ao estado de carregamento). Padrão de referência: banner `data-error` com `RefreshCw` já usado na carga geral.
8. **Troca de contexto:** sair da aba "Histórico" e voltar remonta o painel e refaz a consulta (comportamento aceito, igual ao Briefing); resposta de uma consulta antiga não sobrescreve estado após unmount (flag `active` no `useEffect`, como em `MenteeBriefingPanel`).
9. **Somente leitura:** nenhum botão de edição/exclusão no painel; os únicos elementos interativos são os links de material e o "Tentar novamente".

## Arquivos

### Modificar

- **`components/mentoria-app.tsx`**
  - Import de `lib/supabase/data`: acrescentar `loadMenteeHistory` e `type MenteeHistoryEntry` (linha 12, import já existente). Import do `lucide-react`: acrescentar `FileText` (para o ícone de resumo/material avulso; `Video` e `RefreshCw` já estão importados).
  - `MenteeDrawer` (linha ~339): ampliar o estado `tab` para `useState<"geral" | "briefing" | "historico">("geral")`; adicionar o terceiro botão na `.drawer-tabs` (linha ~362) após "Briefing"; trocar o ternário da linha ~363 para renderizar `<MenteeHistoryPanel menteeId={mentee.id} />` quando `tab === "historico"`, mantendo Briefing e Visão geral como estão.
  - Novo componente `MenteeHistoryPanel({ menteeId }: { menteeId: string })`, colocado ao lado de `MenteeBriefingPanel` (após a linha ~507): estados `entries: MenteeHistoryEntry[]`, `loading`, `error` (+ um `reloadKey`/função `load()` para o retry); `useEffect` por `menteeId` com flag `active` chamando `loadMenteeHistory(menteeId)`; render em `<section className="detail-section">` com `detail-title` "HISTÓRICO" e a lista `.history-timeline` com os dois tipos de item (cenários 3–5). Nenhuma lógica de ordenação/dedup no componente — tudo vem pronto da consulta (thin client).

- **`app/globals.css`**
  - Acrescentar ao final um bloco `/* Ficha do mentorado — aba Histórico */` com classes novas mínimas, seguindo a paleta/escala dos blocos vizinhos (`.month-meeting`, `.mini-win`):
    - `.history-timeline` — coluna com gap (espelho de `.month-meetings`);
    - `.history-item` — cartão do encontro (fundo `#f4f6f2`, raio 9px, no padrão de `.month-meeting`), com linha de cabeçalho (data/hora + `type-badge`), título, e linha de meta (frente · mentor);
    - `.history-links` / `.history-links a` — links de material (cor `var(--green)`, `display:flex` com ícone, como os links de `.resource-grid a`);
    - `.history-loose` — variação do item para material avulso (visual distinto: fundo/borda diferentes e ícone à esquerda, na linha de `.mini-win`);
    - `.history-error` (se necessário) — mensagem + botão "Tentar novamente" (pode reusar `ghost-button`/`data-error` existentes; criar classe só se o reuso não bastar).
  - Não alterar nenhuma classe existente (`.drawer-tabs` já acomoda N botões via flex).

### Não tocar
- `lib/supabase/data.ts` — `loadMenteeHistory`, `MenteeHistoryEntry` e `MenteeHistoryMaterial` já existem (issue 24) e não mudam.
- Qualquer outra tela, consulta ou estilo.

## Checklist

- [x] `tab` do `MenteeDrawer` aceita `"historico"` e o botão "Histórico" aparece após "Briefing" na `.drawer-tabs`, com `active` correto
- [x] `MenteeHistoryPanel` criado no padrão de `MenteeBriefingPanel` (useEffect por `menteeId`, flag `active`, estados loading/erro locais)
- [x] `loadMenteeHistory` só é chamado quando a aba Histórico é aberta (nada na carga geral nem no mount do drawer)
- [x] Encontro renderiza data/hora (`fullDate` + `time`), título, `type-badge`/`type-badge group`, frente e mentor ou "Sem mentor"
- [x] Links "Assistir gravação" e "Resumo da reunião" com `href` = `driveUrl`, `target="_blank"` e `rel="noreferrer"`
- [x] Material avulso renderizado como item próprio com estilo/ícone distinto, data/hora e link
- [x] Ordem exibida = ordem retornada pela consulta (decrescente); componente não reordena nem deduplica
- [x] Estado vazio exibe "Nenhum encontro registrado ainda."
- [x] Estado de erro exibe mensagem com "Tentar novamente" que refaz a consulta
- [x] Nenhuma ação de escrita disponível na aba (somente leitura)
- [x] CSS novo restrito ao bloco `.history-*` no final de `app/globals.css`; nenhuma classe existente alterada
- [x] Apenas `components/mentoria-app.tsx` e `app/globals.css` modificados
- [x] `npm run build` (ou `npx tsc --noEmit`) passa sem erros
