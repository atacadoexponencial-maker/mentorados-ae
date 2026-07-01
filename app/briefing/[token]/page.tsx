import { PublicBriefingForm } from "@/components/public-briefing-form";

export const metadata = {
  title: "Briefing | Atacado Exponencial",
  description: "Preencha seu briefing para a equipe Atacado Exponencial.",
};

export default async function BriefingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicBriefingForm token={token} />;
}
