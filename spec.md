# Spec: Formulário de Briefing Compartilhável com Mentorados

## Visão Geral

Atualmente o briefing de cada mentorado é um texto livre preenchido pela equipe. Esta feature substitui esse fluxo por um **formulário estruturado de briefing**, baseado nas 29 perguntas do formulário AE, que o **próprio mentorado** preenche.

A equipe gera e compartilha com cada mentorado um **link público único** (via token, sem login e sem senha) que abre uma tela onde ele responde o briefing. As respostas são armazenadas de forma estruturada (um registro por mentorado, com cada pergunta em seu próprio campo) e ficam visíveis para a equipe dentro da ficha do mentorado já existente.

Cada briefing tem um **status** (pendente / preenchido) e marcações de tempo (criado, enviado/preenchido, atualizado), permitindo à equipe acompanhar quem ainda não respondeu.

Adicionalmente, a feature importa as **44 respostas já existentes** da planilha de briefing para **pré-preencher** as fichas dos mentorados, casando por nome da marca (empresa). Os casos que casam automaticamente são pré-preenchidos; os demais ficam marcados para revisão manual.

Resolve o problema de: (a) coletar o briefing diretamente com o mentorado sem retrabalho da equipe, (b) padronizar e estruturar as informações para consulta e análise, e (c) aproveitar os briefings já coletados sem redigitação.

**Atores:**
- **Equipe (interna):** gera o link, acompanha o status, visualiza as respostas, importa respostas existentes.
- **Mentorado (externo):** acessa o link público e preenche o formulário, sem autenticação.

**As 29 perguntas do briefing (formulário AE), agrupadas por seção:**

1. *Identificação da marca:* nome da marca, nicho, ano de fundação, estado, cidade.
2. *Estrutura do negócio:* possui loja física (sim/não) e quantas, tipo de operação (atacado/varejo/ambos), número de funcionários, número de pessoas no marketing, número de pessoas no comercial.
3. *História e contexto:* história da empresa.
4. *Canais e vendas:* principal canal de vendas atual, canais online usados, política de primeira compra, política de formalidade (CNPJ/CPF).
5. *Clientes:* perfis de cliente-ideal, perfil prioritário, média de clientes recorrentes ativos, média de novos clientes por mês, há recompra (sim/não/às vezes).
6. *Ações de venda:* ações para vender para clientes da base, ações para vender para novos clientes.
7. *Coleções e lançamentos:* frequência de lançamento de coleções, estratégia de lançamento.
8. *Marketing e tráfego:* maior dificuldade no marketing, faz tráfego pago (sim/não) e quanto investe.
9. *Relacionamento e funis:* grupo de WhatsApp de inativos (sim/não), grupo de WhatsApp de clientes (sim/não), funis/estratégias usados.

---

## Páginas / Módulos

### Módulo A — Tela Pública de Briefing do Mentorado

**Descrição:** Página acessível por um link público com token único por mentorado, sem login e sem senha, onde o mentorado preenche (ou revisa) as respostas do briefing. O token identifica de qual mentorado é o briefing; nenhuma outra informação sensível do sistema é exposta.

**Componentes:**
- Cabeçalho de identificação: exibe o nome do mentorado/marca a que o briefing se refere e uma mensagem de boas-vindas/instruções de preenchimento.
- Indicador de status do briefing: mostra se o briefing está pendente ou já foi preenchido (e quando).
- Formulário em seções: agrupa as 29 perguntas nas seções descritas (Identificação da marca, Estrutura do negócio, História e contexto, Canais e vendas, Clientes, Ações de venda, Coleções e lançamentos, Marketing e tráfego, Relacionamento e funis).
- Campos de cada pergunta: campos de texto curto, texto longo, número, escolha única (ex.: tipo de operação, recompra) e sim/não com campo condicional (ex.: possui loja física → quantas; faz tráfego pago → quanto investe).
- Botão de salvar/enviar respostas.
- Mensagem de confirmação de envio: confirma que as respostas foram registradas.
- Estado de erro de token: mensagem exibida quando o link é inválido, inexistente ou revogado.

**Comportamentos:**
- Abrir o formulário a partir do link público com token: o sistema carrega a tela correspondente ao token informado.
- Validar o token: o sistema verifica se o token existe e está ativo antes de exibir o formulário.
- Exibir mensagem de erro quando o token for inválido, inexistente ou revogado, sem revelar dados do sistema.
- Carregar respostas já existentes no formulário quando o briefing já tiver sido preenchido anteriormente (permitir revisão/edição).
- Exibir o nome da marca/mentorado associado ao token no cabeçalho.
- Preencher os campos da seção "Identificação da marca".
- Preencher os campos da seção "Estrutura do negócio", incluindo o campo condicional de quantidade de lojas quando "possui loja física" for sim.
- Preencher o campo da seção "História e contexto".
- Preencher os campos da seção "Canais e vendas".
- Preencher os campos da seção "Clientes".
- Preencher os campos da seção "Ações de venda".
- Preencher os campos da seção "Coleções e lançamentos".
- Preencher os campos da seção "Marketing e tráfego", incluindo o campo condicional de valor investido quando "faz tráfego pago" for sim.
- Preencher os campos da seção "Relacionamento e funis".
- Validar os dados de entrada de cada campo (tipos, campos obrigatórios e campos condicionais) antes de aceitar o envio.
- Salvar as respostas do briefing associadas ao mentorado correspondente ao token.
- Atualizar o status do briefing para "preenchido" e registrar a data/hora de preenchimento ao salvar.
- Exibir mensagem de confirmação após o envio bem-sucedido.
- Exibir mensagem de erro caso o salvamento falhe, mantendo os dados digitados.
- Reenviar/atualizar respostas: permitir que o mentorado salve novamente, atualizando o registro e a data/hora de atualização.

---

### Módulo B — Visualização e Gestão do Briefing na Ficha Interna

**Descrição:** Dentro da ficha (drawer) já existente do mentorado, a equipe acessa uma área de briefing onde gera/copia o link público, acompanha o status de preenchimento e visualiza as respostas estruturadas enviadas pelo mentorado.

**Componentes:**
- Seção de briefing na ficha do mentorado: área dedicada dentro do drawer existente.
- Indicador de status do briefing: pendente ou preenchido, com data/hora de preenchimento e de última atualização quando houver.
- Campo/exibição do link público do mentorado.
- Botão de gerar link (quando ainda não existe token).
- Botão de copiar link.
- Botão de revogar/regenerar link (gera um novo token e invalida o anterior).
- Visualização das respostas: as 29 perguntas agrupadas por seção com os respectivos valores respondidos.
- Estado vazio: indicação de que o briefing ainda não foi preenchido.
- Marcação de "revisão pendente": destaque para fichas pré-preenchidas por importação que ainda precisam de revisão manual.

**Comportamentos:**
- Exibir a seção de briefing dentro da ficha do mentorado.
- Exibir o status atual do briefing (pendente/preenchido) e as datas associadas.
- Gerar o link público (token único) do mentorado quando ainda não existir.
- Exibir o link público quando já existir.
- Copiar o link público para a área de transferência.
- Revogar o link atual e gerar um novo token, invalidando o anterior.
- Visualizar as respostas do briefing agrupadas por seção.
- Exibir estado vazio quando o briefing ainda não foi preenchido.
- Exibir o conteúdo pré-preenchido por importação e a marcação de "revisão pendente" quando aplicável.
- Marcar uma ficha pré-preenchida como revisada (remover a marcação de revisão pendente).
- Atualizar a exibição do status quando o mentorado preencher/atualizar o briefing.

---

### Módulo C — Importação das Respostas Existentes

**Descrição:** Rotina executada pela equipe para importar as 44 respostas já coletadas na planilha de briefing e pré-preencher as fichas dos mentorados. O casamento é feito por nome da marca (empresa); as respostas que casam com um mentorado existente são pré-preenchidas, e as que não casam ou geram ambiguidade ficam separadas para revisão manual.

**Componentes:**
- Origem dos dados: a planilha de briefing com as 44 respostas (a planilha não possui e-mail).
- Resultado da importação: relação de respostas casadas automaticamente, respostas sem correspondência e respostas ambíguas (mais de um possível mentorado).
- Resumo da importação: contagem de pré-preenchidas, não casadas e a revisar.

**Comportamentos:**
- Ler as 44 respostas da planilha de briefing.
- Normalizar o nome da marca de cada resposta para comparação (ignorar diferenças de caixa, espaços e acentos).
- Casar cada resposta com um mentorado existente pelo nome da marca/empresa.
- Pré-preencher o briefing estruturado do mentorado com os campos correspondentes quando o casamento for único e automático.
- Definir o status do briefing pré-preenchido e marcá-lo como "revisão pendente".
- Não sobrescrever um briefing já preenchido pelo mentorado (preservar respostas mais recentes / evitar perda de dados).
- Separar para revisão manual as respostas sem correspondência de mentorado.
- Separar para revisão manual as respostas com correspondência ambígua (mais de um mentorado possível).
- Mapear cada coluna da planilha para o campo estruturado correspondente das 29 perguntas.
- Gerar um resumo da importação com a contagem de pré-preenchidas, não casadas e a revisar.
