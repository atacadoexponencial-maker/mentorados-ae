import { Achievement, Meeting, Mentee, Mentor } from "./types";

export const mentors: Mentor[] = [
  { id: "ma", name: "Marina Alves", initials: "MA", color: "#29473b", contact: "marina@aurea.com" },
  { id: "rc", name: "Rafael Costa", initials: "RC", color: "#7d6b4d", contact: "rafael@aurea.com" },
  { id: "cs", name: "Camila Souza", initials: "CS", color: "#805a51", contact: "camila@aurea.com" },
];

export const mentees: Mentee[] = [
  { id: "ana", name: "Ana Carolina", initials: "AC", company: "Nexo Arquitetura", role: "Fundadora", joinedAt: "2026-01-14", mainMentorId: "ma", otherMentorIds: ["rc"], briefing: "Estruturar a operação comercial e retirar a fundadora do dia a dia operacional. Busca previsibilidade para crescer sem perder a qualidade das entregas.", status: "Ativo", risk: "Baixo", riskReason: "", nextAction: "Revisar plano comercial no próximo encontro", lastParticipation: "2026-06-26", accent: "#c98c69" },
  { id: "bruno", name: "Bruno Martins", initials: "BM", company: "Pulse Health", role: "CEO", joinedAt: "2026-02-03", mainMentorId: "rc", otherMentorIds: ["ma"], briefing: "Validar o novo canal de aquisição B2B e amadurecer a gestão do time de vendas.", status: "Ativo", risk: "Alto", riskReason: "Ausência recorrente nos encontros", nextAction: "Contato individual até 02/07", lastParticipation: "2026-05-28", accent: "#748b7c" },
  { id: "carla", name: "Carla Mendes", initials: "CM", company: "Flora Cosméticos", role: "Diretora", joinedAt: "2026-03-18", mainMentorId: "cs", otherMentorIds: [], briefing: "Organizar indicadores e preparar a expansão para novos pontos de venda.", status: "Ativo", risk: "Médio", riskReason: "Baixa execução do plano de ação", nextAction: "Simplificar entregáveis da próxima quinzena", lastParticipation: "2026-06-12", accent: "#b98b5f" },
  { id: "diego", name: "Diego Freitas", initials: "DF", company: "Norte Log", role: "Sócio", joinedAt: "2025-11-20", mainMentorId: "ma", otherMentorIds: ["cs"], briefing: "Redesenhar responsabilidades entre os sócios e profissionalizar a liderança.", status: "Ativo", risk: "Baixo", riskReason: "", nextAction: "Acompanhar contratação do gerente", lastParticipation: "2026-06-25", accent: "#657f8f" },
  { id: "eduarda", name: "Eduarda Lima", initials: "EL", company: "Alma Studio", role: "Fundadora", joinedAt: "2026-04-07", mainMentorId: "cs", otherMentorIds: ["rc"], briefing: "Reposicionar a marca e elevar ticket médio com uma oferta mais estratégica.", status: "Ativo", risk: "Baixo", riskReason: "", nextAction: "Validar nova proposta com 5 clientes", lastParticipation: "2026-06-24", accent: "#9a7182" },
  { id: "felipe", name: "Felipe Rocha", initials: "FR", company: "Orbe Tech", role: "COO", joinedAt: "2026-01-29", mainMentorId: "rc", otherMentorIds: [], briefing: "Criar cadência de gestão e melhorar a performance das lideranças intermediárias.", status: "Ativo", risk: "Médio", riskReason: "Desengajado nas últimas semanas", nextAction: "Alinhar expectativas em conversa 1:1", lastParticipation: "2026-06-05", accent: "#817b63" },
  { id: "gabriela", name: "Gabriela Nunes", initials: "GN", company: "Casa Uno", role: "CEO", joinedAt: "2025-10-09", mainMentorId: "ma", otherMentorIds: [], briefing: "Consolidar expansão regional e acompanhar margem das novas unidades.", status: "Pausado", risk: "Baixo", riskReason: "", nextAction: "Retomar contato em agosto", lastParticipation: "2026-05-19", accent: "#708b88" },
];

export const meetings: Meeting[] = [
  { id: "m1", title: "Mentoria individual · Ana Carolina", startsAt: "2026-06-30T10:30:00-03:00", duration: 60, meetUrl: "https://meet.google.com/abc-defg-hij", mentorIds: ["ma"], type: "Individual", front: "Estratégia", menteeIds: ["ana"], attendanceRecorded: false },
  { id: "m2", title: "Plantão de Estratégia", startsAt: "2026-06-30T15:00:00-03:00", duration: 90, meetUrl: "https://meet.google.com/str-ateg-ias", mentorIds: ["rc", "cs"], type: "Grupo", front: "Estratégia", menteeIds: [], attendanceRecorded: false },
  { id: "m3", title: "Mentoria individual · Diego Freitas", startsAt: "2026-07-01T09:00:00-03:00", duration: 60, meetUrl: "https://meet.google.com/die-goft-asd", mentorIds: ["ma"], type: "Individual", front: "Estratégia", menteeIds: ["diego"], attendanceRecorded: false },
  { id: "m4", title: "Clínica de Vendas", startsAt: "2026-07-02T14:00:00-03:00", duration: 60, meetUrl: "https://meet.google.com/cli-nicv-end", mentorIds: ["rc"], type: "Grupo", front: "Comercial", menteeIds: [], attendanceRecorded: false },
  { id: "m5", title: "Mentoria individual · Carla Mendes", startsAt: "2026-07-03T11:00:00-03:00", duration: 60, meetUrl: "https://meet.google.com/car-lame-nds", mentorIds: ["cs"], type: "Individual", front: "Estratégia", menteeIds: ["carla"], attendanceRecorded: false },
];

export const achievements: Achievement[] = [
  { id: "a1", menteeId: "ana", date: "2026-06-27", title: "Primeiro mês com meta batida", note: "O novo processo comercial já trouxe previsibilidade.", icon: "trophy" },
  { id: "a2", menteeId: "diego", date: "2026-06-25", title: "Nova liderança contratada", note: "Gerente de operações inicia na próxima semana.", icon: "target" },
  { id: "a3", menteeId: "eduarda", date: "2026-06-23", title: "Reposicionamento aprovado", note: "Nova oferta validada com os primeiros clientes.", icon: "sparkles" },
];
