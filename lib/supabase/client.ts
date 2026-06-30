import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// O schema evolui por migrations; o contrato de domínio tipado vive em database.types.ts.
// O cliente permanece flexível para não bloquear deploys entre uma migration e a regeneração dos tipos.
let client: SupabaseClient<any> | undefined;

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("As variáveis públicas do Supabase não estão configuradas.");
  }

  client ??= createClient(url, anonKey);
  return client;
}
