import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { as, asService, createDb, signUp } from './db.mjs';

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

const PAYLOAD = { id: 'dark-souls-3', name: 'Dark Souls III', executables: ['DarkSoulsIII.exe'], graphics: 'dxvk' };

const publish = (db, authorId, notes = '') =>
  asService(db, (tx) =>
    rpc(tx, 'publish_profile', { author_id: authorId, payload: PAYLOAD, tested_on: { mac: 'Mac17,5' }, notes }),
  );

const status = async (db, table, id) =>
  (await db.query(`select status from public.${table} where id = $1`, [id])).rows[0].status;

let db, ana, bia, caio, duda;
beforeEach(async () => {
  db = await createDb({ seed: true });
  [ana, bia, caio, duda] = await Promise.all(['ana', 'bia', 'caio', 'duda'].map((u) => member(db, u)));
});

describe('publicar', () => {
  test('a API publica em nome da pessoa e o perfil aparece na comunidade', async () => {
    const { id, slug } = await publish(db, ana, '  Roda liso com DXVK.  ');
    assert.equal(slug, 'dark-souls-iii');
    const found = await as(db, null, (tx) => rpc(tx, 'api_get_profile', { profile_id: id }));
    assert.deepEqual(found.profile, PAYLOAD);
    assert.equal(found.community.notes, 'Roda liso com DXVK.');
    assert.deepEqual(found.community.author, { username: 'ana' });
  });

  test('ninguém publica pelo navegador, nem logado', async () => {
    const args = { author_id: ana, payload: PAYLOAD, tested_on: {}, notes: '' };
    await rejects(as(db, ana, (tx) => rpc(tx, 'publish_profile', args)), 'permission denied');
    await rejects(as(db, null, (tx) => rpc(tx, 'publish_profile', args)), 'permission denied');
  });

  test('conta incompleta ou banida não publica', async () => {
    const gh = await signUp(db, { email: 'gh@example.com', providers: ['github'] });
    await rejects(publish(db, gh), 'account_incomplete');
    await db.query('update public.users_public set banned = true where id = $1', [ana]);
    await rejects(publish(db, ana), 'user_banned');
    await rejects(publish(db, '00000000-0000-0000-0000-000000000000'), 'account_incomplete');
  });

  test('no máximo 10 perfis por dia', async () => {
    for (let i = 0; i < 10; i++) await publish(db, ana);
    await rejects(publish(db, ana), 'daily_limit');
    await publish(db, bia);
  });

  test('notas longas ou com caracteres de controle são recusadas', async () => {
    await rejects(publish(db, ana, 'n'.repeat(2001)), 'text_invalid');
    await rejects(publish(db, ana, 'oi\u001b[31m'), 'text_invalid');
  });

  test('o autor edita as notas e despublica; outra pessoa não', async () => {
    const { id } = await publish(db, ana);
    await as(db, ana, (tx) => rpc(tx, 'update_profile_notes', { profile_id: id, notes: 'Atualizado' }));
    await rejects(as(db, bia, (tx) => rpc(tx, 'update_profile_notes', { profile_id: id, notes: 'x' })), 'not_found');
    await rejects(as(db, bia, (tx) => rpc(tx, 'unpublish_profile', { profile_id: id })), 'not_found');
    const mine = await as(db, ana, (tx) => rpc(tx, 'my_profiles'));
    assert.deepEqual(mine.map((p) => [p.id, p.notes, p.status]), [[id, 'Atualizado', 'published']]);

    await as(db, ana, (tx) => rpc(tx, 'unpublish_profile', { profile_id: id }));
    assert.equal(await status(db, 'profiles', id), 'removed');
    assert.equal(await as(db, null, (tx) => rpc(tx, 'api_get_profile', { profile_id: id })), null);
    // Despublicado não volta a receber notas nem pelo autor.
    await rejects(as(db, ana, (tx) => rpc(tx, 'update_profile_notes', { profile_id: id, notes: 'x' })), 'not_found');
  });
});

describe('limite de comentários', () => {
  test('no máximo 60 por dia', async () => {
    for (let i = 0; i < 60; i++) {
      await db.query(`insert into public.comments (profile_id, author_id, body) values ('darksouls3', $1, 'c')`, [ana]);
    }
    await rejects(
      as(db, ana, (tx) => rpc(tx, 'add_comment', { profile_id: 'darksouls3', body: 'mais um' })),
      'daily_limit',
    );
  });
});

describe('denunciar', () => {
  let profile;
  beforeEach(async () => {
    ({ id: profile } = await publish(db, ana));
  });
  const reportAs = (userId, args) =>
    as(db, userId, (tx) => rpc(tx, 'report', { target_type: 'profile', target_id: profile, reason: 'unsafe', ...args }));

  test('3 denúncias de pessoas diferentes escondem o perfil', async () => {
    assert.deepEqual(await reportAs(bia), { reported: true, hidden: false });
    // A mesma pessoa de novo não conta.
    assert.deepEqual(await reportAs(bia, { reason: 'spam' }), { reported: true, hidden: false });
    assert.deepEqual(await reportAs(caio), { reported: true, hidden: false });
    assert.equal(await status(db, 'profiles', profile), 'published');
    assert.deepEqual(await reportAs(duda, { detail: 'Tem DYLD_INSERT_LIBRARIES' }), { reported: true, hidden: true });
    assert.equal(await status(db, 'profiles', profile), 'hidden');
    assert.equal(await as(db, null, (tx) => rpc(tx, 'api_get_profile', { profile_id: profile })), null);
  });

  test('comentário também some com 3 denúncias', async () => {
    const { id } = await as(db, ana, (tx) => rpc(tx, 'add_comment', { profile_id: profile, body: 'compre agora' }));
    for (const who of [bia, caio, duda]) {
      await as(db, who, (tx) => rpc(tx, 'report', { target_type: 'comment', target_id: String(id), reason: 'spam' }));
    }
    assert.equal(await status(db, 'comments', id), 'hidden');
  });

  test('não denuncia o próprio conteúdo, item escondido ou motivo inventado', async () => {
    await rejects(reportAs(ana), 'own_content');
    await rejects(reportAs(bia, { reason: 'chato' }), 'reports_reason_check');
    await rejects(reportAs(bia, { detail: 'd'.repeat(501) }), 'text_invalid');
    await rejects(
      as(db, bia, (tx) => rpc(tx, 'report', { target_type: 'profile', target_id: 'nada', reason: 'spam' })),
      'not_found',
    );
    await rejects(
      as(db, bia, (tx) => rpc(tx, 'report', { target_type: 'user', target_id: ana, reason: 'spam' })),
      'not_found',
    );
    await rejects(
      as(db, bia, (tx) => rpc(tx, 'report', { target_type: 'comment', target_id: '1; drop', reason: 'spam' })),
      'not_found',
    );
  });

  test('sem login ou banido não denuncia', async () => {
    await rejects(reportAs(null), 'permission denied');
    await db.query('update public.users_public set banned = true where id = $1', [bia]);
    await rejects(reportAs(bia), 'user_banned');
  });

  test('no máximo 20 denúncias por dia', async () => {
    for (let i = 0; i < 20; i++) {
      await db.query(
        `insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'profile', $2, 'spam')`,
        [bia, `x${i}`],
      );
    }
    await rejects(reportAs(bia), 'daily_limit');
  });

  test('quem denuncia não lê as denúncias', async () => {
    await reportAs(bia);
    assert.equal((await as(db, bia, (tx) => tx.query('select * from public.reports'))).rows.length, 0);
  });
});

describe('moderação', () => {
  let admin, profile;
  beforeEach(async () => {
    admin = await member(db, 'chefe');
    await db.query(`update public.users_public set role = 'admin' where id = $1`, [admin]);
    ({ id: profile } = await publish(db, ana));
    for (const who of [bia, caio, duda]) {
      await as(db, who, (tx) => rpc(tx, 'report', { target_type: 'profile', target_id: profile, reason: 'unsafe' }));
    }
  });

  test('só admins usam as funções de moderação', async () => {
    for (const [fn, args] of [
      ['admin_open_reports', {}],
      ['admin_hidden_items', {}],
      ['admin_moderate', { target_type: 'profile', target_id: profile, hide: false }],
      ['admin_set_banned', { user_id: ana, banned: true }],
    ]) {
      await rejects(as(db, bia, (tx) => rpc(tx, fn, args)), 'not_admin');
      await rejects(as(db, null, (tx) => rpc(tx, fn, args)), 'permission denied');
    }
  });

  test('o admin vê as denúncias abertas e os itens escondidos', async () => {
    const open = await as(db, admin, (tx) => rpc(tx, 'admin_open_reports'));
    assert.equal(open.length, 1);
    assert.equal(open[0].count, 3);
    assert.equal(open[0].target.name, 'Dark Souls III');
    assert.equal(open[0].target.author.username, 'ana');
    assert.deepEqual(open[0].reports.map((r) => r.reporter).sort(), ['bia', 'caio', 'duda']);
    const hidden = await as(db, admin, (tx) => rpc(tx, 'admin_hidden_items'));
    assert.deepEqual(hidden.map((h) => h.targetId), [profile]);
  });

  test('restaurar devolve o perfil e resolve as denúncias', async () => {
    await as(db, admin, (tx) => rpc(tx, 'admin_moderate', { target_type: 'profile', target_id: profile, hide: false }));
    assert.equal(await status(db, 'profiles', profile), 'published');
    assert.deepEqual(await as(db, admin, (tx) => rpc(tx, 'admin_open_reports')), []);
    // Denúncias resolvidas não somam com as novas.
    await as(db, bia, (tx) => rpc(tx, 'report', { target_type: 'profile', target_id: profile, reason: 'spam' }));
    assert.equal(await status(db, 'profiles', profile), 'published');
  });

  test('esconder mantém o perfil fora da comunidade', async () => {
    await as(db, admin, (tx) => rpc(tx, 'admin_moderate', { target_type: 'profile', target_id: profile, hide: true }));
    assert.equal(await status(db, 'profiles', profile), 'hidden');
    assert.deepEqual(await as(db, admin, (tx) => rpc(tx, 'admin_open_reports')), []);
  });

  test('banir tira a participação; desbanir devolve', async () => {
    await as(db, admin, (tx) => rpc(tx, 'admin_set_banned', { user_id: ana, banned: true }));
    await rejects(publish(db, ana), 'user_banned');
    await rejects(as(db, ana, (tx) => rpc(tx, 'like_profile', { profile_id: 'darksouls3' })), 'user_banned');
    await as(db, admin, (tx) => rpc(tx, 'admin_set_banned', { user_id: ana, banned: false }));
    await publish(db, ana);
    await rejects(as(db, admin, (tx) => rpc(tx, 'admin_set_banned', { user_id: admin, banned: true })), 'own_content');
  });
});

describe('limite por IP', () => {
  test('conta por janela e recusa acima do limite; só a API chama', async () => {
    const hit = () => asService(db, (tx) => rpc(tx, 'api_rate_limit', { key: 'ip:abc', max_hits: 3, window_seconds: 60 }));
    assert.deepEqual([await hit(), await hit(), await hit(), await hit()], [true, true, true, false]);
    assert.equal(
      await asService(db, (tx) => rpc(tx, 'api_rate_limit', { key: 'ip:outro', max_hits: 3, window_seconds: 60 })),
      true,
    );
    await rejects(
      as(db, ana, (tx) => rpc(tx, 'api_rate_limit', { key: 'x', max_hits: 1, window_seconds: 60 })),
      'permission denied',
    );
  });
});
