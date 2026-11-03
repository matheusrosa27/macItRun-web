// Entrada da Edge Function no Deno do Supabase. A lógica fica em handler.ts.
import { createClient } from '@supabase/supabase-js';
import { handle } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

// Projetos novos expõem as chaves novas (JSON com "default"); os antigos, anon e service_role.
function key(newName: string, legacyName: string): string {
  const keys = Deno.env.get(newName);
  if (keys) {
    const value = JSON.parse(keys).default;
    if (value) return value;
  }
  const legacy = Deno.env.get(legacyName);
  if (!legacy) throw new Error(`Sem ${newName} nem ${legacyName}`);
  return legacy;
}

const clients = {
  reader: createClient(url, key('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), options),
  writer: createClient(url, key('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), options),
};

Deno.serve((request) => handle(request, clients));
