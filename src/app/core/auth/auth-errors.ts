/**
 * Converte erros do Supabase (Auth e funções do banco) em chaves de tradução
 * `auth.errors.<código>`. Código desconhecido vira `auth.errors.generic`.
 */
const KNOWN = new Set([
  'invalid_credentials',
  'email_not_confirmed',
  'weak_password',
  'same_password',
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'captcha_failed',
  'signup_disabled',
  'email_address_invalid',
  'user_banned',
  'username_taken',
  'username_invalid',
  'not_authenticated',
  'unavailable',
  'account_incomplete',
  'comment_invalid',
  'not_found',
  'text_invalid',
  'own_content',
  'daily_limit',
  'rate_limited',
  'not_admin',
  'too_large',
  'invalid_json',
  'author_not_found',
  'save_limit',
]);

interface ErrorLike {
  code?: unknown;
  message?: unknown;
}

export function authErrorKey(error: unknown): string {
  const { code, message } = (error ?? {}) as ErrorLike;
  // Auth: o código vem em `code`. Banco: as funções levantam a mensagem com o código
  // (ex.: "username_taken") e o Postgres põe o SQLSTATE em `code`.
  for (const candidate of [code, message]) {
    if (typeof candidate === 'string' && KNOWN.has(candidate)) return `auth.errors.${candidate}`;
  }
  if (typeof message === 'string' && /captcha/i.test(message)) return 'auth.errors.captcha_failed';
  return 'auth.errors.generic';
}
