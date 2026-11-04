// API pública /api/v1 (contrato na seção "API pública e integração" do plano; o app de Mac
// depende dela).
//
// GET    /api/v1/profiles?q=&graphics=&sort=likes|recent|downloads&page=   (+ windowsVersion=, mac=, store=)
// GET    /api/v1/profiles/{id}
// GET    /api/v1/profiles/{id}/download
// GET    /api/v1/profiles/{id}/comments?page=
// POST   /api/v1/profiles/{id}/like          (login)
// DELETE /api/v1/profiles/{id}/like          (login)
// POST   /api/v1/profiles/{id}/comments      (login) corpo { "body": "..." }
// POST   /api/v1/profiles                    (login) publicar: { "file": {...}, "notes": "..." }
// POST   /api/v1/reports                     (login) { "targetType", "targetId", "reason", "detail" }
// PATCH  /api/v1/profiles/{id}               (admin) { "file"?, "notes"?, "status"?, "author"? }
// DELETE /api/v1/profiles/{id}               (admin)
// GET    /api/v1/profile-filters             valores dos filtros (Macs testados)
// POST   /api/v1/app-login                   (login) { "challenge" } → { "code" }: login do app de Mac
// POST   /api/v1/app-login/redeem            { "code", "verifier" } → { "tokenHash" }
//
// Login: `Authorization: Bearer <access token do Supabase>`. As escritas rodam como a pessoa
// e passam pelas funções do banco, que validam tudo de novo.
//
// Fica separado de index.ts (que só existe no Deno) para os testes rodarem no Node.
import {
  GRAPHICS,
  MAX_PROFILE_BYTES,
  PROFILE_EXTENSION,
  REQUIRABLE_APPS,
  WINDOWS_VERSIONS,
  parseProfileFile,
  serializeProfileFile,
  type ProfileIssue,
} from '../../../packages/profile-schema/src/index.ts';

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

/** O pedaço do cliente do Supabase que a API usa. */
export interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
}

export interface Clients {
  /** Chave publicável: lê como visitante, sujeito ao RLS. */
  reader: Rpc;
  /** Chave secreta: só para somar downloads. */
  writer: Rpc;
  /** Chave publicável com o token da pessoa: escreve como ela (auth.uid()). */
  user(token: string): Rpc;
  /** O id da pessoa dona do token, ou null se o token não vale. */
  authenticate(token: string): Promise<string | null>;
  /**
   * Um link de login novo da pessoa (o hash do token, sem mandar e-mail), para o app de Mac
   * ganhar uma sessão própria. null se a conta não tiver e-mail.
   */
  loginTokenHash(userId: string): Promise<string | null>;
}

const SORTS = ['likes', 'recent', 'downloads'];
const MAX_PAGE = 1000;
const MAX_QUERY = 100;
const MAX_BODY_BYTES = 16 * 1024;
/** O arquivo do perfil (até 16 KB) mais as notas (até 2.000 caracteres, até 4 bytes cada). */
const MAX_PUBLISH_BYTES = MAX_PROFILE_BYTES + 9 * 1024;
/** Escritas por IP por minuto (publicar, curtir, comentar, denunciar). */
const WRITES_PER_MINUTE = 30;
const APP_LOGIN = /\/v1\/app-login(\/redeem)?\/?$/;
const ROUTE =
  /\/v1\/(?:profiles(?:\/([a-z0-9-]{1,32})(?:\/(download|comments|like))?)?|(profile-filters)|(reports))\/?$/;

// A CDN (o atalho /api/v1 na Vercel) guarda por 60 s; o navegador sempre pergunta de novo, para
// quem acabou de curtir ou comentar ver o número certo.
const LIST_CACHE = 'public, max-age=0, s-maxage=60';

/** Erros das funções do banco que viram resposta para quem chamou. */
const DB_ERRORS: Record<string, number> = {
  not_authenticated: 401,
  account_incomplete: 403,
  user_banned: 403,
  not_found: 404,
  comment_invalid: 400,
  text_invalid: 400,
  own_content: 403,
  not_admin: 403,
  author_not_found: 400,
  daily_limit: 429,
  invalid_request: 400,
  rate_limited: 429,
};

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: ProfileIssue[];

  constructor(status: number, code: string, issues?: ProfileIssue[]) {
    super(code);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export async function handle(request: Request, clients: Clients): Promise<Response> {
  const url = new URL(request.url);
  const appLogin = APP_LOGIN.exec(url.pathname);
  if (appLogin) return await appLoginRoute(request, clients, Boolean(appLogin[1]));
  const match = ROUTE.exec(url.pathname);
  if (!match) return error(404, 'not_found');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const [, id, action, filters, reports] = match;
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const allowed =
    action === 'like'
      ? ['POST', 'DELETE']
      : reports
        ? ['POST']
        : (action === 'comments' && id) || (!id && !filters)
          ? ['GET', 'POST']
          : id && !action
            ? ['GET', 'PATCH', 'DELETE']
            : ['GET'];
  if (!allowed.includes(method)) {
    return error(405, 'method_not_allowed', { Allow: [...allowed, ...(allowed.includes('GET') ? ['HEAD'] : []), 'OPTIONS'].join(', ') });
  }

  try {
    if (method !== 'GET') await limitByIp(request, clients.writer);
    if (filters) return json(await call(clients.reader, 'api_profile_filters', {}), 200, { 'Cache-Control': LIST_CACHE });
    if (reports) {
      const db = clients.user(bearer(request));
      const body = (await jsonBody(request, MAX_BODY_BYTES)) as Record<string, unknown>;
      const args = {
        target_type: body['targetType'],
        target_id: body['targetId'] === undefined ? undefined : String(body['targetId']),
        reason: body['reason'],
        detail: typeof body['detail'] === 'string' ? body['detail'] : '',
      };
      if (typeof args.target_type !== 'string' || !args.target_id || typeof args.reason !== 'string') {
        throw new ApiError(400, 'invalid_report');
      }
      return json(await call(db, 'report', args), 201, NO_STORE);
    }
    if (!id && method === 'POST') return await publishProfile(request, clients);
    if (id && !action && method === 'PATCH') return await adminUpdate(id, request, clients);
    if (id && !action && method === 'DELETE') {
      await call(clients.user(bearer(request)), 'admin_delete_profile', { profile_id: id });
      return new Response(null, { status: 204, headers: { ...CORS, ...NO_STORE } });
    }
    if (!id) return await listProfiles(url.searchParams, clients.reader);
    if (action === 'like') {
      const db = clients.user(bearer(request));
      return json(await call(db, 'like_profile', { profile_id: id, liked: method === 'POST' }), 200, NO_STORE);
    }
    if (action === 'comments' && method === 'POST') {
      const db = clients.user(bearer(request));
      const body = await commentBody(request);
      return json(await call(db, 'add_comment', { profile_id: id, body }), 201, NO_STORE);
    }
    if (action === 'comments') return await listComments(id, url.searchParams, clients.reader);
    return await getProfile(id, action === 'download', request.method === 'GET', clients);
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.issues
        ? json({ error: cause.code, issues: cause.issues }, cause.status, NO_STORE)
        : error(cause.status, cause.code);
    }
    console.error(cause);
    return error(500, 'internal_error');
  }
}

/**
 * Publicar: valida o arquivo com o schema do perfil (o mesmo do app) e grava como a pessoa do
 * token. Só esta rota grava perfis; o banco não aceita perfil vindo direto do navegador.
 */
async function publishProfile(request: Request, clients: Clients): Promise<Response> {
  const author = await clients.authenticate(bearer(request));
  if (!author) throw new ApiError(401, 'not_authenticated');
  const body = (await jsonBody(request, MAX_PUBLISH_BYTES)) as { file?: unknown; notes?: unknown };
  const notes = body.notes ?? '';
  if (typeof notes !== 'string') throw new ApiError(400, 'text_invalid');

  // O arquivo pode vir como objeto ou como o texto do .macitrun-profile.
  let file = body.file;
  if (typeof file === 'string') {
    if (new TextEncoder().encode(file).length > MAX_PROFILE_BYTES) throw new ApiError(413, 'too_large');
    try {
      file = JSON.parse(file);
    } catch {
      throw new ApiError(400, 'invalid_profile', [{ path: '', code: 'invalid_json' }]);
    }
  } else if (new TextEncoder().encode(JSON.stringify(file ?? null)).length > MAX_PROFILE_BYTES) {
    throw new ApiError(413, 'too_large');
  }
  const result = parseProfileFile(file);
  if (!result.ok) throw new ApiError(400, 'invalid_profile', result.issues);

  const created = await call(clients.writer, 'publish_profile', {
    author_id: author,
    payload: result.file.profile,
    tested_on: result.file.testedOn ?? {},
    notes,
  });
  return json(created, 201, NO_STORE);
}

/**
 * Login do app de Mac (PKCE). O site, com a sessão da pessoa, pede um código para o desafio do
 * app; o app troca o código e o segredo pelo token de um link de login e o confirma no Supabase
 * Auth (/auth/v1/verify), ganhando uma sessão só dele.
 */
async function appLoginRoute(request: Request, clients: Clients, redeem: boolean): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return error(405, 'method_not_allowed', { Allow: 'POST, OPTIONS' });
  try {
    await limitByIp(request, clients.writer);
    const body = (await jsonBody(request, MAX_BODY_BYTES)) as Record<string, unknown>;
    if (redeem) {
      const { code, verifier } = body;
      if (typeof code !== 'string' || typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
        throw new ApiError(400, 'invalid_request');
      }
      const result = await call(clients.writer, 'app_login_redeem', {
        code,
        verifier_hash: await sha256Base64Url(verifier),
      });
      if (!result) return error(400, 'invalid_code');
      return json(result, 200, NO_STORE);
    }
    const user = await clients.authenticate(bearer(request));
    if (!user) throw new ApiError(401, 'not_authenticated');
    const { challenge } = body;
    if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      throw new ApiError(400, 'invalid_request');
    }
    const tokenHash = await clients.loginTokenHash(user);
    if (!tokenHash) throw new ApiError(400, 'no_email');
    const code = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    return json(
      await call(clients.writer, 'app_login_create', { code, user_id: user, challenge, token_hash: tokenHash }),
      201,
      NO_STORE,
    );
  } catch (cause) {
    if (cause instanceof ApiError) return error(cause.status, cause.code);
    console.error(cause);
    return error(500, 'internal_error');
  }
}

async function sha256Base64Url(text: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const STATUSES = ['published', 'hidden', 'removed'];

/**
 * Admin edita um perfil: o arquivo (validado como na publicação), as notas, a situação e o
 * autor (nome de usuário, ou null para "autor removido"). O banco confere se é admin.
 */
async function adminUpdate(id: string, request: Request, clients: Clients): Promise<Response> {
  const admin = await clients.authenticate(bearer(request));
  if (!admin) throw new ApiError(401, 'not_authenticated');
  const body = (await jsonBody(request, MAX_PUBLISH_BYTES)) as Record<string, unknown>;
  const args: Record<string, unknown> = { admin_id: admin, profile_id: id };

  if (body['file'] !== undefined) {
    let file = body['file'];
    if (typeof file === 'string') {
      try {
        file = JSON.parse(file);
      } catch {
        throw new ApiError(400, 'invalid_profile', [{ path: '', code: 'invalid_json' }]);
      }
    }
    if (new TextEncoder().encode(JSON.stringify(file ?? null)).length > MAX_PROFILE_BYTES) {
      throw new ApiError(413, 'too_large');
    }
    const result = parseProfileFile(file);
    if (!result.ok) throw new ApiError(400, 'invalid_profile', result.issues);
    args['payload'] = result.file.profile;
    args['tested_on'] = result.file.testedOn ?? {};
  }
  if (body['notes'] !== undefined) {
    if (typeof body['notes'] !== 'string') throw new ApiError(400, 'text_invalid');
    args['notes'] = body['notes'];
  }
  if (body['status'] !== undefined) {
    if (typeof body['status'] !== 'string' || !STATUSES.includes(body['status'])) {
      throw new ApiError(400, 'invalid_parameter');
    }
    args['status'] = body['status'];
  }
  if ('author' in body) {
    const author = body['author'];
    if (author !== null && typeof author !== 'string') throw new ApiError(400, 'author_not_found');
    args['set_author'] = true;
    args['author'] = typeof author === 'string' && author.trim() ? author.trim() : null;
  }
  return json(await call(clients.writer, 'admin_update_profile', args), 200, NO_STORE);
}

async function listProfiles(params: URLSearchParams, db: Rpc): Promise<Response> {
  const q = params.get('q')?.trim() ?? '';
  const graphics = params.get('graphics') ?? '';
  const windowsVersion = params.get('windowsVersion') ?? '';
  const mac = params.get('mac') ?? '';
  const store = params.get('store') ?? '';
  const sort = params.get('sort') || 'likes';
  const page = pageParam(params);
  if (q.length > MAX_QUERY) return error(400, 'invalid_parameter', {}, 'q');
  if (graphics && !(GRAPHICS as readonly string[]).includes(graphics)) {
    return error(400, 'invalid_parameter', {}, 'graphics');
  }
  if (windowsVersion && !(WINDOWS_VERSIONS as readonly string[]).includes(windowsVersion)) {
    return error(400, 'invalid_parameter', {}, 'windowsVersion');
  }
  if (mac.length > 64) return error(400, 'invalid_parameter', {}, 'mac');
  if (store && !(REQUIRABLE_APPS as readonly string[]).includes(store)) {
    return error(400, 'invalid_parameter', {}, 'store');
  }
  if (!SORTS.includes(sort)) return error(400, 'invalid_parameter', {}, 'sort');
  if (page === null) return error(400, 'invalid_parameter', {}, 'page');

  const data = await call(db, 'api_list_profiles', {
    q: q || null,
    graphics: graphics || null,
    sort,
    page,
    windows_version: windowsVersion || null,
    mac: mac || null,
    store: store || null,
  });
  return json(data, 200, { 'Cache-Control': LIST_CACHE });
}

async function getProfile(
  id: string,
  download: boolean,
  count: boolean,
  clients: Clients,
): Promise<Response> {
  const data = (await call(clients.reader, 'api_get_profile', { profile_id: id })) as {
    community: { slug: string };
  } | null;
  if (!data) return error(404, 'not_found');

  // Servir também valida: um perfil fora das regras não sai da API.
  const { community, ...file } = data;
  const result = parseProfileFile(file);
  if (!result.ok) {
    console.error(`perfil ${id} inválido`, result.issues);
    return error(404, 'not_found');
  }

  if (!download) return json({ ...result.file, community }, 200, { 'Cache-Control': LIST_CACHE });

  // Só GET conta (HEAD não baixa). Contar não pode impedir o download.
  if (count) {
    try {
      await call(clients.writer, 'record_download', { profile_id: id });
    } catch (cause) {
      console.error(cause);
    }
  }
  return new Response(serializeProfileFile(result.file), {
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${community.slug}${PROFILE_EXTENSION}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function listComments(id: string, params: URLSearchParams, db: Rpc): Promise<Response> {
  const page = pageParam(params);
  if (page === null) return error(400, 'invalid_parameter', {}, 'page');
  const data = await call(db, 'api_list_comments', { profile_id: id, page });
  if (!data) return error(404, 'not_found');
  return json(data, 200, { 'Cache-Control': LIST_CACHE });
}

/** Página 1 a 1000; null se vier inválida. */
function pageParam(params: URLSearchParams): number | null {
  const raw = params.get('page');
  if (raw === null || raw === '') return 1;
  if (!/^\d{1,4}$/.test(raw)) return null;
  const page = Number(raw);
  return page >= 1 && page <= MAX_PAGE ? page : null;
}

function bearer(request: Request): string {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) throw new ApiError(401, 'not_authenticated');
  return token;
}

/** O texto do comentário; o banco limpa e valida o resto. */
async function commentBody(request: Request): Promise<string> {
  const { body } = (await jsonBody(request, MAX_BODY_BYTES)) as { body?: unknown };
  if (typeof body !== 'string') throw new ApiError(400, 'comment_invalid');
  return body;
}

async function jsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new ApiError(413, 'too_large');
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
}

/**
 * Limite de escritas por IP. O banco só vê um hash do IP, e a contagem some em um dia.
 * Se a contagem falhar, a escrita segue (os limites por pessoa continuam valendo).
 */
async function limitByIp(request: Request, db: Rpc): Promise<void> {
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!ip) return;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`macitrun:${ip}`));
  const hash = [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  const { data, error } = await db.rpc('api_rate_limit', { key: `write:${hash}`, max_hits: WRITES_PER_MINUTE, window_seconds: 60 });
  if (error) {
    console.error('api_rate_limit', error.message);
    return;
  }
  if (data === false) throw new ApiError(429, 'rate_limited');
}

async function call(db: Rpc, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    const known = Object.keys(DB_ERRORS).find((code) => error.message === code);
    if (known) throw new ApiError(DB_ERRORS[known], known);
    // Token vencido ou inválido: o PostgREST recusa antes de chegar à função.
    if (/JWT|token/i.test(error.message)) throw new ApiError(401, 'not_authenticated');
    throw new Error(`${fn}: ${error.message}`);
  }
  return data;
}

// O app de Mac não precisa de CORS; o site chama a API direto do navegador.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};
const NO_STORE = { 'Cache-Control': 'no-store' };

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function error(status: number, code: string, headers: Record<string, string> = {}, parameter?: string) {
  return json(parameter ? { error: code, parameter } : { error: code }, status, {
    'Cache-Control': 'no-store',
    ...headers,
  });
}
