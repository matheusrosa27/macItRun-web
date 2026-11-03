// API pública /api/v1 (contrato na seção "API pública e integração" do plano; o app de Mac
// depende dela). Publicar e denunciar chegam na Fase 5.
//
// GET    /api/v1/profiles?q=&graphics=&sort=likes|recent|downloads&page=   (+ windowsVersion=, mac=)
// GET    /api/v1/profiles/{id}
// GET    /api/v1/profiles/{id}/download
// GET    /api/v1/profiles/{id}/comments?page=
// POST   /api/v1/profiles/{id}/like          (login)
// DELETE /api/v1/profiles/{id}/like          (login)
// POST   /api/v1/profiles/{id}/comments      (login) corpo { "body": "..." }
// GET    /api/v1/profile-filters             valores dos filtros (Macs testados)
//
// Login: `Authorization: Bearer <access token do Supabase>`. As escritas rodam como a pessoa
// e passam pelas funções do banco, que validam tudo de novo.
//
// Fica separado de index.ts (que só existe no Deno) para os testes rodarem no Node.
import {
  GRAPHICS,
  PROFILE_EXTENSION,
  WINDOWS_VERSIONS,
  parseProfileFile,
  serializeProfileFile,
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
}

const SORTS = ['likes', 'recent', 'downloads'];
const MAX_PAGE = 1000;
const MAX_QUERY = 100;
const MAX_BODY_BYTES = 16 * 1024;
const ROUTE =
  /\/v1\/(?:profiles(?:\/([a-z0-9-]{1,32})(?:\/(download|comments|like))?)?|(profile-filters))\/?$/;

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
};

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function handle(request: Request, clients: Clients): Promise<Response> {
  const url = new URL(request.url);
  const match = ROUTE.exec(url.pathname);
  if (!match) return error(404, 'not_found');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const [, id, action, filters] = match;
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const allowed = action === 'like' ? ['POST', 'DELETE'] : action === 'comments' && id ? ['GET', 'POST'] : ['GET'];
  if (!allowed.includes(method)) {
    return error(405, 'method_not_allowed', { Allow: [...allowed, ...(allowed.includes('GET') ? ['HEAD'] : []), 'OPTIONS'].join(', ') });
  }

  try {
    if (filters) return json(await call(clients.reader, 'api_profile_filters', {}), 200, { 'Cache-Control': LIST_CACHE });
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
    if (cause instanceof ApiError) return error(cause.status, cause.code);
    console.error(cause);
    return error(500, 'internal_error');
  }
}

async function listProfiles(params: URLSearchParams, db: Rpc): Promise<Response> {
  const q = params.get('q')?.trim() ?? '';
  const graphics = params.get('graphics') ?? '';
  const windowsVersion = params.get('windowsVersion') ?? '';
  const mac = params.get('mac') ?? '';
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
  if (!SORTS.includes(sort)) return error(400, 'invalid_parameter', {}, 'sort');
  if (page === null) return error(400, 'invalid_parameter', {}, 'page');

  const data = await call(db, 'api_list_profiles', {
    q: q || null,
    graphics: graphics || null,
    sort,
    page,
    windows_version: windowsVersion || null,
    mac: mac || null,
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
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new ApiError(413, 'too_large');
  let body: unknown;
  try {
    body = (JSON.parse(text) as { body?: unknown }).body;
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
  if (typeof body !== 'string') throw new ApiError(400, 'comment_invalid');
  return body;
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
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
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
