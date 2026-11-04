import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import { as, asService, createDb, signUp } from './db.mjs';

const EXAMPLE = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../packages/profile-schema/examples/dark-souls-3.macitrun-profile'),
    'utf8',
  ),
);

async function rejects(promise, message) {
  await assert.rejects(promise, (error) => {
    assert.match(error.message, new RegExp(message));
    return true;
  });
}

/** Grava um perfil como a API de publicar (Fase 5) vai gravar: como dona do banco. */
async function publish(db, { name, executables = ['Game.exe'], authorId = null, status = 'published' }) {
  const payload = { id: 'x', name, executables };
  const { rows } = await db.query(
    'insert into public.profiles (payload, author_id, status) values ($1, $2, $3) returning id',
    [payload, authorId, status],
  );
  return rows[0].id;
}

const user = (db, username) =>
  signUp(db, { email: `${username}@example.com`, metadata: { username, terms_accepted: 'true' } });

const rpc = (tx, fn, args = {}) => {
  const names = Object.keys(args);
  const params = names.map((name, i) => `${name} => $${i + 1}`).join(', ');
  return tx.query(`select public.${fn}(${params}) as r`, Object.values(args)).then((r) => r.rows[0].r);
};

describe('perfil semeado', () => {
  test('a API devolve o perfil igual ao arquivo .macitrun-profile', async () => {
    const db = await createDb({ seed: true });
    const result = await as(db, null, (tx) => rpc(tx, 'api_get_profile', { profile_id: 'darksouls3' }));
    const { community, ...file } = result;
    assert.deepEqual(file, EXAMPLE);
    assert.equal(community.slug, 'dark-souls-iii');
    assert.equal(community.author, null);
    assert.equal(community.notes, '');
  });
});

describe('leitura', () => {
  let db, ana, hidden, removed, published;
  beforeEach(async () => {
    db = await createDb();
    ana = await user(db, 'ana');
    published = await publish(db, { name: 'Publicado', authorId: ana });
    hidden = await publish(db, { name: 'Escondido', authorId: ana, status: 'hidden' });
    removed = await publish(db, { name: 'Despublicado', authorId: ana, status: 'removed' });
  });

  test('visitantes só veem os publicados', async () => {
    const rows = await as(db, null, (tx) => tx.query('select id from public.profiles'));
    assert.deepEqual(rows.rows.map((r) => r.id), [published]);
    for (const id of [hidden, removed]) {
      assert.equal(await as(db, null, (tx) => rpc(tx, 'api_get_profile', { profile_id: id })), null);
    }
  });

  test('o autor vê os próprios escondidos; outra pessoa não', async () => {
    const bia = await user(db, 'bia');
    const mine = await as(db, ana, (tx) => tx.query('select id from public.profiles'));
    assert.equal(mine.rows.length, 3);
    const theirs = await as(db, bia, (tx) => tx.query('select id from public.profiles'));
    assert.deepEqual(theirs.rows.map((r) => r.id), [published]);
    // A API pública nunca mostra escondidos, nem ao autor.
    assert.equal(await as(db, ana, (tx) => rpc(tx, 'api_get_profile', { profile_id: hidden })), null);
  });

  test('admins veem tudo', async () => {
    const admin = await user(db, 'chefe');
    await db.query(`update public.users_public set role = 'admin' where id = $1`, [admin]);
    const rows = await as(db, admin, (tx) => tx.query('select id from public.profiles'));
    assert.equal(rows.rows.length, 3);
  });

  test('comentários escondidos e de perfis escondidos não aparecem', async () => {
    const bia = await user(db, 'bia');
    await db.query(
      `insert into public.comments (profile_id, author_id, body, status) values
       ($1, $3, 'visível', 'visible'), ($1, $3, 'escondido', 'hidden'), ($2, $3, 'no escondido', 'visible')`,
      [published, hidden, bia],
    );
    const rows = await as(db, null, (tx) => tx.query('select body from public.comments'));
    assert.deepEqual(rows.rows.map((r) => r.body), ['visível']);
    const api = await as(db, null, (tx) => rpc(tx, 'api_list_comments', { profile_id: published }));
    assert.deepEqual(
      api.items.map((c) => [c.author.username, c.body]),
      [['bia', 'visível']],
    );
    assert.equal(api.total, 1);
    assert.equal(await as(db, null, (tx) => rpc(tx, 'api_list_comments', { profile_id: hidden })), null);
  });

  test('curtidas de outras pessoas, denúncias e downloads não são legíveis', async () => {
    const bia = await user(db, 'bia');
    await db.query('insert into public.likes (user_id, profile_id) values ($1, $2)', [bia, published]);
    await db.query(
      `insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'profile', $2, 'spam')`,
      [bia, published],
    );
    assert.equal((await as(db, ana, (tx) => tx.query('select * from public.likes'))).rows.length, 0);
    assert.equal((await as(db, bia, (tx) => tx.query('select * from public.likes'))).rows.length, 1);
    assert.equal((await as(db, bia, (tx) => tx.query('select * from public.reports'))).rows.length, 0);
    await rejects(as(db, null, (tx) => tx.query('select * from public.likes')), 'permission denied');
    await rejects(as(db, null, (tx) => tx.query('select * from public.reports')), 'permission denied');
    await rejects(as(db, ana, (tx) => tx.query('select * from public.downloads')), 'permission denied');
  });
});

describe('ninguém escreve pelo navegador (publicar e comentar chegam nas fases 4 e 5)', () => {
  let db, ana, id;
  beforeEach(async () => {
    db = await createDb();
    ana = await user(db, 'ana');
    id = await publish(db, { name: 'Jogo', authorId: ana });
  });

  for (const [name, sql] of [
    ['criar perfil', `insert into public.profiles (payload) values ('{"id":"x","name":"X","executables":["X.exe"]}')`],
    ['editar perfil', `update public.profiles set notes = 'oi'`],
    ['apagar perfil', 'delete from public.profiles'],
    ['inflar contadores', 'update public.profiles set likes_count = 999'],
    ['curtir', `insert into public.likes (user_id, profile_id) values (auth.uid(), 'x')`],
    ['comentar', `insert into public.comments (profile_id, author_id, body) values ('x', auth.uid(), 'oi')`],
    ['denunciar', `insert into public.reports (reporter_id, target_type, target_id, reason) values (auth.uid(), 'profile', 'x', 'r')`],
    ['contar download', `insert into public.downloads (profile_id) values ('x')`],
  ]) {
    test(`${name}: recusado`, async () => {
      await rejects(as(db, ana, (tx) => tx.query(sql)), 'permission denied');
    });
  }

  test('só a API (service_role) soma downloads', async () => {
    await rejects(as(db, null, (tx) => rpc(tx, 'record_download', { profile_id: id })), 'permission denied');
    await rejects(as(db, ana, (tx) => rpc(tx, 'record_download', { profile_id: id })), 'permission denied');
    assert.equal(await asService(db, (tx) => rpc(tx, 'record_download', { profile_id: id })), true);
    assert.equal(await asService(db, (tx) => rpc(tx, 'record_download', { profile_id: id })), true);
    assert.equal(await asService(db, (tx) => rpc(tx, 'record_download', { profile_id: 'nada' })), false);
    const profile = (await db.query('select downloads_count from public.profiles where id = $1', [id])).rows[0];
    assert.equal(profile.downloads_count, 2);
    const days = (await db.query('select count from public.downloads where profile_id = $1', [id])).rows;
    assert.deepEqual(days, [{ count: 2 }]);
  });
});

describe('regras do banco', () => {
  let db;
  beforeEach(async () => {
    db = await createDb();
  });

  test('o perfil não muda depois de publicado', async () => {
    const id = await publish(db, { name: 'Jogo' });
    await rejects(
      db.query(`update public.profiles set payload = payload || '{"name":"Outro"}' where id = $1`, [id]),
      'profile_immutable',
    );
    await rejects(
      db.query(`update public.profiles set tested_on = '{"app":"9"}' where id = $1`, [id]),
      'profile_immutable',
    );
    // Notas e situação podem mudar.
    await db.query(`update public.profiles set notes = 'Como foi', status = 'removed' where id = $1`, [id]);
  });

  test('recusa perfil acima de 16 KB', async () => {
    const big = { id: 'x', name: 'X', executables: ['X.exe'], notes: 'n'.repeat(16_400) };
    await rejects(
      db.query('insert into public.profiles (payload) values ($1)', [big]),
      'profiles_size',
    );
  });

  test('recusa perfil sem a forma mínima', async () => {
    await rejects(
      db.query(`insert into public.profiles (payload) values ('{"id":"x","name":"X"}')`),
      'profiles_shape',
    );
  });

  test('recusa comentário vazio ou acima de 2.000 caracteres', async () => {
    const ana = await user(db, 'ana');
    const id = await publish(db, { name: 'Jogo' });
    for (const body of ['', '   ', 'c'.repeat(2001)]) {
      await rejects(
        db.query('insert into public.comments (profile_id, author_id, body) values ($1, $2, $3)', [id, ana, body]),
        'comments_body_check',
      );
    }
  });

  test('curtir duas vezes conta uma', async () => {
    const ana = await user(db, 'ana');
    const id = await publish(db, { name: 'Jogo' });
    await db.query('insert into public.likes (user_id, profile_id) values ($1, $2)', [ana, id]);
    await rejects(
      db.query('insert into public.likes (user_id, profile_id) values ($1, $2)', [ana, id]),
      'duplicate key',
    );
  });

  test('contadores de curtidas e comentários visíveis', async () => {
    const [ana, bia] = [await user(db, 'ana'), await user(db, 'bia')];
    const id = await publish(db, { name: 'Jogo' });
    const counts = async () =>
      (await db.query('select likes_count, comments_count from public.profiles where id = $1', [id])).rows[0];

    await db.query('insert into public.likes (user_id, profile_id) values ($1, $3), ($2, $3)', [ana, bia, id]);
    await db.query('delete from public.likes where user_id = $1', [ana]);
    const { rows } = await db.query(
      `insert into public.comments (profile_id, author_id, body) values ($1, $2, 'a'), ($1, $2, 'b') returning id`,
      [id, ana],
    );
    assert.deepEqual(await counts(), { likes_count: 1, comments_count: 2 });
    await db.query(`update public.comments set status = 'hidden' where id = $1`, [rows[0].id]);
    assert.deepEqual(await counts(), { likes_count: 1, comments_count: 1 });
    await db.query(`update public.comments set status = 'visible' where id = $1`, [rows[0].id]);
    await db.query('delete from public.comments where id = $1', [rows[1].id]);
    assert.deepEqual(await counts(), { likes_count: 1, comments_count: 1 });
  });
});

describe('lista e busca', () => {
  let db, ana;
  beforeEach(async () => {
    db = await createDb({ seed: true });
    ana = await user(db, 'ana_mac');
  });

  const search = (params) =>
    as(db, null, (tx) => rpc(tx, 'api_list_profiles', params)).then((r) => r.items.map((p) => p.name));

  test('"dark souls" acha "DARK SOULS™ III"', async () => {
    await publish(db, { name: 'DARK SOULS™ III', executables: ['DarkSoulsIII.exe'] });
    await publish(db, { name: 'Elden Ring', executables: ['eldenring.exe'] });
    assert.deepEqual((await search({ q: 'dark souls' })).sort(), ['DARK SOULS™ III', 'Dark Souls III']);
    assert.deepEqual((await search({ q: 'dark sou' })).sort(), ['DARK SOULS™ III', 'Dark Souls III']);
  });

  test('busca sem acento, pelo executável e pelo autor', async () => {
    await publish(db, { name: 'Pokémon Ação', executables: ['pkmn.exe'], authorId: ana });
    assert.deepEqual(await search({ q: 'pokemon acao' }), ['Pokémon Ação']);
    assert.deepEqual(await search({ q: 'POKÉMON' }), ['Pokémon Ação']);
    assert.deepEqual(await search({ q: 'pkmn.exe' }), ['Pokémon Ação']);
    assert.deepEqual(await search({ q: 'DarkSoulsIII.exe' }), ['Dark Souls III']);
    assert.deepEqual(await search({ q: 'ana_mac' }), ['Pokémon Ação']);
    assert.deepEqual(await search({ q: 'zelda' }), []);
  });

  test('a busca acompanha a troca do nome do autor', async () => {
    await publish(db, { name: 'Jogo', authorId: ana });
    await db.query(`update public.users_public set username = 'nova' where id = $1`, [ana]);
    assert.deepEqual(await search({ q: 'nova' }), ['Jogo']);
    assert.deepEqual(await search({ q: 'ana_mac' }), []);
  });

  test('busca com símbolos não quebra', async () => {
    for (const q of ["'; drop table x; --", '&|!():*', '   ', '\\']) {
      await search({ q });
    }
  });

  test('filtro por camada gráfica', async () => {
    await db.query(
      `insert into public.profiles (payload) values ('{"id":"x","name":"Metalzinho","executables":["m.exe"],"graphics":"dxmt"}')`,
    );
    assert.deepEqual(await search({ graphics: 'dxmt' }), ['Metalzinho']);
    assert.deepEqual(await search({ graphics: 'dxvk' }), ['Dark Souls III']);
  });

  test('ordem por curtidas, recentes e downloads, com páginas', async () => {
    const [a, b] = [await publish(db, { name: 'A' }), await publish(db, { name: 'B' })];
    await db.query(`update public.profiles set likes_count = 5 where id = $1`, [a]);
    await db.query(`update public.profiles set downloads_count = 9 where id = $1`, [b]);
    assert.deepEqual((await search({ sort: 'likes' }))[0], 'A');
    assert.deepEqual((await search({ sort: 'downloads' }))[0], 'B');
    assert.deepEqual((await search({ sort: 'recent' }))[2], 'Dark Souls III');

    const page = (n) => as(db, null, (tx) => rpc(tx, 'api_list_profiles', { page: n, page_size: 2 }));
    const [first, second] = [await page(1), await page(2)];
    assert.equal(first.total, 3);
    assert.equal(first.items.length, 2);
    assert.equal(second.items.length, 1);
    assert.equal(second.page, 2);
    await rejects(as(db, null, (tx) => rpc(tx, 'api_list_profiles', { sort: 'nome' })), 'invalid_sort');
  });

  test('o resumo traz autor, contadores e onde foi testado', async () => {
    await publish(db, { name: 'Jogo', authorId: ana });
    const { items } = await as(db, null, (tx) => rpc(tx, 'api_list_profiles', { q: 'jogo' }));
    assert.deepEqual(Object.keys(items[0]).sort(), [
      'author', 'comments', 'createdAt', 'downloads', 'executables', 'graphics', 'id', 'likes',
      'name', 'slug', 'testedOn', 'updatedAt', 'windowsVersion',
    ]);
    assert.deepEqual(items[0].author, { username: 'ana_mac', badges: ['contributor', 'pioneer'] });
    assert.equal(items[0].slug, 'jogo');
  });
});

describe('conta', () => {
  let db, ana, bia, profile, other;
  beforeEach(async () => {
    db = await createDb();
    [ana, bia] = [await user(db, 'ana'), await user(db, 'bia')];
    profile = await publish(db, { name: 'Primeiro', authorId: ana });
    other = await publish(db, { name: 'Segundo', authorId: bia });
    await db.query('insert into public.likes (user_id, profile_id) values ($1, $2)', [ana, other]);
    await db.query(`insert into public.comments (profile_id, author_id, body) values ($1, $2, 'oi')`, [other, ana]);
    await db.query(
      `insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'profile', $2, 'spam')`,
      [ana, other],
    );
  });

  test('exportar traz perfis, comentários, curtidas e denúncias', async () => {
    const data = await as(db, ana, (tx) => rpc(tx, 'export_my_data'));
    assert.deepEqual(data.profiles.map((p) => p.file.profile.name), ['Primeiro']);
    assert.deepEqual(data.comments.map((c) => c.body), ['oi']);
    assert.deepEqual(data.likes.map((l) => l.profileId), [other]);
    assert.deepEqual(data.reports.map((r) => r.reason), ['spam']);
  });

  test('apagar mantendo os perfis: ficam como "autor removido"', async () => {
    await as(db, ana, (tx) => rpc(tx, 'delete_my_account'));
    const kept = await as(db, null, (tx) => rpc(tx, 'api_get_profile', { profile_id: profile }));
    assert.equal(kept.community.author, null);
    // A busca pelo nome antigo não acha mais.
    const found = await as(db, null, (tx) => rpc(tx, 'api_list_profiles', { q: 'ana' }));
    assert.equal(found.total, 0);
    await assertNothingLeft(db, ana);
    const counts = (await db.query('select likes_count, comments_count from public.profiles where id = $1', [other])).rows[0];
    assert.deepEqual(counts, { likes_count: 0, comments_count: 0 });
  });

  test('apagar levando os perfis junto', async () => {
    await as(db, ana, (tx) => rpc(tx, 'delete_my_account', { keep_profiles: false }));
    assert.equal((await db.query('select 1 from public.profiles where id = $1', [profile])).rows.length, 0);
    assert.equal((await db.query('select 1 from public.profiles where id = $1', [other])).rows.length, 1);
    await assertNothingLeft(db, ana);
  });
});

async function assertNothingLeft(db, id) {
  for (const [table, column] of [
    ['auth.users', 'id'],
    ['public.users_public', 'id'],
    ['public.profiles', 'author_id'],
    ['public.likes', 'user_id'],
    ['public.comments', 'author_id'],
    ['public.reports', 'reporter_id'],
  ]) {
    const { rows } = await db.query(`select 1 from ${table} where ${column} = $1`, [id]);
    assert.equal(rows.length, 0, `sobrou dado em ${table}`);
  }
}
