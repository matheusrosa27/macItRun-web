import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { as, createDb, signUp } from './db.mjs';

async function rejects(promise, message) {
  await assert.rejects(promise, (error) => {
    assert.match(error.message, new RegExp(message));
    return true;
  });
}

const rpc = (tx, fn, args = {}) => {
  const names = Object.keys(args);
  const params = names.map((name, i) => `${name} => $${i + 1}`).join(', ');
  return tx.query(`select public.${fn}(${params}) as r`, Object.values(args)).then((r) => r.rows[0].r);
};

const member = (db, username) =>
  signUp(db, { email: `${username}@example.com`, metadata: { username, terms_accepted: 'true' } });

const likes = async (db, id) =>
  (await db.query('select likes_count from public.profiles where id = $1', [id])).rows[0].likes_count;

let db, ana, profile;
beforeEach(async () => {
  db = await createDb({ seed: true });
  ana = await member(db, 'ana');
  profile = 'darksouls3';
});

describe('curtir', () => {
  test('curtir duas vezes conta uma; descurtir tira', async () => {
    assert.deepEqual(await as(db, ana, (tx) => rpc(tx, 'like_profile', { profile_id: profile })), {
      liked: true,
      likes: 1,
    });
    await as(db, ana, (tx) => rpc(tx, 'like_profile', { profile_id: profile }));
    assert.equal(await likes(db, profile), 1);
    assert.deepEqual(
      await as(db, ana, (tx) => rpc(tx, 'like_profile', { profile_id: profile, liked: false })),
      { liked: false, likes: 0 },
    );
    await as(db, ana, (tx) => rpc(tx, 'like_profile', { profile_id: profile, liked: false }));
    assert.equal(await likes(db, profile), 0);
  });

  test('pessoas diferentes somam', async () => {
    const bia = await member(db, 'bia');
    await as(db, ana, (tx) => rpc(tx, 'like_profile', { profile_id: profile }));
    await as(db, bia, (tx) => rpc(tx, 'like_profile', { profile_id: profile }));
    assert.equal(await likes(db, profile), 2);
  });

  test('sem login, pede login', async () => {
    await rejects(as(db, null, (tx) => rpc(tx, 'like_profile', { profile_id: profile })), 'permission denied');
  });

  test('conta sem nome ou sem termos não curte', async () => {
    const gh = await signUp(db, { email: 'gh@example.com', providers: ['github'] });
    await rejects(as(db, gh, (tx) => rpc(tx, 'like_profile', { profile_id: profile })), 'account_incomplete');
  });

  test('banido não curte', async () => {
    await db.query('update public.users_public set banned = true where id = $1', [ana]);
    await rejects(as(db, ana, (tx) => rpc(tx, 'like_profile', { profile_id: profile })), 'user_banned');
  });

  test('perfil escondido ou inexistente não recebe curtida', async () => {
    await db.query(`update public.profiles set status = 'hidden'`);
    await rejects(as(db, ana, (tx) => rpc(tx, 'like_profile', { profile_id: profile })), 'not_found');
    await rejects(as(db, ana, (tx) => rpc(tx, 'like_profile', { profile_id: 'nada' })), 'not_found');
  });
});

describe('comentar', () => {
  test('comenta, conta e aparece na API como texto puro', async () => {
    const created = await as(db, ana, (tx) =>
      rpc(tx, 'add_comment', { profile_id: profile, body: '  <script>alert(1)</script>\r\nRoda liso.  ' }),
    );
    assert.equal(created.body, '<script>alert(1)</script>\nRoda liso.');
    assert.deepEqual(created.author, { username: 'ana', badges: ['newcomer', 'pioneer'] });
    const list = await as(db, null, (tx) => rpc(tx, 'api_list_comments', { profile_id: profile }));
    assert.deepEqual(list.items.map((c) => c.body), [created.body]);
    const { comments_count } = (
      await db.query('select comments_count from public.profiles where id = $1', [profile])
    ).rows[0];
    assert.equal(comments_count, 1);
  });

  for (const [name, body] of [
    ['vazio', ''],
    ['só espaços', '  \n\t '],
    ['longo demais', 'c'.repeat(2001)],
    ['caractere de controle', 'oi\u0000'],
    ['outro controle', 'oi\u001b[31m'],
    ['separador de linha', 'oi tchau'],
  ]) {
    test(`recusa comentário ${name}`, async () => {
      await rejects(
        as(db, ana, (tx) => rpc(tx, 'add_comment', { profile_id: profile, body })),
        name === 'caractere de controle' ? 'comment_invalid|invalid byte sequence|0x00' : 'comment_invalid',
      );
    });
  }

  test('2.000 caracteres passam', async () => {
    await as(db, ana, (tx) => rpc(tx, 'add_comment', { profile_id: profile, body: 'c'.repeat(2000) }));
  });

  test('sem login, conta incompleta ou banido não comenta', async () => {
    await rejects(as(db, null, (tx) => rpc(tx, 'add_comment', { profile_id: profile, body: 'oi' })), 'permission denied');
    const gh = await signUp(db, { email: 'gh@example.com', providers: ['github'] });
    await rejects(as(db, gh, (tx) => rpc(tx, 'add_comment', { profile_id: profile, body: 'oi' })), 'account_incomplete');
    await db.query('update public.users_public set banned = true where id = $1', [ana]);
    await rejects(as(db, ana, (tx) => rpc(tx, 'add_comment', { profile_id: profile, body: 'oi' })), 'user_banned');
  });

  test('não comenta em perfil escondido', async () => {
    await db.query(`update public.profiles set status = 'removed'`);
    await rejects(as(db, ana, (tx) => rpc(tx, 'add_comment', { profile_id: profile, body: 'oi' })), 'not_found');
  });

  test('o autor apaga o próprio comentário; outra pessoa não', async () => {
    const bia = await member(db, 'bia');
    const { id } = await as(db, ana, (tx) => rpc(tx, 'add_comment', { profile_id: profile, body: 'oi' }));
    await rejects(as(db, bia, (tx) => rpc(tx, 'delete_comment', { comment_id: id })), 'not_found');
    await rejects(as(db, null, (tx) => rpc(tx, 'delete_comment', { comment_id: id })), 'permission denied');
    await as(db, ana, (tx) => rpc(tx, 'delete_comment', { comment_id: id }));
    const list = await as(db, null, (tx) => rpc(tx, 'api_list_comments', { profile_id: profile }));
    assert.equal(list.total, 0);
    const { comments_count } = (
      await db.query('select comments_count from public.profiles where id = $1', [profile])
    ).rows[0];
    assert.equal(comments_count, 0);
  });

  test('ninguém escreve direto nas tabelas', async () => {
    await rejects(
      as(db, ana, (tx) =>
        tx.query(`insert into public.comments (profile_id, author_id, body) values ($1, auth.uid(), 'oi')`, [profile]),
      ),
      'permission denied',
    );
    await rejects(
      as(db, ana, (tx) => tx.query('insert into public.likes (user_id, profile_id) values (auth.uid(), $1)', [profile])),
      'permission denied',
    );
  });
});

describe('filtros', () => {
  beforeEach(async () => {
    await db.query(
      `insert into public.profiles (payload, tested_on) values
       ('{"id":"a","name":"Antigo","executables":["a.exe"],"windowsVersion":"win7"}', '{"mac":"Mac15,3"}')`,
    );
  });

  const names = (params) =>
    as(db, null, (tx) => rpc(tx, 'api_list_profiles', params)).then((r) => r.items.map((p) => p.name));

  test('por versão do Windows e por Mac testado', async () => {
    assert.deepEqual(await names({ windows_version: 'win7' }), ['Antigo']);
    assert.deepEqual(await names({ windows_version: 'win10' }), ['Dark Souls III']);
    assert.deepEqual(await names({ mac: 'Mac17,5' }), ['Dark Souls III']);
    assert.deepEqual(await names({ mac: 'Mac15,3', q: 'antigo' }), ['Antigo']);
    assert.deepEqual(await names({ mac: 'Mac15,3', q: 'dark' }), []);
  });

  test('valores dos filtros só de perfis publicados', async () => {
    await db.query(
      `insert into public.profiles (payload, tested_on, status) values
       ('{"id":"h","name":"Escondido","executables":["h.exe"]}', '{"mac":"Mac99,9"}', 'hidden')`,
    );
    assert.deepEqual(await as(db, null, (tx) => rpc(tx, 'api_profile_filters')), {
      macs: ['Mac15,3', 'Mac17,5'],
    });
  });
});
