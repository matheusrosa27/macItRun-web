import { isPlatformBrowser } from '@angular/common';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_ENV } from '../../../environments/public-env';
import { Lang } from '../i18n/langs';

/** A própria conta, como get_my_account() devolve. */
export interface Account {
  id: string;
  email: string;
  providers: string[];
  username: string | null;
  role: 'user' | 'admin';
  banned: boolean;
  termsAcceptedAt: string | null;
  createdAt: string;
}

/** Logins por outras contas, na ordem dos botões. */
export const OAUTH_PROVIDERS = ['google', 'github'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Erro com `code` igual ao do Supabase, para authErrorKey() traduzir. */
export class AuthError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Contas ligadas só quando o build recebeu a URL e a chave publicável do Supabase. */
export const ACCOUNTS_ENABLED = Boolean(PUBLIC_ENV.supabaseUrl && PUBLIC_ENV.supabaseKey);

/**
 * Login e conta pelo Supabase Auth, só no navegador. O supabase-js é carregado sob demanda
 * depois que a página abre, para não pesar no carregamento inicial; no servidor ninguém
 * está conectado.
 *
 * A sessão fica no armazenamento local do navegador. Os links dos e-mails (confirmação e
 * nova senha) e o retorno do Google e do GitHub chegam com os tokens no fragmento da URL (#), que
 * não vai para o servidor; o supabase-js lê e limpa o fragmento ao iniciar.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly enabled = ACCOUNTS_ENABLED;

  /** Fragmento da URL de chegada, antes de o supabase-js limpá-lo. */
  private readonly arrivalHash = this.browser ? window.location.hash : '';

  /** Chegou pelo link "esqueci a senha" do e-mail. */
  readonly arrivedForRecovery = /(^|[#&])type=recovery(&|$)/.test(this.arrivalHash);
  /** Link de e-mail vencido ou inválido (ex.: "otp_expired"), lido da URL de chegada. */
  readonly arrivalError = new URLSearchParams(this.arrivalHash.slice(1)).get('error_code');

  private readonly _ready = signal(!this.browser || !this.enabled);
  private readonly _session = signal<Session | null>(null);
  private readonly _account = signal<Account | null | undefined>(undefined);

  /** O estado do login já é conhecido (sempre verdadeiro no servidor e sem Supabase). */
  readonly ready = this._ready.asReadonly();
  readonly session = this._session.asReadonly();
  readonly user = computed(() => this._session()?.user ?? null);
  /** undefined enquanto carrega; null sem login. */
  readonly account = this._account.asReadonly();
  /** Falta nome de usuário ou aceite dos termos (cadastro pelo Google ou GitHub). */
  readonly needsSetup = computed(() => {
    const account = this._account();
    return !!account && (!account.username || !account.termsAcceptedAt);
  });

  private readonly client: Promise<SupabaseClient | null> =
    this.browser && this.enabled ? this.start() : Promise.resolve(null);

  private async start(): Promise<SupabaseClient> {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(PUBLIC_ENV.supabaseUrl, PUBLIC_ENV.supabaseKey, {
      auth: {
        // Tokens no fragmento: o link do e-mail funciona mesmo aberto em outro aparelho.
        flowType: 'implicit',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    client.auth.onAuthStateChange((_event, session) => {
      const changedUser = session?.user.id !== this._session()?.user.id;
      this._session.set(session);
      // Fora do callback: chamar o Supabase aqui dentro trava o cliente.
      if (changedUser) setTimeout(() => void this.refreshAccount());
    });
    const { data } = await client.auth.getSession();
    this._session.set(data.session);
    this._ready.set(true);
    return client;
  }

  /** Espera saber se há alguém conectado (para os guards). */
  async whenReady(): Promise<void> {
    await this.client;
  }

  async refreshAccount(): Promise<void> {
    const client = await this.client;
    if (!client || !this._session()) {
      this._account.set(null);
      return;
    }
    const { data, error } = await client.rpc('get_my_account');
    this._account.set(error ? null : ((data as Account | null) ?? null));
  }

  async signUp(input: {
    email: string;
    password: string;
    username: string;
    lang: Lang;
    captchaToken?: string;
  }): Promise<void> {
    const client = await this.api();
    const { error } = await client.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: this.url(input.lang, 'account'),
        captchaToken: input.captchaToken,
        // Lidos pelo gatilho do banco (users_public) e pelos modelos de e-mail.
        data: { username: input.username, terms_accepted: true, lang: input.lang },
      },
    });
    if (error) throw error;
  }

  async signIn(input: { email: string; password: string; captchaToken?: string }): Promise<void> {
    const client = await this.api();
    const { error } = await client.auth.signInWithPassword({
      email: input.email,
      password: input.password,
      options: { captchaToken: input.captchaToken },
    });
    if (error) throw error;
  }

  /** Sai para o GitHub ou o Google e volta para `next` (caminho depois do idioma). */
  async signInWithProvider(provider: OAuthProvider, lang: Lang, next = 'account'): Promise<void> {
    const client = await this.api();
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: this.url(lang, next) },
    });
    if (error) throw error;
  }

  async sendPasswordReset(input: { email: string; lang: Lang; captchaToken?: string }): Promise<void> {
    const client = await this.api();
    const { error } = await client.auth.resetPasswordForEmail(input.email, {
      redirectTo: this.url(input.lang, 'reset-password'),
      captchaToken: input.captchaToken,
    });
    if (error) throw error;
  }

  async updatePassword(password: string): Promise<void> {
    const client = await this.api();
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    const client = await this.client;
    await client?.auth.signOut();
    this._account.set(null);
  }

  async usernameAvailable(name: string): Promise<boolean> {
    const client = await this.api();
    const { data, error } = await client.rpc('username_available', { name });
    if (error) throw error;
    return data === true;
  }

  async setUsername(username: string): Promise<void> {
    await this.call('set_username', { new_username: username });
  }

  async acceptTerms(): Promise<void> {
    await this.call('accept_terms');
  }

  async exportData(): Promise<unknown> {
    return this.call('export_my_data');
  }

  /** Apaga a conta no banco e encerra a sessão local (a do servidor já não existe). */
  async deleteAccount(): Promise<void> {
    // Sem call(): recarregar a conta depois de apagá-la só daria erro.
    const client = await this.api();
    const { error } = await client.rpc('delete_my_account');
    if (error) throw error;
    await client.auth.signOut({ scope: 'local' });
    this._account.set(null);
  }

  private async call(fn: string, args?: Record<string, unknown>): Promise<unknown> {
    const client = await this.api();
    const { data, error } = await client.rpc(fn, args);
    if (error) throw error;
    await this.refreshAccount();
    return data;
  }

  private async api(): Promise<SupabaseClient> {
    const client = await this.client;
    if (!client) throw new AuthError('unavailable');
    return client;
  }

  private url(lang: Lang, path: string): string {
    return `${window.location.origin}/${lang}/${path}`;
  }
}
