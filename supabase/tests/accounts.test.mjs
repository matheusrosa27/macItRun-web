import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { as, createDb, signUp } from './db.mjs';

/** Espera que `promise` falhe com a mensagem dada (ou com uma que a contenha). */
async function rejects(promise, message) {
  await assert.rejects(promise, (error) => {
    assert.match(error.message, new RegExp(message));
    return true;
  });
}

const publicRow = (db, id) =>
  db.query('select * from public.users_public where id = $1', [id]).then((r) => r.rows[0]);

describe('cadastro', () => {
  let db;
  beforeEach(async () => {
    db = await createDb();
  });

  test('por e-mail guarda o nome de usuário e o aceite dos termos', async () => {
    const id = await signUp(db, {
      email: 'ana@example.com',
      metadata: { username: 'Ana_Mac', terms_accepted: 'true' },
    });
    const row = await publicRow(db, id);
    assert.equal(row.username, 'ana_mac');
    assert.equal(row.role, 'user');
    assert.equal(row.banned, false);
    assert.ok(row.terms_accepted_at);
  });

  test('pelo GitHub fica sem nome e sem aceite até completar em /account', async () => {
    const id = await signUp(db, {
      email: 'gh@example.com',
      metadata: { user_name: 'octocat' },
      providers: ['github'],
    });
    const row = await publicRow(db, id);
    assert.equal(row.username, null);
    assert.equal(row.terms_accepted_at, null);
  });

  test('nome já usado, inválido ou reservado não impede o cadastro: fica sem nome', async () => {
    await signUp(db, { email: 'a@example.com', metadata: { username: 'ana' } });
    for (const username of ['ana', 'ANA', 'a', 'com espaço', '-ana', 'admin', 'x'.repeat(21)]) {
      const id = await signUp(db, { email: `${username.length}@example.com`, metadata: { username } });
      assert.equal((await publicRow(db, id)).username, null, username);
    }
  });

  test('o banco recusa nome fora da regra mesmo sem passar pelas funções', async () => {
    const id = await signUp(db, { email: 'a@example.com' });
    await rejects(
      db.query(`update public.users_public set username = 'Maiúscula' where id = $1`, [id]),
      'check constraint',
    );
  });
});

describe('o que o navegador vê', () => {
  let db;
  let ana;
  beforeEach(async () => {
    db = await createDb();
    ana = await signUp(db, { email: 'ana@example.com', metadata: { username: 'ana', terms_accepted: 'true' } });
  });

  test('anônimo lê só id, username e created_at', async () => {
    const rows = await as(db, null, (tx) =>
      tx.query('select id, username, created_at from public.users_public').then((r) => r.rows),
    );
    assert.deepEqual(rows.map((r) => r.username), ['ana']);
    for (const column of ['role', 'banned', 'terms_accepted_at', '*']) {
      await rejects(
        as(db, null, (tx) => tx.query(`select ${column} from public.users_public`)),
        'permission denied',
      );
    }
  });

  test('ninguém escreve direto na tabela, nem a própria pessoa', async () => {
    for (const sql of [
      `update public.users_public set role = 'admin' where id = '${ana}'`,
      `update public.users_public set username = 'outro' where id = '${ana}'`,
      `update public.users_public set banned = false where id = '${ana}'`,
      `delete from public.users_public where id = '${ana}'`,
      `insert into public.users_public (id, username) values (gen_random_uuid(), 'novo')`,
    ]) {
      await rejects(as(db, ana, (tx) => tx.query(sql)), 'permission denied');
    }
  });

  test('anônimo só checa nome livre; o resto pede login', async () => {
    const free = (name) =>
      as(db, null, (tx) => tx.query('select public.username_available($1) as ok', [name])).then(
        (r) => r.rows[0].ok,
      );
    assert.equal(await free('bia'), true);
    assert.equal(await free('ANA'), false);
    assert.equal(await free('admin'), false);
    assert.equal(await free('a b'), false);
    for (const fn of [
      'public.get_my_account()',
      `public.set_username('bia')`,
      'public.accept_terms()',
      'public.export_my_data()',
      'public.delete_my_account()',
    ]) {
      await rejects(as(db, null, (tx) => tx.query(`select ${fn}`)), 'permission denied');
    }
  });

  test('funções internas não ficam expostas', async () => {
    await rejects(
      as(db, ana, (tx) => tx.query(`select private.is_valid_username('x')`)),
      'permission denied',
    );
  });
});

describe('minha conta', () => {
  let db;
  let ana;
  let gh;
  beforeEach(async () => {
    db = await createDb();
    ana = await signUp(db, { email: 'ana@example.com', metadata: { username: 'ana', terms_accepted: 'true' } });
    gh = await signUp(db, { email: 'gh@example.com', providers: ['github'] });
  });

  const call = (user, sql, params) => as(db, user, (tx) => tx.query(sql, params));

  test('get_my_account devolve só a própria conta, com e-mail', async () => {
    const { rows } = await call(ana, 'select public.get_my_account() as a');
    assert.equal(rows[0].a.email, 'ana@example.com');
    assert.equal(rows[0].a.username, 'ana');
    assert.equal(rows[0].a.role, 'user');
    assert.deepEqual(rows[0].a.providers, ['email']);
  });

  test('quem veio do GitHub escolhe nome e aceita os termos', async () => {
    await call(gh, `select public.set_username('Octo')`);
    await call(gh, 'select public.accept_terms()');
    const row = await publicRow(db, gh);
    assert.equal(row.username, 'octo');
    assert.ok(row.terms_accepted_at);
  });

  test('set_username recusa nome inválido, reservado ou de outra pessoa', async () => {
    await rejects(call(gh, `select public.set_username('a')`), 'username_invalid');
    await rejects(call(gh, `select public.set_username('admin')`), 'username_invalid');
    await rejects(call(gh, `select public.set_username(null)`), 'username_invalid');
    await rejects(call(gh, `select public.set_username('ANA')`), 'username_taken');
    assert.equal((await publicRow(db, ana)).username, 'ana');
  });

  test('accept_terms mantém a data do primeiro aceite', async () => {
    const before = (await publicRow(db, ana)).terms_accepted_at;
    await call(ana, 'select public.accept_terms()');
    assert.deepEqual((await publicRow(db, ana)).terms_accepted_at, before);
  });

  test('export_my_data traz conta e dados públicos só da própria pessoa', async () => {
    const { rows } = await call(ana, 'select public.export_my_data() as d');
    const data = rows[0].d;
    assert.equal(data.account.email, 'ana@example.com');
    assert.equal(data.public.username, 'ana');
    assert.ok(!JSON.stringify(data).includes('gh@example.com'));
  });

  test('delete_my_account apaga a pessoa por inteiro e mais ninguém', async () => {
    await db.query(`insert into auth.audit_log_entries (payload) values ($1), ($2)`, [
      { actor_id: ana, actor_username: 'ana@example.com' },
      { actor_id: gh },
    ]);
    await call(ana, 'select public.delete_my_account()');

    const count = async (sql) => Number((await db.query(sql, [ana])).rows[0].n);
    assert.equal(await count('select count(*) n from auth.users where id = $1'), 0);
    assert.equal(await count('select count(*) n from auth.identities where user_id = $1'), 0);
    assert.equal(await count('select count(*) n from public.users_public where id = $1'), 0);
    assert.equal(
      await count(`select count(*) n from auth.audit_log_entries where payload ->> 'actor_id' = $1::text`),
      0,
    );
    // O nome volta a ficar livre e a outra conta continua lá.
    const { rows } = await call(null, `select public.username_available('ana') as ok`);
    assert.equal(rows[0].ok, true);
    assert.ok(await publicRow(db, gh));
    assert.equal(
      Number((await db.query('select count(*) n from auth.audit_log_entries')).rows[0].n),
      1,
    );
  });
});
