// Definição compartilhada do briefing AE: seções, campos e rótulos (as 29 perguntas).
// Reutilizada pela tela pública (formulário), pela ficha interna (visualização)
// e pela importação da planilha. A ordem dos campos espelha as colunas da planilha.

export type BriefingInputType = "text" | "textarea";

export interface BriefingField {
  key: string;
  label: string;
  type: BriefingInputType;
}

export interface BriefingSection {
  title: string;
  fields: BriefingField[];
}

export const briefingSections: BriefingSection[] = [
  {
    title: "Identificação da marca",
    fields: [
      { key: "brand_name", label: "Qual o nome da sua marca?", type: "text" },
      { key: "niche", label: "Qual o nicho?", type: "text" },
      { key: "founding_year", label: "Ano de fundação da empresa?", type: "text" },
      { key: "location", label: "Estado e cidade:", type: "text" },
    ],
  },
  {
    title: "Estrutura do negócio",
    fields: [
      { key: "physical_stores", label: "Possui loja física? Se sim, quantas? E em qual(is) cidades?", type: "textarea" },
      { key: "business_type", label: "Sua marca é:", type: "text" },
      { key: "employees_count", label: "Quantos funcionários trabalham na sua empresa?", type: "text" },
      { key: "marketing_team", label: "Quantas pessoas estão envolvidas no Marketing da sua empresa e quais suas funções?", type: "textarea" },
      { key: "sales_team", label: "Quantas pessoas estão envolvidas no Comercial da sua empresa e quais suas funções?", type: "textarea" },
    ],
  },
  {
    title: "História e contexto",
    fields: [
      { key: "company_history", label: "Qual a história da sua empresa? Como e por que ela nasceu?", type: "textarea" },
    ],
  },
  {
    title: "Canais e vendas",
    fields: [
      { key: "main_sales_channel", label: "Qual seu principal canal de vendas atual?", type: "text" },
      { key: "online_channels", label: "Dentro do online, selecione o que você usa pra vender?", type: "textarea" },
      { key: "first_purchase_policy", label: "Como funciona sua política de primeira compra?", type: "textarea" },
      { key: "formality_policy", label: "E sua política de formalidade?", type: "text" },
    ],
  },
  {
    title: "Clientes",
    fields: [
      { key: "ideal_customer_profiles", label: "Para quais desses perfis de cliente-ideal você vende? (Pode selecionar mais de um)", type: "textarea" },
      { key: "primary_customer_profile", label: "Entre esses perfis de cliente-ideal, qual representa a maior parte da sua base atual de clientes? (Escolha apenas 1)", type: "text" },
      { key: "recurring_customers_avg", label: "Qual a média de clientes recorrentes ativos você tem? (que compraram nos últimos 3 meses)", type: "text" },
      { key: "new_customers_avg", label: "Qual a média de novos clientes você conquista por mês?", type: "text" },
      { key: "repurchase_behavior", label: "Quem compra pela primeira vez, volta a comprar de novo?", type: "text" },
    ],
  },
  {
    title: "Ações de venda",
    fields: [
      { key: "base_sales_actions", label: "O que você faz para vender para clientes da base?", type: "textarea" },
      { key: "new_sales_actions", label: "O que você faz para vender para novos clientes?", type: "textarea" },
    ],
  },
  {
    title: "Coleções e lançamentos",
    fields: [
      { key: "collection_frequency", label: "Com que frequência lança coleções?", type: "text" },
      { key: "launch_strategy", label: "Qual estratégia você faz para lançar uma nova coleção?", type: "textarea" },
    ],
  },
  {
    title: "Marketing e tráfego",
    fields: [
      { key: "marketing_difficulty", label: "Qual sua maior dificuldade no marketing?", type: "textarea" },
      { key: "paid_traffic", label: "Você faz tráfego pago? Se sim, quanto investe por mês?", type: "textarea" },
    ],
  },
  {
    title: "Relacionamento e funis",
    fields: [
      { key: "whatsapp_leads_group", label: "Você trabalha com grupo de whatsapp de interessados, para gerar novos clientes?", type: "text" },
      { key: "whatsapp_customers_group", label: "Você trabalha com grupo de whatsapp de clientes ativos, para gerar recompra de clientes?", type: "text" },
      { key: "acquisition_funnels", label: "Dentre esses funis (estratégias) para atrair clientes atacado, selecione aqueles que você faz/fez:", type: "textarea" },
    ],
  },
];

// Lista achatada das chaves de resposta, na ordem das seções.
export const briefingFieldKeys: string[] = briefingSections.flatMap((section) =>
  section.fields.map((field) => field.key),
);

// Mapa chave -> rótulo, útil para exibição e importação.
export const briefingLabels: Record<string, string> = Object.fromEntries(
  briefingSections.flatMap((section) => section.fields.map((field) => [field.key, field.label])),
);

export type BriefingAnswers = Partial<Record<string, string>>;
