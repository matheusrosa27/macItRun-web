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

let db, ana, bia, caio, topicId, replyId;
beforeEach(async () => {
  db = await createDb({ seed: true });
  [ana, bia, caio] = await Promise.all(['ana', 'bia', 'caio'].map((u) => member(db, u)));
  topicId = (
    await as(db, ana, (tx) =>
      rpc(tx, 'create_topic', { title: 'Steam com tela preta', body: 'A janela fica preta.', tags: ['steam'], profile_ids: [] }),
    )
  ).id;
  replyId = (await as(db, bia, (tx) => rpc(tx, 'add_reply', { topic_id: topicId, body: 'Desliga a aceleração.' }))).id;
});

const topic = (tx) => rpc(tx, 'api_get_topic', { topic_id: topicId });

describe('votar em tópicos', () => {
  test('curtir, trocar para não curtir e tirar o voto', async () => {
    assert.deepEqual(await as(db, bia, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 1 })), {
      vote: 1,
      likes: 1,
      dislikes: 0,
    });
    await as(db, bia, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 1 }));
    await as(db, caio, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 1 }));
    assert.deepEqual(await as(db, bia, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: -1 })), {
      vote: -1,
      likes: 1,
      dislikes: 1,
    });
    assert.deepEqual(await as(db, bia, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 0 })), {
      vote: 0,
      likes: 1,
      dislikes: 0,
    });
    const found = await as(db, null, topic);
    assert.equal(found.likes, 1);
    assert.equal(found.dislikes, 0);
  });

  test('valor inválido, sem login, conta incompleta, banido ou tópico escondido', async () => {
    await rejects(as(db, bia, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 2 })), 'invalid_vote');
    await rejects(as(db, null, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 1 })), 'permission denied');
    const gh = await signUp(db, { email: 'gh@example.com', providers: ['github'] });
    await rejects(as(db, gh, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 1 })), 'account_incomplete');
    await db.query('update public.users_public set banned = true where id = $1', [caio]);
    await rejects(as(db, caio, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 1 })), 'user_banned');
    await db.query(`update public.topics set status = 'hidden'`);
    await rejects(as(db, bia, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 1 })), 'not_found');
  });

  test('tirar o voto vale mesmo banido', async () => {
    await as(db, caio, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: -1 }));
    await db.query('update public.users_public set banned = true where id = $1', [caio]);
    const result = await as(db, caio, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 0 }));
    assert.equal(result.dislikes, 0);
  });

  test('ordem "top": curtidas menos não curtidas', async () => {
    const other = (
      await as(db, bia, (tx) =>
        rpc(tx, 'create_topic', { title: 'Photoshop CS6 roda', body: 'Sim.', tags: [], profile_ids: [] }),
      )
    ).id;
    await as(db, ana, (tx) => rpc(tx, 'vote_topic', { topic_id: other, value: 1 }));
    await as(db, caio, (tx) => rpc(tx, 'vote_topic', { topic_id: other, value: 1 }));
    await as(db, bia, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: -1 }));
    const list = await as(db, null, (tx) => rpc(tx, 'api_list_topics', { sort: 'top' }));
    assert.deepEqual(list.items.map((t) => t.id), [other, topicId]);
    assert.equal(list.items[0].likes, 2);
    assert.equal(list.items[1].dislikes, 1);
  });

  test('ninguém vê o voto dos outros nem escreve direto na tabela', async () => {
    await as(db, bia, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 1 }));
    const seen = await as(db, caio, (tx) => tx.query('select * from public.topic_votes'));
    assert.equal(seen.rows.length, 0);
    await rejects(
      as(db, caio, (tx) =>
        tx.query('insert into public.topic_votes (user_id, topic_id, value) values ($1, $2, 1)', [caio, topicId]),
      ),
      'permission denied',
    );
  });
});

describe('votar em respostas', () => {
  test('curtir e não curtir; totais aparecem na lista de respostas', async () => {
    await as(db, ana, (tx) => rpc(tx, 'vote_reply', { reply_id: replyId, value: 1 }));
    await as(db, caio, (tx) => rpc(tx, 'vote_reply', { reply_id: replyId, value: -1 }));
    const replies = await as(db, null, (tx) => rpc(tx, 'api_list_replies', { topic_id: topicId }));
    assert.equal(replies.items[0].likes, 1);
    assert.equal(replies.items[0].dislikes, 1);
    assert.deepEqual(await as(db, caio, (tx) => rpc(tx, 'vote_reply', { reply_id: replyId, value: 0 })), {
      vote: 0,
      likes: 1,
      dislikes: 0,
    });
  });

  test('resposta escondida não recebe voto; apagar a resposta leva os votos', async () => {
    await as(db, ana, (tx) => rpc(tx, 'vote_reply', { reply_id: replyId, value: 1 }));
    await db.query(`update public.topic_replies set status = 'hidden'`);
    await rejects(as(db, caio, (tx) => rpc(tx, 'vote_reply', { reply_id: replyId, value: 1 })), 'not_found');
    await as(db, bia, (tx) => rpc(tx, 'delete_reply', { reply_id: replyId }));
    assert.equal((await db.query('select count(*)::int as n from public.reply_votes')).rows[0].n, 0);
  });

  test('resposta nova vem com os totais zerados', async () => {
    const created = await as(db, caio, (tx) => rpc(tx, 'add_reply', { topic_id: topicId, body: 'Valeu.' }));
    assert.equal(created.likes, 0);
    assert.equal(created.dislikes, 0);
  });
});

describe('salvar tópicos', () => {
  test('salvar duas vezes guarda uma; aparece em my_saved_topics e no estado', async () => {
    await as(db, bia, (tx) => rpc(tx, 'save_topic', { topic_id: topicId }));
    await as(db, bia, (tx) => rpc(tx, 'save_topic', { topic_id: topicId }));
    const saved = await as(db, bia, (tx) => rpc(tx, 'my_saved_topics'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, topicId);
    assert.equal(saved[0].available, true);
    await as(db, bia, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 1 }));
    await as(db, bia, (tx) => rpc(tx, 'vote_reply', { reply_id: replyId, value: -1 }));
    assert.deepEqual(await as(db, bia, (tx) => rpc(tx, 'my_topic_state', { topic_id: topicId })), {
      vote: 1,
      saved: true,
      replies: { [String(replyId)]: -1 },
    });
    assert.deepEqual(await as(db, caio, (tx) => rpc(tx, 'my_topic_state', { topic_id: topicId })), {
      vote: 0,
      saved: false,
      replies: {},
    });
  });

  test('tópico escondido fica indisponível na lista e pode sair dela', async () => {
    await as(db, bia, (tx) => rpc(tx, 'save_topic', { topic_id: topicId }));
    await db.query(`update public.topics set status = 'hidden'`);
    await rejects(as(db, caio, (tx) => rpc(tx, 'save_topic', { topic_id: topicId })), 'not_found');
    const saved = await as(db, bia, (tx) => rpc(tx, 'my_saved_topics'));
    assert.deepEqual(saved.map((t) => [t.title, t.available]), [['Steam com tela preta', false]]);
    await as(db, bia, (tx) => rpc(tx, 'save_topic', { topic_id: topicId, saved: false }));
    assert.deepEqual(await as(db, bia, (tx) => rpc(tx, 'my_saved_topics')), []);
  });

  test('sem login não salva nem lê estado', async () => {
    await rejects(as(db, null, (tx) => rpc(tx, 'save_topic', { topic_id: topicId })), 'permission denied');
    await rejects(as(db, null, (tx) => rpc(tx, 'my_topic_state', { topic_id: topicId })), 'permission denied');
  });
});

describe('conta', () => {
  test('votos e salvos entram na exportação e saem ao apagar a conta', async () => {
    await as(db, bia, (tx) => rpc(tx, 'vote_topic', { topic_id: topicId, value: 1 }));
    await as(db, bia, (tx) => rpc(tx, 'vote_reply', { reply_id: replyId, value: 1 }));
    await as(db, bia, (tx) => rpc(tx, 'save_topic', { topic_id: topicId }));
    const data = await as(db, bia, (tx) => rpc(tx, 'export_my_data'));
    assert.equal(data.topicVotes[0].value, 1);
    assert.equal(data.replyVotes[0].replyId, replyId);
    assert.equal(data.savedTopics[0].topicId, topicId);
    // caio vota na resposta da bia; quando a bia sai, a resposta e o voto somem
    await as(db, caio, (tx) => rpc(tx, 'vote_reply', { reply_id: replyId, value: 1 }));
    await as(db, bia, (tx) => rpc(tx, 'delete_my_account', { keep_profiles: true }));
    const t = (await db.query('select likes_count from public.topics where id = $1', [topicId])).rows[0];
    assert.equal(t.likes_count, 0);
    assert.equal((await db.query('select count(*)::int as n from public.saved_topics')).rows[0].n, 0);
  });
});
