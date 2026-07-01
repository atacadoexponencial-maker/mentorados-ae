"use client";

import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { briefingSections } from "@/lib/briefing-schema";

interface BriefingData {
  menteeName: string;
  company: string;
  status: "pending" | "filled";
  filledAt: string | null;
  answers: Record<string, string>;
}

export function PublicBriefingForm({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [tokenError, setTokenError] = useState("");
  const [data, setData] = useState<BriefingData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/briefing/${token}`)
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setTokenError("Este link é inválido ou expirou. Confira com a equipe Atacado Exponencial.");
          setLoading(false);
          return;
        }
        const json = (await response.json()) as BriefingData;
        setData(json);
        setAnswers(json.answers ?? {});
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setTokenError("Não foi possível carregar o formulário. Tente novamente em instantes.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  function setField(key: string, value: string) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch(`/api/briefing/${token}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Não foi possível enviar suas respostas.");
      }
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível enviar suas respostas.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="briefing-state"><Sparkles size={22} /><p>Carregando seu briefing...</p></main>;
  if (tokenError) return <main className="briefing-state"><h1>Link indisponível</h1><p>{tokenError}</p></main>;
  if (!data) return null;

  return (
    <main className="briefing-public">
      <header className="briefing-head">
        <span>BRIEFING · ATACADO EXPONENCIAL</span>
        <h1>{data.company || data.menteeName}</h1>
        <p>
          Preencha as informações abaixo para a equipe entender seu momento e te ajudar melhor.
          {data.status === "filled" ? " Você já enviou antes — pode revisar e enviar novamente." : ""}
        </p>
      </header>

      {done ? (
        <div className="briefing-done">
          <span><Check size={22} /></span>
          <h2>Briefing recebido!</h2>
          <p>Suas respostas foram registradas. Obrigado por compartilhar — a equipe já consegue te acompanhar melhor.</p>
          <button className="primary-button" onClick={() => setDone(false)}>Revisar minhas respostas</button>
        </div>
      ) : (
        <form onSubmit={submit}>
          {briefingSections.map((section) => (
            <section className="briefing-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.fields.map((field) => (
                <label className="input-label" key={field.key}>
                  {field.label}
                  {field.type === "textarea" ? (
                    <textarea value={answers[field.key] ?? ""} onChange={(event) => setField(field.key, event.target.value)} />
                  ) : (
                    <input value={answers[field.key] ?? ""} onChange={(event) => setField(field.key, event.target.value)} />
                  )}
                </label>
              ))}
            </section>
          ))}
          {saveError && <div className="auth-error briefing-error">{saveError}</div>}
          <div className="briefing-actions">
            <button className="primary-button" disabled={saving}>{saving ? "Enviando..." : "Enviar briefing"}</button>
          </div>
        </form>
      )}
    </main>
  );
}
