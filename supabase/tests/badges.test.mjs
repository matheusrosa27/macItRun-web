import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { as, createDb, signUp } from './db.mjs';

const rpc = (tx, fn, args = {}) => {
  const names = Object.keys(args);
  const params = names.map((name, i) => `${name} => $${i + 1}`).join(', ');
  return tx.query(`select public.${fn}(${params}) as r`, Object.values(args)).then((r) => r.rows[0].r);
};

const member = (db, username) =>
  signUp(db, { email: `${username}@example.com`, metadata: { username, terms_accepted: 'true' } });

/** Publica `count` perfis da pessoa, com `likes` curtidas no primeiro. */
async function publish(db, authorId, count, likes = 0) {
  for (let i = 0; i < count; i++) {
    await db.query(
      `insert into public.profiles (payload, author_id, likes_count) values ($1, $2, $3)`,
      [{ id: 'x', name: `Jogo ${i}`, executables: ['x.exe'] }, authorId, i === 0 ? likes : 0],
    );
  }
}

const badgesOf = async (db, userId) => {
  const id = await db.query(
    `insert into public.profiles (payload, author_id, status) values ('{"id":"b","name":"B","executables":["b.exe"]}', $1, 'removed') returning id`,
    [userId],
  );
  // Lê pela própria conta (get_my_account), como /account faz.
  const account = await as(db, userId, (tx) => rpc(tx, 'get_my_account'));
  await db.query('delete from public.profiles where id = $1', [id.rows[0].id]);
  return account.badges;
};

let db;
beforeEach(async () => {
  db = await createDb({ seed: true });
});

describe('tags', () => {
  test('nível pelo que publicou e pelas curtidas recebidas', async () => {
    const [nova, um, cinco, vinte, curtido] = await Promise.all(
      ['nova', 'um', 'cinco', 'vinte', 'curtido'].map((u) => member(db, u)),
    );
    await publish(db, um, 1);
    await publish(db, cinco, 5);
    await publish(db, vinte, 20);
    await publish(db, curtido, 1, 100);
    assert.deepEqual(await badgesOf(db, nova), ['newcomer', 'pioneer']);
    assert.deepEqual(await badgesOf(db, um), ['contributor', 'pioneer']);
    assert.deepEqual(await badgesOf(db, cinco), ['veteran', 'pioneer']);
    assert.deepEqual(await badgesOf(db, vinte), ['legend', 'pioneer']);
    assert.deepEqual(await badgesOf(db, curtido), ['legend', 'pioneer']);
  });

  test('perfis despublicados ou escondidos não contam', async () => {
    const ana = await member(db, 'ana');
    await publish(db, ana, 5);
    await db.query(`update public.profiles set status = 'hidden' where author_id = $1`, [ana]);
    assert.deepEqual(await badgesOf(db, ana), ['newcomer', 'pioneer']);
  });

  test('admin aparece para todos, primeiro', async () => {
    const chefe = await member(db, 'chefe');
    await db.query(`update public.users_public set role = 'admin' where id = $1`, [chefe]);
    await db.query(`insert into public.comments (profile_id, author_id, body) values ('darksouls3', $1, 'oi')`, [chefe]);
    const list = await as(db, null, (tx) => rpc(tx, 'api_list_comments', { profile_id: 'darksouls3' }));
    assert.deepEqual(list.items[0].author, { username: 'chefe', badges: ['admin', 'newcomer', 'pioneer'] });
  });

  test('pioneiro só nas 100 primeiras contas', async () => {
    await db.query(`
      insert into auth.users (email, raw_user_meta_data)
      select 'user' || i || '@example.com', jsonb_build_object('username', 'user' || i)
      from generate_series(1, 100) i`);
    await db.query(`
      update public.users_public
      set created_at = now() - interval '1 day' + substr(username, 5)::int * interval '1 second'`);
    const late = await member(db, 'tarde');
    assert.deepEqual(await badgesOf(db, late), ['newcomer']);
    const first = (await db.query(`select id from public.users_public where username = 'user1'`)).rows[0].id;
    assert.deepEqual(await badgesOf(db, first), ['newcomer', 'pioneer']);
  });

  test('o papel continua fora do alcance do navegador', async () => {
    await member(db, 'ana');
    await assert.rejects(as(db, null, (tx) => tx.query('select role from public.users_public')), /permission denied/);
  });
});
