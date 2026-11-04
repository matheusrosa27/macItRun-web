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

const topic = (db, userId, changes = {}) =>
  as(db, userId, (tx) =>
    rpc(tx, 'create_topic', {
      title: 'Dark Souls III trava no chefe',
      body: 'Com DXMT o jogo fecha na animação de morte.',
      tags: ['Dark Souls III', 'crash'],
      profile_ids: [],
      ...changes,
    }),
  );

const row = async (db, table, id) => (await db.query(`select * from public.${table} where id = $1`, [id])).rows[0];

let db, ana, bia;
beforeEach(async () => {
  db = await createDb({ seed: true });
  ana = await member(db, 'ana');
  bia = await member(db, 'bia');
});

describe('criar tópico', () => {
  test('cria com slug, tags normalizadas e perfis citados; aparece na API', async () => {
    const { id, slug } = await topic(db, ana, {
      title: '  Dark Souls III\n  trava no chefe  ',
      tags: ['Dark Souls III', 'dark souls iii', ' Áudio/Som ', ''],
      profile_ids: ['darksouls3', 'darksouls3'],
    });
    assert.equal(slug, 'dark-souls-iii-trava-no-chefe');
    const found = await as(db, null, (tx) => rpc(tx, 'api_get_topic', { topic_id: id }));
    assert.equal(found.title, 'Dark Souls III trava no chefe');
    assert.deepEqual(found.tags, ['dark-souls-iii', 'audio-som']);
    assert.equal(found.profiles.length, 1);
    assert.equal(found.profiles[0].id, 'darksouls3');
    assert.equal(found.author.username, 'ana');
    assert.equal(found.replies, 0);
    assert.equal(found.editedAt, null);
    assert.equal(found.excerpt, undefined);
  });

  for (const [name, changes, error] of [
    ['título curto', { title: 'oi' }, 'title_invalid'],
    ['título longo', { title: 'x'.repeat(121) }, 'title_invalid'],
    ['texto vazio', { body: '  \n ' }, 'body_invalid'],
    ['texto longo', { body: 'x'.repeat(10001) }, 'body_invalid'],
    ['texto com controle', { body: 'a\u0007b' }, 'body_invalid'],
    ['tags demais', { tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'tags_invalid'],
    ['tag longa', { tags: ['x'.repeat(31)] }, 'tags_invalid'],
    ['perfil inexistente', { profile_ids: ['nada'] }, 'profiles_invalid'],
    ['perfis demais', { profile_ids: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'profiles_invalid'],
  ]) {
    test(`recusa ${name}`, async () => {
      await rejects(topic(db, ana, changes), error);
    });
  }

  test('não cita perfil escondido', async () => {
    await db.query(`update public.profiles set status = 'hidden' where id = 'darksouls3'`);
    await rejects(topic(db, ana, { profile_ids: ['darksouls3'] }), 'profiles_invalid');
  });

  test('sem login, conta incompleta ou banido não cria', async () => {
    await rejects(topic(db, null), 'permission denied');
    const gh = await signUp(db, { email: 'gh@example.com', providers: ['github'] });
    await rejects(topic(db, gh), 'account_incomplete');
    await db.query('update public.users_public set banned = true where id = $1', [ana]);
    await rejects(topic(db, ana), 'user_banned');
  });

  test('limite de 10 tópicos por dia', async () => {
    for (let i = 0; i < 10; i++) await topic(db, ana);
    await rejects(topic(db, ana), 'daily_limit');
  });

  test('ninguém escreve direto nas tabelas', async () => {
    await rejects(
      as(db, ana, (tx) =>
        tx.query(`insert into public.topics (author_id, title, body) values ($1, 'abc', 'abc')`, [ana]),
      ),
      'permission denied',
    );
    const { id } = await topic(db, ana);
    await rejects(
      as(db, ana, (tx) => tx.query(`update public.topics set title = 'xyz' where id = $1`, [id])),
      'permission denied',
    );
    await rejects(
      as(db, ana, (tx) =>
        tx.query(`insert into public.topic_replies (topic_id, author_id, body) values ($1, $2, 'x')`, [id, ana]),
      ),
      'permission denied',
    );
  });
});

describe('editar e apagar tópico', () => {
  test('o autor edita; slug, busca e perfis acompanham', async () => {
    const { id } = await topic(db, ana, { profile_ids: ['darksouls3'] });
    const edited = await as(db, ana, (tx) =>
      rpc(tx, 'update_topic', { topic_id: id, title: 'Resolvido: use DXVK', body: 'Troquei para DXVK.', tags: ['dxvk'], profile_ids: [] }),
    );
    assert.equal(edited.slug, 'resolvido-use-dxvk');
    const found = await as(db, null, (tx) => rpc(tx, 'api_get_topic', { topic_id: id }));
    assert.deepEqual(found.tags, ['dxvk']);
    assert.deepEqual(found.profiles, []);
    assert.notEqual(found.editedAt, null);
    const list = await as(db, null, (tx) => rpc(tx, 'api_list_topics', { q: 'resolvido' }));
    assert.equal(list.total, 1);
  });

  test('editar mantém perfil citado que saiu do ar (mas ele some da página)', async () => {
    const { id } = await topic(db, ana, { profile_ids: ['darksouls3'] });
    await db.query(`update public.profiles set status = 'hidden' where id = 'darksouls3'`);
    await as(db, ana, (tx) =>
      rpc(tx, 'update_topic', { topic_id: id, title: 'Outro título', body: 'Outro texto.', tags: [], profile_ids: ['darksouls3'] }),
    );
    const found = await as(db, null, (tx) => rpc(tx, 'api_get_topic', { topic_id: id }));
    assert.deepEqual(found.profiles, []);
  });

  test('outra pessoa não edita nem apaga', async () => {
    const { id } = await topic(db, ana);
    await rejects(
      as(db, bia, (tx) => rpc(tx, 'update_topic', { topic_id: id, title: 'Meu agora', body: 'x', tags: [], profile_ids: [] })),
      'not_found',
    );
    await rejects(as(db, bia, (tx) => rpc(tx, 'delete_topic', { topic_id: id })), 'not_found');
  });

  test('o autor apaga, com respostas e denúncias', async () => {
    const { id } = await topic(db, ana);
    const reply = await as(db, bia, (tx) => rpc(tx, 'add_reply', { topic_id: id, body: 'Aqui também.' }));
    await as(db, bia, (tx) => rpc(tx, 'report', { target_type: 'topic', target_id: id, reason: 'spam' }));
    await as(db, ana, (tx) => rpc(tx, 'report', { target_type: 'reply', target_id: String(reply.id), reason: 'spam' }));
    await as(db, ana, (tx) => rpc(tx, 'delete_topic', { topic_id: id }));
    assert.equal(await row(db, 'topics', id), undefined);
    assert.equal(await row(db, 'topic_replies', reply.id), undefined);
    assert.equal((await db.query('select count(*)::int as n from public.reports')).rows[0].n, 0);
  });
});

describe('responder', () => {
  test('responde, conta, atualiza a atividade e lista em ordem', async () => {
    const { id } = await topic(db, ana);
    const before = (await row(db, 'topics', id)).activity_at;
    const first = await as(db, bia, (tx) => rpc(tx, 'add_reply', { topic_id: id, body: '  <b>Comigo</b>\r\ntambém  ' }));
    assert.equal(first.body, '<b>Comigo</b>\ntambém');
    await as(db, ana, (tx) => rpc(tx, 'add_reply', { topic_id: id, body: 'Valeu!' }));
    const t = await row(db, 'topics', id);
    assert.equal(t.replies_count, 2);
    assert.ok(t.activity_at >= before);
    const replies = await as(db, null, (tx) => rpc(tx, 'api_list_replies', { topic_id: id }));
    assert.equal(replies.total, 2);
    assert.deepEqual(replies.items.map((r) => r.author.username), ['bia', 'ana']);
  });

  test('apagar a própria resposta desconta; outra pessoa não apaga', async () => {
    const { id } = await topic(db, ana);
    const reply = await as(db, bia, (tx) => rpc(tx, 'add_reply', { topic_id: id, body: 'Oi' }));
    await rejects(as(db, ana, (tx) => rpc(tx, 'delete_reply', { reply_id: reply.id })), 'not_found');
    await as(db, bia, (tx) => rpc(tx, 'delete_reply', { reply_id: reply.id }));
    const t = await row(db, 'topics', id);
    assert.equal(t.replies_count, 0);
    assert.equal(t.activity_at.getTime(), t.created_at.getTime());
  });

  test('não responde em tópico escondido; tópico escondido some da API', async () => {
    const { id } = await topic(db, ana);
    await db.query(`update public.topics set status = 'hidden' where id = $1`, [id]);
    await rejects(as(db, bia, (tx) => rpc(tx, 'add_reply', { topic_id: id, body: 'Oi' })), 'not_found');
    assert.equal(await as(db, null, (tx) => rpc(tx, 'api_get_topic', { topic_id: id })), null);
    assert.equal(await as(db, null, (tx) => rpc(tx, 'api_list_replies', { topic_id: id })), null);
    assert.equal((await as(db, null, (tx) => rpc(tx, 'api_list_topics'))).total, 0);
    // O autor ainda vê o próprio tópico pela tabela.
    const own = await as(db, ana, (tx) => tx.query('select id from public.topics where id = $1', [id]));
    assert.equal(own.rows.length, 1);
  });

  test('resposta vazia ou longa é recusada', async () => {
    const { id } = await topic(db, ana);
    await rejects(as(db, bia, (tx) => rpc(tx, 'add_reply', { topic_id: id, body: ' ' })), 'body_invalid');
    await rejects(as(db, bia, (tx) => rpc(tx, 'add_reply', { topic_id: id, body: 'x'.repeat(5001) })), 'body_invalid');
  });
});

describe('lista', () => {
  test('filtra por busca, tag e perfil citado; ordena por atividade, novos e respostas', async () => {
    const a = await topic(db, ana, { title: 'Steam não abre', body: 'Tela preta.', tags: ['steam'] });
    const b = await topic(db, ana, { title: 'Photoshop CS6 funciona', body: 'Roda bem.', tags: ['apps', 'adobe'] });
    const c = await topic(db, bia, { profile_ids: ['darksouls3'] });
    await as(db, bia, (tx) => rpc(tx, 'add_reply', { topic_id: a.id, body: 'Tenta de novo.' }));

    const ids = async (args) => (await as(db, null, (tx) => rpc(tx, 'api_list_topics', args))).items.map((t) => t.id);
    assert.deepEqual(await ids({ q: 'photo' }), [b.id]);
    assert.deepEqual(await ids({ tag: 'Adobe' }), [b.id]);
    assert.deepEqual(await ids({ q: 'dark sou' }), [c.id]);
    assert.deepEqual(await ids({ profile_id: 'darksouls3' }), [c.id]);
    assert.deepEqual(await ids({}), [a.id, c.id, b.id]);
    assert.deepEqual(await ids({ sort: 'recent' }), [c.id, b.id, a.id]);
    assert.deepEqual((await ids({ sort: 'replies' }))[0], a.id);
    await rejects(as(db, null, (tx) => rpc(tx, 'api_list_topics', { sort: 'likes' })), 'invalid_sort');

    const summary = (await as(db, null, (tx) => rpc(tx, 'api_list_topics', { profile_id: 'darksouls3' }))).items[0];
    assert.equal(summary.profiles, 1);
    assert.equal(summary.excerpt, 'Com DXMT o jogo fecha na animação de morte.');
    assert.equal(summary.body, undefined);
  });

  test('tags mais usadas, só de tópicos visíveis', async () => {
    await topic(db, ana, { tags: ['steam', 'crash'] });
    await topic(db, ana, { tags: ['steam'] });
    const hidden = await topic(db, bia, { tags: ['segredo'] });
    await db.query(`update public.topics set status = 'hidden' where id = $1`, [hidden.id]);
    const tags = await as(db, null, (tx) => rpc(tx, 'api_topic_tags'));
    assert.deepEqual(tags, [
      { tag: 'steam', count: 2 },
      { tag: 'crash', count: 1 },
    ]);
  });
});

describe('denúncias e moderação', () => {
  let admin;
  beforeEach(async () => {
    admin = await member(db, 'chefe');
    await db.query(`update public.users_public set role = 'admin' where id = $1`, [admin]);
  });

  test('3 denúncias escondem o tópico; admin restaura', async () => {
    const { id } = await topic(db, ana);
    await rejects(as(db, ana, (tx) => rpc(tx, 'report', { target_type: 'topic', target_id: id, reason: 'spam' })), 'own_content');
    for (const name of ['bia', 'caio', 'duda']) {
      const user = name === 'bia' ? bia : await member(db, name);
      await as(db, user, (tx) => rpc(tx, 'report', { target_type: 'topic', target_id: id, reason: 'spam' }));
    }
    assert.equal((await row(db, 'topics', id)).status, 'hidden');
    const hiddenItems = await as(db, admin, (tx) => rpc(tx, 'admin_hidden_items'));
    assert.equal(hiddenItems[0].targetType, 'topic');
    assert.equal(hiddenItems[0].target.topicId, id);
    await as(db, admin, (tx) => rpc(tx, 'admin_moderate', { target_type: 'topic', target_id: id, hide: false }));
    assert.equal((await row(db, 'topics', id)).status, 'visible');
  });

  test('denúncia de resposta aparece na moderação; admin esconde e apaga', async () => {
    const { id } = await topic(db, ana);
    const reply = await as(db, bia, (tx) => rpc(tx, 'add_reply', { topic_id: id, body: 'compre seguidores' }));
    await as(db, ana, (tx) => rpc(tx, 'report', { target_type: 'reply', target_id: String(reply.id), reason: 'spam' }));
    const open = await as(db, admin, (tx) => rpc(tx, 'admin_open_reports'));
    assert.equal(open[0].targetType, 'reply');
    assert.equal(open[0].target.body, 'compre seguidores');
    assert.equal(open[0].target.topicId, id);
    await as(db, admin, (tx) => rpc(tx, 'admin_moderate', { target_type: 'reply', target_id: String(reply.id), hide: true }));
    assert.equal((await row(db, 'topics', id)).replies_count, 0);
    await as(db, admin, (tx) => rpc(tx, 'admin_delete_reply', { reply_id: reply.id }));
    assert.equal(await row(db, 'topic_replies', reply.id), undefined);
    await as(db, admin, (tx) => rpc(tx, 'admin_delete_topic', { topic_id: id }));
    assert.equal(await row(db, 'topics', id), undefined);
  });

  test('só admins apagam o que é dos outros', async () => {
    const { id } = await topic(db, ana);
    await rejects(as(db, bia, (tx) => rpc(tx, 'admin_delete_topic', { topic_id: id })), 'not_admin');
  });
});

describe('conta', () => {
  test('tópicos e respostas entram na exportação', async () => {
    const { id } = await topic(db, ana, { profile_ids: ['darksouls3'] });
    await as(db, ana, (tx) => rpc(tx, 'add_reply', { topic_id: id, body: 'Atualizando.' }));
    const data = await as(db, ana, (tx) => rpc(tx, 'export_my_data'));
    assert.equal(data.topics[0].id, id);
    assert.deepEqual(data.topics[0].profileIds, ['darksouls3']);
    assert.equal(data.replies[0].body, 'Atualizando.');
  });

  test('apagar a conta mantendo o conteúdo: tópico fica sem autor; respostas saem', async () => {
    const { id } = await topic(db, ana);
    await as(db, ana, (tx) => rpc(tx, 'add_reply', { topic_id: id, body: 'Minha resposta.' }));
    await as(db, bia, (tx) => rpc(tx, 'add_reply', { topic_id: id, body: 'A da Bia.' }));
    await as(db, ana, (tx) => rpc(tx, 'delete_my_account', { keep_profiles: true }));
    const t = await row(db, 'topics', id);
    assert.equal(t.author_id, null);
    assert.equal(t.replies_count, 1);
    const found = await as(db, null, (tx) => rpc(tx, 'api_get_topic', { topic_id: id }));
    assert.equal(found.author, null);
  });

  test('apagar a conta sem manter o conteúdo leva os tópicos', async () => {
    const { id } = await topic(db, ana);
    await as(db, ana, (tx) => rpc(tx, 'delete_my_account', { keep_profiles: false }));
    assert.equal(await row(db, 'topics', id), undefined);
  });
});
