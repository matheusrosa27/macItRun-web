// A API de ponta a ponta: o handler de verdade sobre o banco em memória (PGlite) com as
// migrações e o seed, lendo como visitante e somando downloads como service_role.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { as, asService, createDb, signUp } from '../../tests/db.mjs';
import { handle, type Clients, type Rpc } from './handler.ts';

const EXAMPLE = readFileSync(
  join(import.meta.dirname, '../../../packages/profile-schema/examples/dark-souls-3.macitrun-profile'),
  'utf8',
);

/**
 * Faz o papel do supabase-js: chama a função SQL com argumentos nomeados, como visitante,
 * como a pessoa (o "token" dos testes é o id dela) ou como service_role.
 */
function rpcOn(db: PGlite, role: 'anon' | 'service' | { userId: string }): Rpc {
  return {
    async rpc(fn, args = {}) {
      const names = Object.keys(args);
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
      const query = (tx: Transaction) => tx.query<{ r: unknown }>(sql, Object.values(args));
      try {
        const result =
          role === 'service'
            ? await asService(db, query)
            : await as(db, role === 'anon' ? null : role.userId, query);
        return { data: result.rows[0].r, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    },
  };
}

let db: PGlite;
let clients: Clients;
beforeEach(async () => {
  db = await createDb({ seed: true });
  clients = {
    reader: rpcOn(db, 'anon'),
    writer: rpcOn(db, 'service'),
    user: (token) => rpcOn(db, { userId: token }),
    // Nos testes, o "token" é o id da pessoa.
    authenticate: async (token) =>
      (await db.query<{ id: string }>('select id from auth.users where id::text = $1', [token])).rows[0]?.id ?? null,
  };
});

const get = (path: string, method = 'GET', init: RequestInit = {}) =>
  handle(
    new Request(`https://fcrrcxelhbdiihxxggur.supabase.co/functions/v1/api${path}`, { method, ...init }),
    clients,
  );
const body = async (response: Response) => JSON.parse(await response.text());

describe('GET /api/v1/profiles/{id}', () => {
  test('devolve o perfil semeado igual ao arquivo, mais os dados da comunidade', async () => {
    const response = await get('/v1/profiles/darksouls3');
    assert.equal(response.status, 200);
    const { community, ...file } = await body(response);
    assert.equal(`${JSON.stringify(file, null, 2)}\n`, EXAMPLE);
    assert.equal(community.id, 'darksouls3');
    assert.equal(community.author, null);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=0, s-maxage=60');
  });

  test('perfil inexistente ou escondido dá 404', async () => {
    await db.query(`update public.profiles set status = 'hidden'`);
    assert.equal((await get('/v1/profiles/darksouls3')).status, 404);
    assert.equal((await get('/v1/profiles/nada')).status, 404);
  });

  test('um perfil fora das regras no banco não é servido', async () => {
    await db.query(
      `insert into public.profiles (id, payload) values ('ruim', '{"id":"x","name":"X","executables":["X.exe"],"environment":{"DYLD_INSERT_LIBRARIES":"/a"}}')`,
    );
    assert.equal((await get('/v1/profiles/ruim')).status, 404);
    assert.equal((await get('/v1/profiles/ruim/download')).status, 404);
  });
});

describe('GET /api/v1/profiles/{id}/download', () => {
  test('baixa o arquivo .macitrun-profile, byte a byte igual, e conta 1', async () => {
    const response = await get('/v1/profiles/darksouls3/download');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), EXAMPLE);
    assert.equal(
      response.headers.get('Content-Disposition'),
      'attachment; filename="dark-souls-iii.macitrun-profile"',
    );
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    await get('/v1/profiles/darksouls3/download');
    await get('/v1/profiles/darksouls3/download', 'HEAD');
    const { community } = await body(await get('/v1/profiles/darksouls3'));
    assert.equal(community.downloads, 2);
  });

  test('o download sai mesmo se a contagem falhar', async () => {
    clients.writer = { rpc: async () => ({ data: null, error: { message: 'fora do ar' } }) };
    const response = await get('/v1/profiles/darksouls3/download');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), EXAMPLE);
  });
});

describe('GET /api/v1/profiles', () => {
  test('lista e busca', async () => {
    const response = await get('/v1/profiles?q=dark%20souls&graphics=dxvk&sort=recent&page=1');
    assert.equal(response.status, 200);
    const list = await body(response);
    assert.deepEqual(list.items.map((p: { id: string }) => p.id), ['darksouls3']);
    assert.deepEqual([list.page, list.pageSize, list.total], [1, 20, 1]);
    assert.equal((await body(await get('/v1/profiles?q=zelda'))).total, 0);
    assert.equal((await body(await get('/v1/profiles/'))).total, 1);
  });

  for (const [query, parameter] of [
    ['sort=nome', 'sort'],
    ['graphics=metal', 'graphics'],
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=abc', 'page'],
    ['page=1001', 'page'],
    [`q=${'a'.repeat(101)}`, 'q'],
  ]) {
    test(`parâmetro inválido: ${query.slice(0, 20)}`, async () => {
      const response = await get(`/v1/profiles?${query}`);
      assert.equal(response.status, 400);
      assert.deepEqual(await body(response), { error: 'invalid_parameter', parameter });
    });
  }
});

describe('GET /api/v1/profiles/{id}/comments', () => {
  test('comentários visíveis', async () => {
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values
       ('00000000-0000-0000-0000-000000000001', 'ana@example.com', '{"username":"ana"}')`,
    );
    await db.query(
      `insert into public.comments (profile_id, author_id, body, status) values
       ('darksouls3', '00000000-0000-0000-0000-000000000001', '<b>roda</b>', 'visible'),
       ('darksouls3', '00000000-0000-0000-0000-000000000001', 'escondido', 'hidden')`,
    );
    const list = await body(await get('/v1/profiles/darksouls3/comments'));
    assert.equal(list.total, 1);
    // Texto puro: chega como foi escrito; quem exibe trata como texto.
    assert.equal(list.items[0].body, '<b>roda</b>');
    assert.deepEqual(list.items[0].author, { username: 'ana', badges: ['newcomer', 'pioneer'] });
    assert.equal((await get('/v1/profiles/nada/comments')).status, 404);
  });
});

describe('rotas e métodos', () => {
  test('rota desconhecida dá 404', async () => {
    for (const path of ['/v1/outra', '/v2/profiles', '/v1/profiles/darksouls3/likes', '/v1/profiles/A%20B']) {
      assert.equal((await get(path)).status, 404, path);
    }
  });

  test('método não aceito dá 405 com os aceitos', async () => {
    const response = await get('/v1/profiles/darksouls3', 'POST');
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD, OPTIONS');
    assert.equal((await get('/v1/reports')).status, 405);
  });

  test('erro no banco dá 500 sem detalhes', async () => {
    clients.reader = { rpc: async () => ({ data: null, error: { message: 'segredo interno' } }) };
    const response = await get('/v1/profiles');
    assert.equal(response.status, 500);
    assert.deepEqual(await body(response), { error: 'internal_error' });
  });
});

describe('curtir e comentar pela API', () => {
  let ana: string;
  beforeEach(async () => {
    ana = await signUp(db, { email: 'ana@example.com', metadata: { username: 'ana', terms_accepted: 'true' } });
  });
  const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

  test('sem login, curtir pede login', async () => {
    const response = await get('/v1/profiles/darksouls3/like', 'POST');
    assert.equal(response.status, 401);
    assert.deepEqual(await body(response), { error: 'not_authenticated' });
  });

  test('curtir duas vezes conta uma; descurtir tira', async () => {
    assert.deepEqual(await body(await get('/v1/profiles/darksouls3/like', 'POST', auth(ana))), { liked: true, likes: 1 });
    assert.deepEqual(await body(await get('/v1/profiles/darksouls3/like', 'POST', auth(ana))), { liked: true, likes: 1 });
    assert.deepEqual(await body(await get('/v1/profiles/darksouls3/like', 'DELETE', auth(ana))), { liked: false, likes: 0 });
    assert.equal((await get('/v1/profiles/nada/like', 'POST', auth(ana))).status, 404);
    assert.equal((await get('/v1/profiles/darksouls3/like')).status, 405);
  });

  test('comentar', async () => {
    const response = await get('/v1/profiles/darksouls3/comments', 'POST', {
      ...auth(ana),
      body: JSON.stringify({ body: 'Roda liso.' }),
    });
    assert.equal(response.status, 201);
    assert.equal((await body(response)).body, 'Roda liso.');
    const list = await body(await get('/v1/profiles/darksouls3/comments'));
    assert.equal(list.total, 1);
  });

  for (const [name, init, status, code] of [
    ['sem login', {}, 401, 'not_authenticated'],
    ['corpo que não é JSON', { body: 'oi' }, 400, 'invalid_json'],
    ['sem texto', { body: '{}' }, 400, 'comment_invalid'],
    ['texto vazio', { body: '{"body":"   "}' }, 400, 'comment_invalid'],
    ['corpo grande demais', { body: JSON.stringify({ body: 'x'.repeat(17_000) }) }, 413, 'too_large'],
  ] as const) {
    test(`comentário recusado: ${name}`, async () => {
      const init2 = name === 'sem login' ? { body: '{"body":"oi"}' } : { ...auth(ana), ...init };
      const response = await get('/v1/profiles/darksouls3/comments', 'POST', init2);
      assert.equal(response.status, status);
      assert.deepEqual(await body(response), { error: code });
    });
  }

  test('conta incompleta ou banida recebe 403', async () => {
    const gh = await signUp(db, { email: 'gh@example.com', providers: ['github'] });
    assert.equal((await get('/v1/profiles/darksouls3/like', 'POST', auth(gh))).status, 403);
    await db.query('update public.users_public set banned = true where id = $1', [ana]);
    const response = await get('/v1/profiles/darksouls3/like', 'POST', auth(ana));
    assert.equal(response.status, 403);
    assert.deepEqual(await body(response), { error: 'user_banned' });
  });

  test('token inválido dá 401', async () => {
    clients.user = () => ({ rpc: async () => ({ data: null, error: { message: 'JWT expired' } }) });
    assert.equal((await get('/v1/profiles/darksouls3/like', 'POST', auth('velho'))).status, 401);
  });
});

describe('filtros', () => {
  test('lista por Windows e Mac, e os valores dos filtros', async () => {
    const list = await body(await get('/v1/profiles?windowsVersion=win10&mac=Mac17%2C5'));
    assert.equal(list.total, 1);
    assert.equal((await body(await get('/v1/profiles?windowsVersion=win7'))).total, 0);
    assert.equal((await get('/v1/profiles?windowsVersion=win95')).status, 400);
    assert.deepEqual(await body(await get('/v1/profile-filters')), { macs: ['Mac17,5'] });
  });
});

describe('publicar pela API', () => {
  let ana: string;
  beforeEach(async () => {
    ana = await signUp(db, { email: 'ana@example.com', metadata: { username: 'ana', terms_accepted: 'true' } });
  });
  const post = (path: string, body: unknown, token?: string, headers: Record<string, string> = {}) =>
    get(path, 'POST', {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  test('publica o perfil do Dark Souls 3 e ele aparece na comunidade, igual ao arquivo', async () => {
    const response = await post('/v1/profiles', { file: EXAMPLE, notes: 'Roda liso.' }, ana);
    assert.equal(response.status, 201);
    const { id, slug } = await body(response);
    assert.equal(slug, 'dark-souls-iii');
    const download = await get(`/v1/profiles/${id}/download`);
    assert.equal(await download.text(), EXAMPLE);
    const list = await body(await get('/v1/profiles?q=dark%20souls'));
    assert.equal(list.total, 2);
    const { community } = await body(await get(`/v1/profiles/${id}`));
    assert.deepEqual(community.author, { username: 'ana', badges: ['contributor', 'pioneer'] });
    assert.equal(community.notes, 'Roda liso.');
  });

  test('aceita o arquivo como objeto', async () => {
    assert.equal((await post('/v1/profiles', { file: JSON.parse(EXAMPLE) }, ana)).status, 201);
  });

  test('um perfil com DYLD_INSERT_LIBRARIES é recusado', async () => {
    const file = JSON.parse(EXAMPLE);
    file.profile.environment = { DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib' };
    const response = await post('/v1/profiles', { file }, ana);
    assert.equal(response.status, 400);
    assert.deepEqual(await body(response), {
      error: 'invalid_profile',
      issues: [{ path: 'profile.environment.DYLD_INSERT_LIBRARIES', code: 'environment_not_allowed' }],
    });
    assert.equal((await body(await get('/v1/profiles'))).total, 1);
  });

  for (const [name, payload, status, code] of [
    ['texto que não é JSON', { file: '{"format":' }, 400, 'invalid_profile'],
    ['sem arquivo', {}, 400, 'invalid_profile'],
    ['notas que não são texto', { file: EXAMPLE, notes: 5 }, 400, 'text_invalid'],
    ['notas longas demais', { file: EXAMPLE, notes: 'n'.repeat(2001) }, 400, 'text_invalid'],
    ['arquivo grande demais', { file: 'x'.repeat(17_000) }, 413, 'too_large'],
  ] as const) {
    test(`recusa: ${name}`, async () => {
      const response = await post('/v1/profiles', payload, ana);
      assert.equal(response.status, status);
      assert.equal((await body(response)).error, code);
    });
  }

  test('sem login ou com token que não vale, 401', async () => {
    assert.equal((await post('/v1/profiles', { file: EXAMPLE })).status, 401);
    assert.equal((await post('/v1/profiles', { file: EXAMPLE }, '00000000-0000-0000-0000-000000000000')).status, 401);
  });

  test('conta banida 403; limite diário 429', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await post('/v1/profiles', { file: EXAMPLE }, ana)).status, 201);
    const limited = await post('/v1/profiles', { file: EXAMPLE }, ana);
    assert.equal(limited.status, 429);
    assert.deepEqual(await body(limited), { error: 'daily_limit' });
    await db.query('update public.users_public set banned = true where id = $1', [ana]);
    assert.equal((await post('/v1/profiles', { file: EXAMPLE }, ana)).status, 403);
  });

  test('3 denúncias escondem o perfil', async () => {
    const { id } = await body(await post('/v1/profiles', { file: EXAMPLE }, ana));
    for (const name of ['bia', 'caio', 'duda']) {
      const who = await signUp(db, { email: `${name}@example.com`, metadata: { username: name, terms_accepted: 'true' } });
      const response = await post('/v1/reports', { targetType: 'profile', targetId: id, reason: 'unsafe' }, who);
      assert.equal(response.status, 201);
    }
    assert.equal((await get(`/v1/profiles/${id}`)).status, 404);
  });

  test('denúncia inválida', async () => {
    assert.equal((await post('/v1/reports', { targetType: 'profile', targetId: 'darksouls3', reason: 'spam' })).status, 401);
    assert.equal((await post('/v1/reports', { targetType: 'profile' }, ana)).status, 400);
    assert.equal((await post('/v1/reports', '[]', ana)).status, 400);
  });

  test('limite de escritas por IP', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };
    for (let i = 0; i < 30; i++) {
      await post('/v1/profiles/darksouls3/like', {}, ana, headers);
    }
    const limited = await post('/v1/profiles/darksouls3/like', {}, ana, headers);
    assert.equal(limited.status, 429);
    assert.deepEqual(await body(limited), { error: 'rate_limited' });
    // Outro IP segue normal; o banco só guarda o hash.
    assert.equal((await post('/v1/profiles/darksouls3/like', {}, ana, { 'x-forwarded-for': '198.51.100.1' })).status, 200);
    const keys = await db.query<{ key: string }>('select key from private.rate_limits');
    assert.ok(keys.rows.every((r) => !r.key.includes('203.0.113.7')));
  });
});
