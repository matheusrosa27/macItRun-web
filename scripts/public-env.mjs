// Gera src/environments/public-env.ts com as chaves PÚBLICAS do site, lidas das variáveis
// de ambiente (Vercel) ou do .env.local (desenvolvimento). Roda antes de build, serve e test.
//
// Só entram chaves feitas para o navegador: a URL e a chave publicável (anon) do Supabase
// e a chave de site do Turnstile. Segredos (service_role, chave secreta do Turnstile) nunca
// passam por aqui.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const env = process.env;
const values = {
  supabaseUrl: origin(env.SUPABASE_URL ?? ''),
  supabaseKey: env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY ?? '',
  turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? '',
};

for (const [name, value] of Object.entries(values)) {
  if (/service_role|sb_secret_/.test(value) || jwtRole(value) === 'service_role') {
    throw new Error(`public-env: ${name} parece uma chave secreta; use a chave publicável (anon).`);
  }
}

const keys = Object.keys(values).map((k) => `'${k}'`).join(' | ');
const dir = join(import.meta.dirname, '..', 'src', 'environments');
await mkdir(dir, { recursive: true });
await writeFile(
  join(dir, 'public-env.ts'),
  `// Gerado por scripts/public-env.mjs. Não edite nem faça commit.\n` +
    `export const PUBLIC_ENV: Readonly<Record<${keys}, string>> = ${JSON.stringify(values, null, 2)};\n`,
);

const missing = Object.entries(values).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) console.log(`public-env: sem ${missing.join(', ')} (contas desligadas no site).`);

/** Só o endereço do projeto: a URL copiada da tela Data API vem com /rest/v1/ no fim. */
function origin(value) {
  if (!value) return '';
  try {
    return new URL(value.trim()).origin;
  } catch {
    throw new Error(`public-env: SUPABASE_URL inválida (${value}).`);
  }
}

/** Papel de uma chave JWT antiga do Supabase (anon/service_role), sem validar a assinatura. */
function jwtRole(value) {
  const payload = value.split('.')[1];
  if (!payload) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).role;
  } catch {
    return undefined;
  }
}
