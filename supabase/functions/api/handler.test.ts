// A API de ponta a ponta: o handler de verdade sobre o banco em memória (PGlite) com as
// migrações e o seed, lendo como visitante e somando downloads como service_role.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { as, asService, createDb } from '../../tests/db.mjs';
import { handle, type Clients, type Rpc } from './handler.ts';

const EXAMPLE = readFileSync(
  join(import.meta.dirname, '../../../packages/profile-schema/examples/dark-souls-3.macitrun-profile'),
  'utf8',
);

/** Faz o papel do supabase-js: chama a função SQL com argumentos nomeados. */
function rpcOn(db: PGlite, run: typeof as | typeof asService, role: 'anon' | 'service'): Rpc {
  return {
    async rpc(fn, args = {}) {
      const names = Object.keys(args);
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
      const query = (tx: Transaction) => tx.query<{ r: unknown }>(sql, Object.values(args));
      try {
        const result = role === 'anon' ? await as(db, null, query) : await asService(db, query);
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
  clients = { reader: rpcOn(db, as, 'anon'), writer: rpcOn(db, asService, 'service') };
});

const get = (path: string, method = 'GET') =>
  handle(new Request(`https://fcrrcxelhbdiihxxggur.supabase.co/functions/v1/api${path}`, { method }), clients);
const body = async (response: Response) => JSON.parse(await response.text());

describe('GET /api/v1/profiles/{id}', () => {
  test('devolve o perfil semeado igual ao arquivo, mais os dados da comunidade', async () => {
    const response = await get('/v1/profiles/darksouls3');
    assert.equal(response.status, 200);
    const { community, ...file } = await body(response);
    assert.equal(`${JSON.stringify(file, null, 2)}\n`, EXAMPLE);
    assert.equal(community.id, 'darksouls3');
    assert.equal(community.author, null);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60, s-maxage=60');
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
    assert.deepEqual(list.items[0].author, { username: 'ana' });
    assert.equal((await get('/v1/profiles/nada/comments')).status, 404);
  });
});

describe('rotas e métodos', () => {
  test('rota desconhecida dá 404', async () => {
    for (const path of ['/v1/outra', '/v2/profiles', '/v1/profiles/darksouls3/likes', '/v1/profiles/A%20B']) {
      assert.equal((await get(path)).status, 404, path);
    }
  });

  test('escrita ainda não existe nesta fase', async () => {
    const response = await get('/v1/profiles', 'POST');
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD, OPTIONS');
  });

  test('erro no banco dá 500 sem detalhes', async () => {
    clients.reader = { rpc: async () => ({ data: null, error: { message: 'segredo interno' } }) };
    const response = await get('/v1/profiles');
    assert.equal(response.status, 500);
    assert.deepEqual(await body(response), { error: 'internal_error' });
  });
});
