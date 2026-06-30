export type MeetingFront = "Tráfego" | "Redes sociais" | "Comercial" | "Estratégia";
export type MeetingFrontDb = "trafego" | "redes_sociais" | "comercial" | "estrategia";

const dbToFront: Record<MeetingFrontDb, MeetingFront> = {
  trafego: "Tráfego",
  redes_sociais: "Redes sociais",
  comercial: "Comercial",
  estrategia: "Estratégia",
};

const frontToDb: Record<MeetingFront, MeetingFrontDb> = {
  "Tráfego": "trafego",
  "Redes sociais": "redes_sociais",
  Comercial: "comercial",
  "Estratégia": "estrategia",
};

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function classifyMeetingFront(title: string, description = ""): MeetingFront {
  const text = normalized(`${title} ${description}`);

  if (/(rede social|redes sociais|social media|instagram|conteudo)/.test(text)) return "Redes sociais";
  if (/(trafego|meta ads|google ads|midia paga|ads\b)/.test(text)) return "Tráfego";
  if (/(comercial|vendas|closer|pipeline)/.test(text)) return "Comercial";

  return "Estratégia";
}

export function frontLabelToDb(front: MeetingFront): MeetingFrontDb {
  return frontToDb[front];
}

export function frontDbToLabel(front: MeetingFrontDb): MeetingFront {
  return dbToFront[front];
}
