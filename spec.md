# Spec: Vínculo Automático de Mentor por Frente do Encontro + Contador de Mentorias

## Visão Geral

Hoje cada encontro sincronizado do calendário é classificado automaticamente em uma **frente** (Tráfego, Redes sociais, Comercial ou Estratégia) a partir do título, mas nenhum mentor fica vinculado ao encontro — o vínculo mentor↔encontro existe na base, porém nunca é preenchido. Esta feature fecha esse ciclo em três partes:

1. **Frente de atuação por mentor:** cada mentor da equipe passa a ter uma frente de atuação registrada de forma permanente (Marcelle Mesquita → Tráfego; Day Maciel → Redes sociais; Bárbara Lazzari → Comercial; Felipe Santos → Estratégia).
2. **Atribuição automática no sync:** ao sincronizar a agenda, o sistema vincula automaticamente ao encontro o mentor cuja frente corresponde à frente classificada do encontro (ex.: título "🚀 Mentoria Individual - Tráfego Pago (Silvia | Shallon Moda)" → frente Tráfego → Marcelle). A equipe pode corrigir o vínculo manualmente quando a atribuição automática errar (ex.: Felipe cobrindo um encontro de Comercial), e sincronizações futuras **nunca sobrescrevem** uma correção manual.
3. **Contador de mentorias realizadas:** a tela "Visão geral" ganha um card que mostra, para o mês atual, quantas mentorias cada mentor já realizou, separadas por tipo (Individual e Grupo). "Realizada" significa encontro cuja data/hora de início já passou.

Importante: **não existe mentor principal por mentorado** — todos os mentorados recebem mentoria de todos os mentores. O vínculo de mentor é sempre **por encontro (sessão)**.

**Atores:**
- **Sistema (sync da agenda):** classifica a frente e atribui o mentor automaticamente.
- **Equipe (interna):** consulta o mentor de cada encontro, corrige vínculos errados e acompanha o contador de mentorias.

**Problemas que resolve:**
- (a) saber quem é o mentor responsável por cada encontro sem preenchimento manual;
- (b) permitir correção quando a regra automática errar, sem retrabalho a cada sync;
- (c) dar visibilidade à gestão de quantas mentorias cada mentor realizou no mês, por tipo.

---

## Páginas / Módulos

### Módulo A — Frente de Atuação do Mentor

**Descrição:** Cada mentor da equipe passa a ter uma frente de atuação registrada de forma permanente (Tráfego, Redes sociais, Comercial ou Estratégia). Essa frente é a base da atribuição automática. Não há tela nova: o registro é feito uma única vez na base de mentores existente.

**Componentes:**
- Registro de frente por mentor: cada mentor armazena, junto aos seus dados já existentes, a frente em que atua (pode ficar vazia para mentores sem frente definida).
- Carga inicial das frentes: atribuição das frentes aos quatro mentores atuais (Marcelle Mesquita → Tráfego; Day Maciel → Redes sociais; Bárbara Lazzari → Comercial; Felipe Santos → Estratégia).

**Comportamentos:**
- Armazenar de forma permanente a frente de atuação de cada mentor, restrita às quatro frentes existentes (Tráfego, Redes sociais, Comercial, Estratégia).
- Permitir que um mentor exista sem frente definida (nesse caso ele nunca recebe atribuição automática).
- Registrar, na carga inicial, a frente de cada um dos quatro mentores atuais conforme o mapeamento acima.
- Garantir no máximo um mentor por frente para fins de atribuição automática (se houver mais de um mentor na mesma frente, o sistema não atribui automaticamente encontros daquela frente).

---

### Módulo B — Atribuição Automática de Mentor no Sync da Agenda

**Descrição:** Durante a sincronização da agenda (a mesma que hoje cria/atualiza os encontros e classifica a frente pelo título), o sistema passa a vincular automaticamente o mentor correspondente à frente de cada encontro. Vínculos corrigidos manualmente pela equipe são preservados em todas as sincronizações futuras.

**Componentes:**
- Rotina de atribuição dentro do sync existente: para cada encontro criado ou atualizado, resolve o mentor pela frente classificada.
- Marcação de origem do vínculo: cada encontro registra se o vínculo de mentor atual foi definido automaticamente pelo sync ou manualmente pela equipe.

**Comportamentos:**
- Ao criar um encontro novo no sync, classificar a frente pelo título/descrição (comportamento já existente, mantido).
- Ao criar um encontro novo no sync, vincular automaticamente o mentor cuja frente de atuação é igual à frente classificada do encontro.
- Ao criar um encontro novo cuja frente não tem mentor correspondente, deixar o encontro sem mentor vinculado.
- Aplicar a atribuição automática tanto a encontros do tipo Individual quanto do tipo Grupo.
- Marcar como "automático" todo vínculo de mentor criado pelo sync.
- Ao reprocessar no sync um encontro já existente cujo vínculo é automático, recalcular o mentor pela frente atual do encontro e atualizar o vínculo se a frente tiver mudado.
- Ao reprocessar no sync um encontro já existente cujo vínculo foi definido manualmente, **não alterar** o vínculo de mentor, mesmo que a frente classificada aponte outro mentor.
- Ao reprocessar no sync um encontro sem vínculo cuja frente passou a ter mentor correspondente, criar o vínculo automático.
- Remover o vínculo de mentor junto com o encontro quando o encontro é removido pelo sync (comportamento de limpeza já existente, estendido ao vínculo).
- Não vincular mentor a eventos que o sync já ignora hoje (reuniões internas, bloqueios etc.).

---

### Módulo C — Edição do Vínculo Mentor↔Encontro (Agenda)

**Descrição:** Na tela "Agenda" (e no detalhe do encontro acessado também pela "Visão geral"), a equipe visualiza o mentor vinculado a cada encontro e pode corrigi-lo quando a atribuição automática estiver errada. Uma correção manual passa a ser definitiva perante o sync.

**Componentes:**
- Indicação do mentor no item de encontro: exibe o nome do mentor vinculado junto às informações já mostradas (horário, tipo, frente).
- Indicação de "sem mentor": estado exibido quando o encontro não tem mentor vinculado.
- Controle de edição do mentor: seletor com a lista de mentores da equipe para trocar o mentor do encontro.
- Indicação de vínculo manual: sinalização discreta de que o vínculo daquele encontro foi corrigido manualmente.

**Comportamentos:**
- Exibir o mentor vinculado em cada encontro listado na Agenda.
- Exibir o mentor vinculado no encontro do card "Agenda de hoje" da Visão geral.
- Exibir o estado "sem mentor" quando o encontro não possui vínculo.
- Abrir o controle de edição do mentor a partir do encontro.
- Listar todos os mentores da equipe como opções no controle de edição.
- Trocar o mentor vinculado ao encontro para o mentor escolhido pela equipe (a edição sempre resulta em um mentor — não é possível deixar o encontro sem mentor, pois o sync não distinguiria remoção intencional de ausência de vínculo).
- Marcar o vínculo como "manual" sempre que a equipe trocar o mentor pela edição.
- Exibir a sinalização de vínculo manual nos encontros corrigidos pela equipe.
- Persistir a alteração imediatamente ao confirmar a escolha e refletir o novo mentor na tela sem recarregar a página.
- Exibir mensagem de erro e manter o valor anterior caso a gravação da edição falhe.
- Validar no servidor que o mentor escolhido existe e que quem edita é um usuário autenticado da equipe.

---

### Módulo D — Contador de Mentorias por Mentor (Visão geral)

**Descrição:** Card na tela "Visão geral" que mostra, para o mês atual, quantas mentorias cada mentor já realizou, separadas por tipo (Individual e Grupo). Serve para a gestão acompanhar a distribuição de carga entre os mentores.

**Componentes:**
- Card "Mentorias do mês" na grade de cards da Visão geral: uma linha por mentor.
- Linha do mentor: nome do mentor, quantidade de mentorias Individuais realizadas, quantidade de mentorias em Grupo realizadas e total.
- Indicação do período: referência explícita ao mês atual.
- Estado vazio: mensagem exibida quando nenhum mentor tem mentoria realizada no mês.

**Comportamentos:**
- Calcular no servidor, para cada mentor, a quantidade de encontros vinculados a ele cujo início está dentro do mês corrente e cuja data/hora de início já passou.
- Separar a contagem por tipo de encontro (Individual e Grupo) e calcular o total por mentor.
- Considerar apenas o vínculo mentor↔encontro vigente (automático ou manual) no momento do cálculo — correções manuais alteram a contagem.
- Não contar encontros futuros do mês corrente (ainda não realizados).
- Não contar encontros de meses anteriores.
- Não contar encontros sem mentor vinculado.
- Exibir o card na Visão geral com uma linha por mentor que tenha ao menos um vínculo, mesmo com contagem zero no mês.
- Exibir a referência do mês corrente no card.
- Exibir o estado vazio quando não houver nenhuma mentoria realizada no mês.
- Atualizar a contagem exibida quando a equipe corrigir um vínculo de mentor ou quando um novo sync alterar vínculos automáticos.
