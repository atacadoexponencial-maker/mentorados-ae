# Spec: Participação Automática via Google Meet, Agenda com Datas Passadas e Completude da Agenda

## Visão Geral

Hoje, o registro de quem participou de cada mentoria é 100% manual: depois do encontro, alguém da equipe abre o encontro na Agenda e marca presença mentorado por mentorado. Além disso, a Agenda da plataforma só mostra dias a partir de "ontem" — não há como voltar no tempo para conferir mentorias já realizadas. Por fim, há relatos de que nem todas as mentorias da agenda do Google aparecem na plataforma.

Esta spec cobre três frentes complementares:

1. **Participação automática:** o Google Meet sabe quem de fato entrou em cada reunião. A plataforma passa a usar esse dado real para preencher a participação dos mentorados automaticamente, por padrão. O registro manual continua existindo como **sobrescrita**: o mentor pode revisar, corrigir e confirmar — e a confirmação manual sempre prevalece sobre o dado automático.
2. **Agenda com datas passadas:** a Agenda ganha navegação livre para trás no tempo, para que os mentores possam reservar um dia da semana para conferir as mentorias já realizadas — ver o que aconteceu, quem participou (dado automático) e confirmar/ajustar o registro.
3. **Completude da agenda (comportamento esperado):** toda mentoria válida existente nas agendas do Google dos mentores deve aparecer na plataforma. Nenhum encontro válido pode sumir silenciosamente. (A causa raiz do bug atual está em investigação separada; aqui fica registrado o comportamento correto que o sistema deve garantir.)

**Atores:**
- **Sistema (sincronização):** importa os encontros das agendas do Google e, após cada encontro realizado, coleta a lista real de participantes do Meet e preenche a participação automaticamente.
- **Mentores / equipe:** navegam pela Agenda (incluindo datas passadas), conferem as participações preenchidas automaticamente e as confirmam ou corrigem manualmente.

**Problemas que resolve:**
- (a) elimina o trabalho manual de marcar presença encontro a encontro — o padrão passa a ser automático;
- (b) reduz registros esquecidos: mesmo sem ação do mentor, a participação real fica registrada;
- (c) permite a rotina semanal de conferência: o mentor volta na Agenda, revisa a semana passada e confirma os registros;
- (d) garante confiança na Agenda: o que está na agenda do Google (e é mentoria válida) está na plataforma.

**Regras de negócio preservadas (não mudam):**
- Não existe "mentor principal": todos os mentorados recebem mentoria de todos os mentores.
- Eventos EXT, CRM/Kommo, R1/R2 (reuniões de venda), Entrevistas e demais títulos ignorados **não** contam como mentoria e continuam fora da plataforma.
- Um mesmo evento presente na agenda de mais de um mentor continua contando **uma única vez** (deduplicação).

**Fora do escopo:** notas de engajamento/evolução automáticas (continuam manuais); participação automática de convidados que não são mentorados cadastrados; qualquer alteração nos critérios de casamento evento↔mentorado; a investigação da causa raiz do bug de eventos faltantes (conduzida em separado).

---

## Páginas / Módulos

### Módulo A — Coleta Automática de Participação (sistema)

**Descrição:** Após cada encontro realizado que tenha link do Google Meet, o sistema consulta os dados reais de participação da reunião no Google e registra automaticamente quais mentorados estiveram presentes. O registro automático é sempre identificado como tal e nunca sobrescreve um registro já confirmado manualmente.

**Componentes:**
- Rotina periódica de coleta: varre os encontros já encerrados que ainda não têm participação confirmada manualmente e busca no Google a lista de quem efetivamente entrou na reunião do Meet correspondente.
- Casamento participante↔mentorado: identifica cada participante do Meet pelo e-mail e o associa ao mentorado cadastrado com aquele e-mail.
- Registro de participação automática: presença por mentorado, com origem marcada como "automática".
- Registro da data da última participação do mentorado: atualizada quando a presença automática é positiva, do mesmo modo que já acontece no registro manual.

**Comportamentos:**
- Ao encerrar um encontro individual com link do Meet, o sistema registra automaticamente se o mentorado do encontro participou (presente se o e-mail dele aparece entre os participantes reais da reunião; ausente caso contrário).
- Ao encerrar um encontro em grupo com link do Meet, o sistema registra automaticamente como presentes todos os mentorados ativos cujos e-mails aparecem entre os participantes reais da reunião.
- Participantes da reunião que não correspondem a nenhum mentorado cadastrado (mentores, convidados externos) são ignorados no registro de participação.
- Participação registrada automaticamente fica marcada com origem "automática", distinguível da participação confirmada pelo mentor.
- Se o mentor já confirmou a participação de um encontro manualmente, a coleta automática **não** altera nada naquele encontro — o registro manual sempre prevalece.
- Se a coleta automática já preencheu um encontro e o mentor depois edita e salva, o registro passa a ser manual e a coleta automática não toca mais naquele encontro.
- Encontro sem link do Meet não recebe participação automática — permanece pendente de registro manual, como hoje.
- Se os dados de participação da reunião ainda não estiverem disponíveis no Google logo após o encontro, o sistema tenta novamente nas próximas execuções da rotina até conseguir (ou até o mentor registrar manualmente).
- Se um mentorado tiver participado da reunião mas não tiver e-mail cadastrado (ou o e-mail no Meet for diferente do cadastrado), ele não é marcado automaticamente — o mentor pode corrigir manualmente na conferência.
- A coleta automática registra apenas presença/ausência; notas de engajamento, evolução e observações permanecem vazias até o mentor preenchê-las.
- A presença automática positiva atualiza a data de última participação do mentorado (alimentando o indicador "sem participação há mais de 14 dias" do painel).
- A coleta automática respeita a deduplicação: um encontro que existe na agenda de mais de um mentor gera um único registro de participação por mentorado.

### Módulo B — Encontro: Conferência e Sobrescrita Manual da Participação

**Descrição:** O registro de participação de um encontro (aberto a partir da Agenda) passa a exibir o que foi preenchido automaticamente e permite ao mentor confirmar ou corrigir. A ação manual sobrescreve o dado automático de forma definitiva.

**Componentes:**
- Indicador de origem do registro: mostra se a participação daquele encontro está "Preenchida automaticamente (Google Meet)", "Confirmada pelo mentor" ou "Sem registro".
- Lista de presença pré-marcada: nos encontros com registro automático, os mentorados detectados no Meet já aparecem marcados como presentes ao abrir o registro.
- Campos de notas e observação: engajamento, evolução (individual) e observação rápida, como hoje.
- Botão de salvar: confirma o registro como manual.

**Comportamentos:**
- Ao abrir o registro de um encontro com participação automática, a presença já vem pré-marcada conforme o dado real do Meet (individual: Sim/Não; grupo: mentorados presentes marcados).
- Ao abrir o registro de um encontro sem participação automática (sem Meet, dado indisponível ou ainda não coletado), a presença vem em branco, como hoje.
- O mentor pode alterar livremente qualquer presença pré-marcada antes de salvar.
- Ao salvar, o registro passa a ser "Confirmado pelo mentor" e nunca mais é alterado pela coleta automática.
- Salvar sem alterar nada também confirma o registro (vale como "conferi e está certo").
- Cancelar mantém o registro no estado em que estava (automático permanece automático; sem registro permanece sem registro).
- O indicador de origem é visível também na listagem da Agenda, para o mentor identificar de relance quais encontros já foram conferidos e quais estão só com o dado automático.

### Módulo C — Agenda: Navegação para Datas Passadas

**Descrição:** A Agenda deixa de mostrar apenas os próximos dias e passa a permitir navegar livremente para qualquer data passada, viabilizando a rotina semanal de conferência das mentorias realizadas.

**Componentes:**
- Faixa de dias navegável: os dias exibidos ganham controles para avançar e retroceder no tempo (semana a semana ou dia a dia).
- Seletor de data: atalho para pular direto para uma data específica (passada ou futura).
- Atalho "Hoje": retorna imediatamente para o dia atual.
- Lista de encontros do dia selecionado: mesma listagem atual, agora funcionando para qualquer dia, inclusive passado.

**Comportamentos:**
- Ao abrir a Agenda, o dia selecionado por padrão é o dia atual (ou o próximo dia com encontros, como hoje).
- Ao retroceder na faixa de dias, o mentor vê dias anteriores, incluindo dias sem encontros (exibidos com estado vazio claro).
- Ao selecionar um dia passado, a lista mostra todos os encontros daquele dia com seu indicador de origem de participação (automática / confirmada / sem registro).
- Encontros passados permanecem na plataforma: uma mentoria realizada nunca desaparece da Agenda por ter ficado no passado.
- Em encontros passados, o mentor pode abrir o registro de participação para conferir e confirmar (comportamentos do Módulo B).
- Em encontros passados, o acesso à sala do Meet deixa de ser a ação principal (o encontro já ocorreu); a ação principal passa a ser conferir a participação.
- O atalho "Hoje" retorna a Agenda para o dia atual a partir de qualquer ponto da navegação.
- A navegação para o futuro continua funcionando como hoje (próximos encontros sincronizados).
- O painel "Visão geral" não muda: continua focado em hoje e nos próximos encontros.

### Módulo D — Completude da Agenda (comportamento esperado)

**Descrição:** Define o contrato de completude entre as agendas do Google dos mentores e a plataforma: toda mentoria válida deve aparecer, sem exceção. Serve de critério de aceite para a correção do bug em investigação e de régua para o comportamento futuro do sistema.

**Componentes:**
- Sincronização das agendas: importa os eventos de todas as agendas configuradas dos mentores.
- Regras de validade de mentoria (existentes, inalteradas): filtros de título e casamento com mentorado.
- Resumo de sincronização: totais de encontros sincronizados, ignorados e removidos a cada execução.

**Comportamentos:**
- Todo evento das agendas dos mentores dentro da janela de sincronização que seja mentoria válida aparece na plataforma — individual (quando casa com exatamente um mentorado) ou em grupo (quando o título indica encontro em grupo).
- São e continuam sendo ignorados, por regra de negócio: EXT, CRM/Kommo, R1/R2 (reuniões de venda), Entrevistas, reuniões internas, workshops, almoços, bloqueios de agenda, reuniões comerciais e 1:1 do time.
- Um evento presente na agenda de mais de um mentor aparece uma única vez na plataforma.
- Um evento válido nunca é descartado por qualquer motivo diferente das regras de negócio acima — se está na agenda do Google e é mentoria válida, está na plataforma.
- Alterações no evento do Google (horário, título, link do Meet) são refletidas na plataforma na sincronização seguinte.
- Um evento cancelado no Google deixa de aparecer na plataforma, **exceto** se o encontro já tem participação registrada (automática ou manual) — histórico de mentoria realizada não é apagado.
- Mentorias realizadas no passado permanecem na plataforma indefinidamente, independentemente da janela de sincronização (sustenta o Módulo C).
- Cada execução da sincronização informa quantos encontros foram sincronizados, ignorados e removidos, permitindo à equipe detectar discrepâncias entre a agenda do Google e a plataforma.
