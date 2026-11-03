/**
 * Regra do nome de usuário, igual à de private.is_valid_username na migração
 * supabase/migrations/20261103120000_accounts.sql. O banco é quem decide; esta cópia só
 * dá o aviso antes de enviar.
 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,19}$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

const RESERVED = new Set([
  'admin',
  'administrator',
  'anonymous',
  'api',
  'deleted',
  'help',
  'macitrun',
  'mod',
  'moderator',
  'null',
  'root',
  'soporte',
  'support',
  'suporte',
  'system',
  'undefined',
  'www',
]);

export function normalizeUsername(name: string): string {
  return name.trim().toLowerCase();
}

export function isValidUsername(name: string): boolean {
  const normalized = normalizeUsername(name);
  return USERNAME_PATTERN.test(normalized) && !RESERVED.has(normalized);
}

/**
 * Sugestão a partir do login do GitHub ou do e-mail do Google (ex.: "Octo.Cat" → "octo-cat"),
 * para quem entrou por lá não começar com o campo vazio. Devolve "" se não der um nome válido.
 */
export function suggestUsername(source: string | null | undefined): string {
  const name = (source ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+/, '')
    .slice(0, USERNAME_MAX)
    .replace(/[-_]+$/, '');
  return isValidUsername(name) ? name : '';
}
