# Spec: Histórico do Cliente (Fase 1) — Backfill do Calendar + Materiais do Drive + Aba "Histórico"

## Visão Geral

Hoje o app só conhece os encontros da janela ativa do sync do Google Calendar (−24h a +90 dias). Todo o passado da mentoria — cerca de 8.629 eventos desde fevereiro/2023 nos calendários dos 4 mentores — e os materiais gerados nas reuniões (280 gravações de vídeo e 214 resumos "Anotações do Gemini" nas 64 pastas de cliente de "1 ATIVOS AE" no Drive compartilhado) ficam invisíveis para a equipe. Esta feature traz esse histórico para dentro do app em quatro partes:

1. **Backfill único do Calendar (script):** importa os eventos passados desde 2023-02-01 reusando exatamente as mesmas regras de matching (e-mail/nome/marca), ignore/grupo por título, classificação de frente e vínculo automático de mentor do sync atual. Só eventos com correspondência a clientes cadastrados (ou reconhecidos como grupo pelo título) viram encontros.
2. **Proteção do histórico no sync de rotina:** a limpeza do sync (que apaga encontros sumidos do Calendar) passa a atuar apenas dentro da janela ativa consultada (−24h a +90d). Encontros históricos fora dessa janela nunca são apagados.
3. **Importação de gravações e resumos do Drive (script único):** varre as pastas de cliente de "1 ATIVOS AE", casa pasta↔cliente pelo nome da marca, registra cada gravação (vídeo) e resumo (doc Gemini) com data extraída do nome do arquivo + link do Drive, associa ao cliente e — quando data/hora casarem — ao encontro do Calendar. Gera relatório de pastas e arquivos sem correspondência para revisão manual.
4. **Aba "Histórico" na ficha do cliente:** linha do tempo do mais recente ao mais antigo misturando encontros e materiais, carregada sob demanda ao abrir a aba (padrão de `loadBriefing`/`loadMenteeMonthMeetings`), sem pesar o load geral.

Complemento obrigatório: a **carga geral do app passa a trazer só a janela recente/futura de encontros** — sem isso a Agenda abriria em 2023 (ela mostra o primeiro grupo de dias da lista) e a carga geral traria milhares de encontros históricos desnecessários.

**Atores:**
- **Operador (dev/gestão):** executa os dois scripts de importação uma única vez e revisa os relatórios de não-casados.
- **Sistema (sync da agenda):** continua sincronizando a janela ativa, agora sem risco de apagar o histórico.
- **Equipe (interna):** consulta o histórico completo de cada cliente na ficha, com acesso direto às gravações e resumos.

**Problemas que resolve:**
- (a) enxergar toda a jornada de encontros de um cliente desde 2023, não só a janela recente;
- (b) acesso em um clique à gravação e ao resumo de cada reunião, sem caçar no Drive;
- (c) impedir que o sync de rotina destrua o histórico importado;
- (d) manter Agenda e Visão geral rápidas e ancoradas no presente.

**Fora do escopo (Fase 2):** importar o texto dos resumos Gemini para dentro do app; varrer as pastas "Meet Recordings" pessoais dos mentores; sync recorrente do Drive; edição manual de casamentos pasta↔cliente ou material↔encontro pela interface.

---

## Páginas / Módulos

### Módulo A — Armazenamento de Materiais do Cliente (base de dados)

**Descrição:** Estrutura permanente para registrar gravações e resumos vindos do Drive, associados ao cliente e opcionalmente a um encontro. É a base dos Módulos C e D. Migração no padrão de `supabase/migrations/`.

**Componentes:**
- Registro de material: cliente (obrigatório), encontro (opcional), tipo (gravação ou resumo), título do arquivo, identificador do arquivo no Drive (único), link de visualização no Drive, data/hora da reunião extraída do nome do arquivo.
- Regras de acesso: mesma política das demais tabelas do MVP (qualquer usuário autenticado da equipe lê; escrita acontece apenas via script com conexão direta ao banco).

**Comportamentos:**
- Armazenar cada material vinculado a exatamente um cliente cadastrado.
- Permitir material sem encontro vinculado (casamento com encontro é opcional).
- Garantir unicidade pelo identificador do arquivo no Drive (reimportações atualizam em vez de duplicar).
- Remover os materiais de um cliente quando o cliente é excluído; desvincular (sem excluir o material) quando o encontro vinculado é excluído.
- Restringir o tipo do material aos dois valores: gravação e resumo.
- Indexar a consulta por cliente ordenada por data (a aba Histórico consulta por cliente).

---

### Módulo B — Backfill de Encontros Históricos do Calendar (script único)

**Descrição:** Script de execução única (padrão dos `scripts/import-*.mjs`: Node `.mjs`, `process.loadEnvFile(".env.local")`, conexão `pg` via `DATABASE_URL`, transação com rollback, relatório no console) que importa os eventos passados dos calendários dos 4 mentores desde 2023-02-01, criando encontros históricos com as mesmas regras do sync atual (`app/api/calendar/sync/route.ts`).

**Componentes:**
- Busca paginada de eventos: mesmas fontes configuradas do sync (subjects delegados × calendários), período de 2023-02-01T00:00 (GMT−03:00) até o início da janela ativa do sync (agora − 24h).
- Motor de matching/classificação: reuso da mesma lógica do sync — correspondência por e-mail de participante, nome normalizado e marca normalizada; regex de ignore por título; regex de grupo por título; classificação de frente por título/descrição.
- Vínculo automático de mentor pela frente, com a mesma regra do sync.
- Relatório de execução no console.

**Comportamentos:**
- Buscar os eventos de todas as fontes configuradas do sync (mesmos subjects e calendários), com paginação, de 2023-02-01 até agora − 24h (nunca invadir a janela ativa do sync).
- Descartar eventos cancelados ou sem identificador (mesma regra da coleta atual).
- Normalizar título+descrição e casar com clientes cadastrados pelas mesmas três regras do sync: e-mail do participante igual ao e-mail do cliente; nome normalizado do cliente (mínimo 4 caracteres) contido no texto; marca normalizada (mínimo 4 caracteres) contida no texto.
- Considerar no matching **todos os clientes cadastrados, inclusive pausados e encerrados** (diferente do sync, que exclui encerrados): o histórico pertence ao passado, e um cliente hoje encerrado tinha encontros quando era ativo.
- Ignorar eventos que batem no regex de ignore por título do sync (workshop AE, reunião interna, daily, almoço, bloqueio, comercial, 1:1).
- Criar encontro do tipo Grupo para eventos que batem no regex de grupo por título do sync (plantão, mentoria em grupo, clínica de vendas), sem exigir correspondência de cliente.
- Criar encontro do tipo Individual apenas quando exatamente um cliente casa com o evento; com zero ou múltiplas correspondências, ignorar o evento (mesma regra do sync).
- Classificar a frente do encontro pelo título/descrição com a mesma classificação do sync.
- Gravar cada encontro com a mesma identidade do sync (calendário de origem + id do evento) usando upsert: reexecuções do script não duplicam encontros, nem duplicam encontros que o sync já tenha criado.
- Vincular automaticamente o mentor cuja frente de atuação é igual à frente do encontro (vínculo marcado como automático), apenas quando a frente tem exatamente um mentor e o encontro ainda não tem vínculo; nunca alterar vínculos existentes (automáticos ou manuais).
- Não executar nenhuma limpeza/remoção de encontros (o script apenas insere/atualiza).
- Não criar registros de participação nem alterar a data de última participação dos clientes (encontro histórico não equivale a presença registrada).
- Executar tudo em transação: falha no meio não deixa importação parcial.
- Imprimir relatório final: período coberto, total de eventos lidos por calendário, encontros individuais criados, encontros em grupo criados, eventos ignorados (por regra de ignore, sem correspondência e correspondência ambígua, separadamente).

---

### Módulo C — Proteção do Histórico na Limpeza do Sync

**Descrição:** Ajuste na rotina de limpeza do sync do Calendar (`app/api/calendar/sync/route.ts`). Hoje ela apaga qualquer encontro sincronizado que não apareça nas chaves da execução atual — o que apagaria todo o backfill na primeira rodada do cron. A limpeza passa a atuar somente sobre encontros dentro da janela que o sync efetivamente consultou.

**Componentes:**
- Janela ativa compartilhada: os limites de tempo usados na busca de eventos (agora − 24h a agora + 90d) passam a ser definidos em um único lugar (`lib/google-calendar.ts`) e reutilizados pela limpeza, para busca e limpeza nunca divergirem.
- Condição de data na remoção de encontros do sync.

**Comportamentos:**
- Calcular a janela ativa (início: agora − 24h; fim: agora + 90d) uma única vez por execução do sync e usar exatamente os mesmos limites na busca de eventos e na limpeza.
- Remover na limpeza apenas encontros cujo início está dentro da janela ativa E que estão ausentes das chaves da execução atual.
- Nunca remover encontros cujo início é anterior ao início da janela ativa (todo o histórico do backfill fica intocado), independentemente de estarem ou não nas chaves atuais.
- Nunca remover encontros cujo início é posterior ao fim da janela ativa.
- Manter todas as salvaguardas atuais da limpeza: só encontros originados do Calendar, só dos calendários configurados, nunca com presença registrada, nunca com participações lançadas.
- Manter inalterados os comportamentos de upsert e de vínculo automático de mentor do sync (que já operam apenas sobre as chaves da execução atual e portanto não tocam o histórico).

---

### Módulo D — Importação de Gravações e Resumos do Drive (script único)

**Descrição:** Script de execução única (mesmo padrão dos `scripts/import-*.mjs`) que autentica com a conta de serviço Google (delegação, escopo Drive já autorizado), varre as 64 pastas de cliente de "1 ATIVOS AE" (id `1mD-icXalCyRuVp8_gcNEh3ifSF8eusHM`, configurável), casa pasta↔cliente por nome da marca, registra os materiais no Módulo A e casa cada material com o encontro do Calendar quando a data/hora bater. Relatório completo de não-casados para revisão manual.

**Componentes:**
- Autenticação Drive: conta de serviço existente com delegação para um subject configurado, escopo Drive.
- Varredura de pastas: subpastas diretas de "1 ATIVOS AE" (uma por cliente) e, dentro de cada uma, a subpasta de gravações (nomes variam: "1_GRAVAÇÕES", "01_GRAVAÇÕES" etc.).
- Casador pasta↔cliente por nome: mesma estratégia do `import-briefing` (normalização de acentos/caixa/pontuação; correspondência exata pela marca, depois por continência parcial; ambíguos não importam e vão ao relatório).
- Classificador de arquivo: gravação (vídeo) vs. resumo (Google Doc/.docx "Anotações do Gemini") vs. ignorado.
- Extrator de data/hora do nome do arquivo: padrão "<título da reunião> - 2026/05/20 16:46 GMT-03:00 - Recording" / "... - Anotações do Gemini" (com variações).
- Casador material↔encontro por cliente + data/hora.
- Relatório de execução no console.

**Comportamentos:**
- Autenticar no Drive com a conta de serviço delegada a um subject configurado por variável de ambiente, usando o escopo Drive já autorizado no Workspace.
- Listar todas as subpastas diretas da pasta "1 ATIVOS AE" (id parametrizável por variável de ambiente/argumento, com o id conhecido como padrão), tratando paginação.
- Casar cada pasta com um cliente cadastrado pelo nome normalizado da pasta contra a marca/empresa normalizada (exato primeiro; se não houver, continência parcial nos dois sentidos).
- Registrar no relatório as pastas com zero correspondência ("sem correspondência") e as com mais de uma ("ambígua"), sem importar nada delas.
- Registrar no relatório os clientes cadastrados que não receberam nenhuma pasta (visão inversa, para detectar erros de grafia nas pastas).
- Localizar dentro de cada pasta casada a subpasta de gravações por nome normalizado contendo "GRAVA" (cobre "1_GRAVAÇÕES", "01_GRAVAÇÕES" e variações); registrar no relatório as pastas de cliente sem subpasta de gravações.
- Varrer os arquivos da subpasta de gravações (com paginação) e classificar: tipo de conteúdo de vídeo → gravação; Google Doc ou .docx cujo nome contém "Anotações do Gemini" (variações de grafia toleradas) → resumo; demais arquivos → ignorados e contabilizados no relatório.
- Extrair do nome do arquivo a data/hora da reunião no padrão "AAAA/MM/DD HH:MM GMT-03:00", respeitando o fuso indicado; quando o nome não seguir o padrão, usar a data de criação do arquivo no Drive como fallback e listar o arquivo no relatório de "data não extraída do nome".
- Registrar cada gravação e cada resumo no armazenamento do Módulo A com: cliente da pasta, tipo, título do arquivo, id do arquivo no Drive, link de visualização do Drive e data/hora extraída.
- Ser idempotente: reexecutar o script atualiza os materiais existentes pelo id do arquivo no Drive, sem duplicar.
- Casar cada material com um encontro: candidatos são os encontros individuais do cliente da pasta; o casamento ocorre quando a data/hora do material cai dentro do período do encontro com tolerância (15 minutos antes do início até 15 minutos após o fim).
- Com exatamente um encontro candidato, vincular o material ao encontro; com zero ou mais de um, deixar o material só no cliente e listá-lo no relatório de "sem encontro casado".
- Permitir múltiplos materiais no mesmo encontro (ex.: gravação + resumo, ou duas gravações da mesma reunião).
- Executar as gravações no banco em transação: falha no meio não deixa importação parcial.
- Imprimir relatório final: pastas casadas / sem correspondência / ambíguas; clientes sem pasta; pastas sem subpasta de gravações; totais de gravações e resumos registrados; arquivos ignorados; arquivos com data de fallback; materiais sem encontro casado (com nome do arquivo e cliente).

---

### Módulo E — Aba "Histórico" na Ficha do Cliente

**Descrição:** Terceira aba na ficha do mentorado (drawer em `components/mentoria-app.tsx`, hoje com "Visão geral" e "Briefing"): linha do tempo completa da jornada, do mais recente ao mais antigo, misturando encontros e materiais do Drive. Os dados são carregados sob demanda ao abrir a aba, no mesmo padrão de `MenteeBriefingPanel`/`loadMenteeMonthMeetings` (consulta dedicada em `lib/supabase/data.ts`), nunca junto do load geral.

**Componentes:**
- Botão de aba "Histórico" ao lado de "Visão geral" e "Briefing" no drawer.
- Painel de linha do tempo: lista vertical de itens ordenada do mais recente ao mais antigo.
- Item de encontro: data e hora, título, selo de tipo (Individual/Grupo, mesmo selo visual já usado), frente, nome do mentor vinculado (ou "Sem mentor").
- Links de materiais dentro do item de encontro: "Assistir gravação" e "Resumo da reunião", abrindo o Drive em nova aba.
- Item de material avulso (sem encontro casado): data, título do arquivo e o link correspondente.
- Estados de carregamento, erro e vazio.

**Comportamentos:**
- Exibir a aba "Histórico" para todo cliente, após "Briefing".
- Carregar os dados apenas quando a aba é aberta, via consulta dedicada sob demanda (não incluir nada disso na carga geral do app).
- Exibir "Carregando..." enquanto a consulta roda e mensagem de erro com possibilidade de tentar de novo se falhar.
- Buscar os encontros do cliente sem limite de data: encontros individuais vinculados ao cliente e encontros (de qualquer tipo) em que o cliente tem participação registrada como presente.
- Deduplicar encontros repetidos entre calendários dos mentores (mesmo título + mesmo início + mesma duração + mesmo tipo — mesma regra da carga geral), preservando o vínculo de mentor de qualquer uma das cópias.
- Buscar todos os materiais do cliente (gravações e resumos) registrados pelo Módulo D.
- Anexar ao item de encontro os materiais vinculados àquele encontro (ou a qualquer uma de suas cópias deduplicadas): link "Assistir gravação" para cada gravação e "Resumo da reunião" para cada resumo.
- Exibir materiais sem encontro vinculado como itens próprios na linha do tempo, posicionados pela sua data/hora.
- Ordenar todos os itens (encontros e materiais avulsos) do mais recente ao mais antigo pela data/hora.
- Exibir em cada encontro: data e hora formatadas, título, tipo, frente e o nome do mentor vinculado; exibir "Sem mentor" quando não houver vínculo.
- Abrir os links de material em nova aba, apontando para o link de visualização do Drive.
- Exibir estado vazio ("Nenhum encontro registrado ainda.") quando o cliente não tem encontros nem materiais.
- Não permitir nenhuma edição a partir da aba (somente leitura nesta fase).

---

### Módulo F — Janela Ativa na Carga Geral (Agenda e Visão geral)

**Descrição:** A carga geral do app (`loadAppData` em `lib/supabase/data.ts`) hoje traz todos os encontros do banco; com o backfill isso significaria milhares de encontros desde 2023 e a Agenda abrindo em fevereiro/2023 (ela seleciona o primeiro grupo de dias da lista). A carga geral passa a trazer apenas os encontros recentes/futuros; o histórico fica exclusivamente na consulta sob demanda da aba "Histórico".

**Componentes:**
- Filtro de data na consulta de encontros da carga geral.

**Comportamentos:**
- Restringir a consulta de encontros da carga geral a encontros com início a partir de agora − 24h (mesma borda inferior da janela ativa do sync), mantendo a ordenação crescente por início.
- Manter a Agenda funcionando sem alterações de tela: com a carga restrita, o primeiro grupo de dias volta a ser o presente/futuro.
- Manter inalterados os comportamentos da Visão geral que derivam da lista de encontros ("Agenda de hoje", métrica "Próximos encontros"), que já filtram para hoje/futuro e não regridem com a carga restrita.
- Não alterar o card "Mentorias do mês" (calculado no servidor, direto no banco): com o backfill ele passa naturalmente a contar também os encontros históricos do mês corrente já realizados — efeito desejado (contagem mais fiel), não regressão.
- Não alterar a consulta "Mentorias deste mês" da ficha (baseada em participações registradas, não afetada pelo backfill).
- Garantir que nenhuma tela além da aba "Histórico" dependa de encontros anteriores a agora − 24h.
