"use client";

import { LockKeyhole, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function AuthGate({ children }: { children: (user: { email: string; signOut: () => Promise<void> }) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setChecking(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const { error: authError } = await getSupabaseBrowserClient().auth.signInWithPassword({ email, password });
    if (authError) setError(authError.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : authError.message);
    setSubmitting(false);
  }

  if (checking) return <div className="auth-loading"><span className="brand-mark"><Sparkles size={19} /></span><p>Preparando seu espaço...</p></div>;
  if (session) return children({ email: session.user.email ?? "Equipe", signOut: async () => { await getSupabaseBrowserClient().auth.signOut(); } });

  return <main className="auth-page"><section className="auth-panel"><div className="auth-brand"><img src="/brand/logo-white.png" alt="Atacado Exponencial" /></div><div className="auth-copy"><span>OPERAÇÃO EXPONENCIAL</span><h1>Gestão para quem joga grande.</h1><p>Clientes, encontros e próximos passos em uma operação que não depende de memória.</p></div><footer>Ambiente exclusivo · Atacado Exponencial</footer></section><section className="login-panel"><form onSubmit={login}><span className="login-icon"><img src="/brand/icon-white.png" alt="" /></span><span className="login-eyebrow">ÁREA RESTRITA</span><h2>Entre na operação.</h2><p>Use seu acesso da equipe Atacado Exponencial.</p><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" required autoFocus /></label><label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" required /></label>{error && <div className="auth-error">{error}</div>}<button className="primary-button auth-submit" disabled={submitting}>{submitting ? "Entrando..." : "Entrar na plataforma →"}</button><small className="login-help">O acesso é exclusivo para o time.</small></form></section></main>;
}
