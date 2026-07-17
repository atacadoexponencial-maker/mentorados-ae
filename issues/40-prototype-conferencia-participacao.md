# 40: Protótipo — registro de participação com origem e pré-marcação
**Tipo:** Protótipo
**Página:** Módulo B — Conferência e Sobrescrita Manual da Participação
## Descrição
Prototipar o registro de participação do encontro exibindo o indicador de origem ("Preenchida automaticamente (Google Meet)", "Confirmada pelo mentor" ou "Sem registro"), a lista de presença pré-marcada conforme o dado do Meet (individual Sim/Não; grupo com presentes marcados), os campos de notas/observação existentes e os botões salvar (confirma como manual) e cancelar.

## Decisões do protótipo

- Tudo acontece no `AttendanceModal` existente (`components/mentoria-app.tsx`, ~linhas 376–403). Nenhum modal novo.
- **Origem:** `Meeting.attendanceSource` (issue 36) ainda não existe no código. O protótipo deriva a origem com fallback:
  `const origin: "auto" | "manual" | null = meeting.attendanceSource ?? (meeting.attendanceRecorded ? "manual" : null)` — se a 36 ainda não tiver sido mergeada quando esta issue for executada, usar apenas a parte do `attendanceRecorded` com comentário `// TODO issue 36: trocar por meeting.attendanceSource` (variante "auto" fica estilizada mas inalcançável, mesmo padrão da issue 32).
- **Pré-marcação com dado real:** hoje não há dado automático no banco, mas há linhas manuais em `meeting_participations`. O protótipo liga a pré-marcação a essas linhas reais: ao abrir o modal com `origin !== null`, carrega as participações do encontro e pré-marca a presença (o que também corrige o modal abrir "em branco" ao reabrir um encontro já registrado). Quando o Módulo A (issues 37–39) começar a gravar `'auto'`, a mesma pré-marcação passa a refletir o dado do Meet sem mudança nenhuma aqui.
- **Salvar continua o atual:** mesmo `saveParticipation` → `POST /api/meetings/[id]/participation`. Só muda o texto do botão para "Confirmar registro" (estado ocupado: "Confirmando..."). Cancelar continua fechando sem gravar.
- Indicador visual segue o padrão de badge com ponto colorido (`.status-badge`/`.review-flag` em `app/globals.css`) e a paleta da brand layer (`#f4e7bd/#8d6700` para dourado, `#e7e4dd/#343434` para neutro escuro, `#eae6de/#6f6a63` para cinza). Sem ícones novos do lucide.

## Cenários

### Happy Path
1. **Encontro sem registro** (`attendanceRecorded === false`): modal abre com o indicador "Sem registro" acima do resumo do encontro; presença com o default atual (individual "Sim" pré-selecionado; grupo sem ninguém marcado); notas/observação vazios; botões "Cancelar" e "Confirmar registro". Confirmar chama `saveParticipation` exatamente como hoje e dispara `onSaved`.
2. **Encontro já confirmado pelo mentor** (`attendanceRecorded === true`, origem `'manual'`): indicador "Confirmada pelo mentor"; ao abrir, `loadMeetingParticipations(meeting.id)` retorna as linhas reais e a presença aparece pré-marcada — individual com "Sim"/"Não" conforme `attended`; grupo com os presentes (`attended === true`) marcados no `participant-grid`. O mentor pode alterar livremente e confirmar de novo.
3. **Encontro com dado automático** (futuro, após issues 36–39: `attendanceSource === 'auto'`): indicador "Preenchida automaticamente (Google Meet)" em destaque dourado; presença pré-marcada com o dado do Meet (mesmas linhas de `meeting_participations`, agora com `source = 'auto'`); mentor confere, ajusta se preciso e clica "Confirmar registro" — o backend (issue 42) converte para manual, sem mudança neste componente.

### Edge Cases
4. **Issue 36 ainda não mergeada:** derivação usa só `attendanceRecorded` (`true` → "Confirmada pelo mentor"; `false` → "Sem registro"); a variante "auto" existe no JSX/CSS mas é inalcançável, com comentário apontando a troca para `meeting.attendanceSource`.
5. **Falha ao carregar participações** (rede/RLS): o modal permanece utilizável com os defaults atuais (individual "Sim", grupo vazio) e o indicador de origem correto — fallback silencioso, sem estado de erro novo.
6. **Pré-marcação vs. interação do usuário:** o carregamento assíncrono só aplica a pré-marcação na abertura (efeito por `meeting.id`); alterações feitas pelo mentor depois disso não são sobrescritas. Alterar presença é só estado local — nada é gravado até "Confirmar registro"; "Cancelar"/backdrop fecham sem gravar.
7. **Grupo com participação registrada de mentorado hoje inativo:** o `participant-grid` continua listando apenas mentorados `Ativo` (comportamento atual); linhas de participação de inativos são ignoradas na pré-marcação sem quebrar (filtro por interseção com a lista exibida).
8. **Encontro individual com registro `attended = false`:** segmented abre com "Não" selecionado (hoje abriria "Sim" por default) — reflexo fiel do registro existente.

### Cenário de Erro
9. **Falha ao confirmar:** `saveParticipation` rejeita → `saveError` exibido no próprio modal (comportamento atual mantido), botão volta de "Confirmando..." para "Confirmar registro" e o mentor pode tentar de novo ou cancelar.

## Arquivos

### Criar
Nenhum.

### Modificar
- `components/mentoria-app.tsx`
  - `AttendanceModal` (~linhas 376–403):
    - Derivar `origin` conforme a seção Decisões (com fallback/TODO para a issue 36).
    - Renderizar o indicador de origem no topo do conteúdo do modal (antes de `.meeting-summary`): `<div className={`origin-banner ${origin ?? "none"}`}><i />{texto}</div>` com os três textos — "Preenchida automaticamente (Google Meet)" (`auto`), "Confirmada pelo mentor" (`manual`), "Sem registro" (`none`).
    - `useEffect` por `meeting.id`: se `origin !== null`, chamar `loadMeetingParticipations(meeting.id)` e aplicar em `present` — individual: `attended` da linha do mentorado define Sim/Não; grupo: ids com `attended === true`. `catch` silencioso (edge 5); guarda `active` no cleanup como nos demais efeitos do arquivo.
    - Botão de salvar: rótulo "Confirmar registro" / "Confirmando..." (ícone `Check` mantido). Título, subtítulo, campos de notas/observação e "Cancelar" inalterados.
- `lib/supabase/data.ts`
  - Nova função exportada `loadMeetingParticipations(meetingId: string): Promise<Array<{ menteeId: string; attended: boolean }>>` — `supabase.from("meeting_participations").select("mentee_id, attended").eq("meeting_id", meetingId)` via `getSupabaseBrowserClient()` + `assertNoError`, mapeando para camelCase (mesmo padrão de leitura de `loadMenteeMonthMeetings`, que já lê essa tabela no browser).
  - Import da nova função na linha 12 de `components/mentoria-app.tsx`.
- `app/globals.css`
  - Novo bloco no final, comentado `/* Registro de participação — origem e pré-marcação */`: classe `.origin-banner` (badge horizontal com ponto `i`, mesmo desenho de `.status-badge`/`.review-flag`: `border-radius:999px`, fonte pequena, `display:inline-flex;align-items:center;gap:7px;padding:6px 12px;margin-bottom:14px`) com variantes `.auto` (fundo `#f4e7bd`, texto `#8d6700`, ponto `#e0a106`), `.manual` (fundo `#e7e4dd`, texto `#343434`, ponto `#1f1f1f`) e `.none` (fundo `#eae6de`, texto `#6f6a63`, ponto `#979d99`).

**Não tocar:** `lib/participation-server.ts` e `app/api/meetings/[id]/participation/route.ts` (salvar continua o atual; origem manual no save é a issue 42), `lib/types.ts` e `lib/supabase/database.types.ts` (fundação é a issue 36), `AgendaItem`/badge na listagem (issues 32/35/43), sync e scripts.

## Checklist

- [ ] `AttendanceModal` exibe o indicador de origem no topo com os três textos e estilos (`auto` dourado, `manual` neutro escuro, `none` cinza)
- [ ] Derivação de `origin` com fallback por `attendanceRecorded` e comentário TODO apontando `meeting.attendanceSource` (issue 36) — variante "auto" estilizada mesmo que inalcançável hoje
- [ ] `loadMeetingParticipations` criada em `lib/supabase/data.ts` lendo `mentee_id, attended` de `meeting_participations` no browser client
- [ ] Reabrir encontro já registrado pré-marca a presença real: individual Sim/Não conforme `attended`; grupo com presentes marcados; mentor consegue alterar livremente antes de confirmar
- [ ] Encontro sem registro abre com defaults atuais e indicador "Sem registro"
- [ ] Falha no carregamento das participações não quebra o modal (fallback silencioso para os defaults)
- [ ] Botão de salvar exibe "Confirmar registro" / "Confirmando..." e continua chamando `saveParticipation` sem mudança de payload; "Cancelar" fecha sem gravar
- [ ] `.origin-banner` adicionada em `app/globals.css` seguindo o padrão visual existente (badge com ponto, paleta da brand layer)
- [ ] `npm run build` passa sem erros de tipo
- [ ] Nenhum arquivo fora da lista tocado (backend de participação, types, database.types, sync e scripts intactos)
