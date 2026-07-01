import { createClient } from "@supabase/supabase-js";

// Valida o Bearer token da equipe (sessão Supabase) em rotas protegidas.
// Mesmo padrão usado na rota de sync do Calendar.
export type AuthResult = { ok: true } | { ok: false; status: number; error: string };

export async function requireTeamUser(request: Request): Promise<AuthResult> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, status: 401, error: "Não autenticado." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, status: 500, error: "Configuração do servidor incompleta." };

  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, error: "Sessão inválida." };
  return { ok: true };
}
