// API pública /api/v1 (contrato na seção "API pública e integração" do plano; o app de Mac
// depende dela). Esta fase tem só as leituras; publicar, curtir, comentar e denunciar chegam
// nas fases 4 e 5.
//
// GET /api/v1/profiles?q=&graphics=&sort=likes|recent|downloads&page=
// GET /api/v1/profiles/{id}
// GET /api/v1/profiles/{id}/download
// GET /api/v1/profiles/{id}/comments?page=
//
// Fica separado de index.ts (que só existe no Deno) para os testes rodarem no Node.
import {
  GRAPHICS,
  PROFILE_EXTENSION,
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
}

const SORTS = ['likes', 'recent', 'downloads'];
const MAX_PAGE = 1000;
const MAX_QUERY = 100;
const ROUTE = /\/v1\/profiles(?:\/([a-z0-9-]{1,32})(?:\/(download|comments))?)?\/?$/;

const LIST_CACHE = 'public, max-age=60, s-maxage=60';

export async function handle(request: Request, clients: Clients): Promise<Response> {
  const url = new URL(request.url);
  const match = ROUTE.exec(url.pathname);
  if (!match) return error(404, 'not_found');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return error(405, 'method_not_allowed', { Allow: 'GET, HEAD, OPTIONS' });
  }

  const [, id, action] = match;
  try {
    if (!id) return await listProfiles(url.searchParams, clients.reader);
    if (action === 'comments') return await listComments(id, url.searchParams, clients.reader);
    return await getProfile(id, action === 'download', request.method === 'GET', clients);
  } catch (cause) {
    console.error(cause);
    return error(500, 'internal_error');
  }
}

async function listProfiles(params: URLSearchParams, db: Rpc): Promise<Response> {
  const q = params.get('q')?.trim() ?? '';
  const graphics = params.get('graphics') ?? '';
  const sort = params.get('sort') || 'likes';
  const page = pageParam(params);
  if (q.length > MAX_QUERY) return error(400, 'invalid_parameter', {}, 'q');
  if (graphics && !(GRAPHICS as readonly string[]).includes(graphics)) {
    return error(400, 'invalid_parameter', {}, 'graphics');
  }
  if (!SORTS.includes(sort)) return error(400, 'invalid_parameter', {}, 'sort');
  if (page === null) return error(400, 'invalid_parameter', {}, 'page');

  const data = await call(db, 'api_list_profiles', { q: q || null, graphics: graphics || null, sort, page });
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

async function call(db: Rpc, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

// O app de Mac não precisa de CORS; libera a leitura para quem quiser montar algo em cima.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' };

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
