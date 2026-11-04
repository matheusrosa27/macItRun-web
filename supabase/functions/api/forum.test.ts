// As rotas do fórum na API (só leitura), com o handler de verdade sobre o banco em memória.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { as, createDb, signUp } from '../../tests/db.mjs';
import { handle, type Clients, type Rpc } from './handler.ts';

function rpcOn(db: PGlite, userId: string | null): Rpc {
  return {
    async rpc(fn, args = {}) {
      const names = Object.keys(args);
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
      try {
        const result = await as(db, userId, (tx: Transaction) => tx.query<{ r: unknown }>(sql, Object.values(args)));
        return { data: result.rows[0].r, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    },
  };
}

let db: PGlite;
let clients: Clients;
let ana: string;
let topicId: string;
beforeEach(async () => {
  db = await createDb({ seed: true });
  clients = {
    reader: rpcOn(db, null),
    writer: rpcOn(db, null),
    user: (token) => rpcOn(db, token),
    authenticate: async () => null,
    loginTokenHash: async () => null,
  };
  ana = await signUp(db, { email: 'ana@example.com', metadata: { username: 'ana', terms_accepted: 'true' } });
  const created = await rpcOn(db, ana).rpc('create_topic', {
    title: 'Steam fica com tela preta',
    body: 'Abro a Steam e a janela fica preta.',
    tags: ['steam', 'launcher'],
    profile_ids: ['darksouls3'],
  });
  topicId = (created.data as { id: string }).id;
  await rpcOn(db, ana).rpc('add_reply', { topic_id: topicId, body: 'Resolvi desligando a aceleração.' });
});
afterEach(() => db.close());

const get = (path: string, method = 'GET') =>
  handle(new Request(`https://fcrrcxelhbdiihxxggur.supabase.co/functions/v1/api${path}`, { method }), clients);

describe('fórum na API', () => {
  test('lista com filtros e cache da CDN', async () => {
    const response = await get('/v1/topics?tag=Steam&profile=darksouls3');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=0, s-maxage=60');
    const body = await response.json();
    assert.equal(body.total, 1);
    assert.equal(body.items[0].id, topicId);
    assert.equal(body.items[0].replies, 1);
    assert.equal((await (await get('/v1/topics?q=photoshop')).json()).total, 0);
    const top = await (await get('/v1/topics?sort=top')).json();
    assert.equal(top.items[0].likes, 0);
    assert.equal(top.items[0].dislikes, 0);
  });

  test('tópico, respostas e tags', async () => {
    const topic = await (await get(`/v1/topics/${topicId}`)).json();
    assert.equal(topic.title, 'Steam fica com tela preta');
    assert.equal(topic.profiles[0].id, 'darksouls3');
    const replies = await (await get(`/v1/topics/${topicId}/replies`)).json();
    assert.equal(replies.items[0].body, 'Resolvi desligando a aceleração.');
    assert.deepEqual(await (await get('/v1/topic-tags')).json(), [
      { tag: 'launcher', count: 1 },
      { tag: 'steam', count: 1 },
    ]);
  });

  test('tópico inexistente ou escondido dá 404', async () => {
    assert.equal((await get('/v1/topics/nada')).status, 404);
    assert.equal((await get('/v1/topics/nada/replies')).status, 404);
    await db.query(`update public.topics set status = 'hidden'`);
    assert.equal((await get(`/v1/topics/${topicId}`)).status, 404);
  });

  test('parâmetros inválidos e métodos que não existem', async () => {
    for (const query of ['sort=likes', 'page=0', `q=${'x'.repeat(101)}`, `tag=${'x'.repeat(61)}`, 'profile=A_B']) {
      const response = await get(`/v1/topics?${query}`);
      assert.equal(response.status, 400, query);
    }
    const post = await get('/v1/topics', 'POST');
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('Allow'), 'GET, HEAD, OPTIONS');
  });
});
