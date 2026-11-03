import { authErrorKey } from './auth-errors';

describe('authErrorKey', () => {
  it('usa o código do Supabase Auth', () => {
    expect(authErrorKey({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      'auth.errors.invalid_credentials',
    );
  });

  it('usa a mensagem das funções do banco (o code é o SQLSTATE)', () => {
    expect(authErrorKey({ code: '23505', message: 'username_taken' })).toBe('auth.errors.username_taken');
  });

  it('reconhece falha do captcha pela mensagem', () => {
    expect(authErrorKey({ code: 'unexpected_failure', message: 'captcha protection: request disallowed' })).toBe(
      'auth.errors.captcha_failed',
    );
  });

  it('cai no genérico com qualquer outra coisa', () => {
    expect(authErrorKey(new Error('boom'))).toBe('auth.errors.generic');
    expect(authErrorKey(null)).toBe('auth.errors.generic');
  });
});
