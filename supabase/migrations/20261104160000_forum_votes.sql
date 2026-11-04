-- Comunidade (fórum): curtir e não curtir tópicos e respostas, e salvar tópicos.
--
-- Cada pessoa tem um voto por item: 1 (curtir), -1 (não curtir) ou nenhum. Os totais ficam
-- em likes_count e dislikes_count, atualizados por gatilho; quem votou em quê só a própria
-- pessoa vê. Salvar é uma lista particular de favoritos, como a dos perfis de configuração.
-- A lista ganha a ordem "top" (curtidas menos não curtidas).

-- Votos ---------------------------------------------------------------------------------

alter table public.topics
  add column likes_count integer not null default 0,
  add column dislikes_count integer not null default 0;
alter table public.topic_replies
  add column likes_count integer not null default 0,
  add column dislikes_count integer not null default 0;

create index topics_top_idx on public.topics ((likes_count - dislikes_count) desc, activity_at desc)
  where status = 'visible';

create table public.topic_votes (
  user_id uuid not null references public.users_public (id) on delete cascade,
  topic_id text not null references public.topics (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);
create index topic_votes_topic_idx on public.topic_votes (topic_id);

create table public.reply_votes (
  user_id uuid not null references public.users_public (id) on delete cascade,
  reply_id bigint not null references public.topic_replies (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (user_id, reply_id)
);
create index reply_votes_reply_idx on public.reply_votes (reply_id);

-- Somar e tirar dos totais a cada voto novo, trocado ou removido.
create function private.count_topic_votes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  likes integer :=
    (case when tg_op <> 'DELETE' and new.value = 1 then 1 else 0 end)
    - (case when tg_op <> 'INSERT' and old.value = 1 then 1 else 0 end);
  dislikes integer :=
    (case when tg_op <> 'DELETE' and new.value = -1 then 1 else 0 end)
    - (case when tg_op <> 'INSERT' and old.value = -1 then 1 else 0 end);
begin
  if likes <> 0 or dislikes <> 0 then
    update public.topics
      set likes_count = likes_count + likes, dislikes_count = dislikes_count + dislikes
      where id = coalesce(new.topic_id, old.topic_id);
  end if;
  return null;
end;
$$;

create trigger topic_votes_count
  after insert or update of value or delete on public.topic_votes
  for each row execute function private.count_topic_votes();

create function private.count_reply_votes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  likes integer :=
    (case when tg_op <> 'DELETE' and new.value = 1 then 1 else 0 end)
    - (case when tg_op <> 'INSERT' and old.value = 1 then 1 else 0 end);
  dislikes integer :=
    (case when tg_op <> 'DELETE' and new.value = -1 then 1 else 0 end)
    - (case when tg_op <> 'INSERT' and old.value = -1 then 1 else 0 end);
begin
  if likes <> 0 or dislikes <> 0 then
    update public.topic_replies
      set likes_count = likes_count + likes, dislikes_count = dislikes_count + dislikes
      where id = coalesce(new.reply_id, old.reply_id);
  end if;
  return null;
end;
$$;

create trigger reply_votes_count
  after insert or update of value or delete on public.reply_votes
  for each row execute function private.count_reply_votes();

-- Salvos --------------------------------------------------------------------------------

create table public.saved_topics (
  user_id uuid not null references public.users_public (id) on delete cascade,
  topic_id text not null references public.topics (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);
create index saved_topics_user_idx on public.saved_topics (user_id, created_at desc);

-- RLS: cada um vê só os próprios votos e salvos; os totais estão nos tópicos e respostas.
alter table public.topic_votes enable row level security;
alter table public.reply_votes enable row level security;
alter table public.saved_topics enable row level security;
revoke all on public.topic_votes, public.reply_votes, public.saved_topics from anon, authenticated;
grant select on public.topic_votes, public.reply_votes, public.saved_topics to authenticated;
create policy "topic_votes: cada um vê os seus"
  on public.topic_votes for select to authenticated using (user_id = auth.uid());
create policy "reply_votes: cada um vê os seus"
  on public.reply_votes for select to authenticated using (user_id = auth.uid());
create policy "saved_topics: cada um vê os seus"
  on public.saved_topics for select to authenticated using (user_id = auth.uid());

-- Escrever -------------------------------------------------------------------------------

-- Votar: 1 curte, -1 não curte, 0 tira o voto. Votar de novo no mesmo troca o voto.
-- Tirar o voto vale sempre (mesmo banido ou com o tópico escondido).
create function public.vote_topic(topic_id text, value integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if vote_topic.value is null or vote_topic.value not in (-1, 0, 1) then
    raise exception 'invalid_vote' using errcode = '22023';
  end if;
  if vote_topic.value = 0 then
    delete from public.topic_votes v where v.user_id = me and v.topic_id = vote_topic.topic_id;
  else
    perform private.require_member();
    perform private.require_visible_topic(vote_topic.topic_id);
    insert into public.topic_votes as v (user_id, topic_id, value)
      values (me, vote_topic.topic_id, vote_topic.value)
      on conflict (user_id, topic_id) do update set value = excluded.value;
  end if;
  return (
    select jsonb_build_object('vote', vote_topic.value, 'likes', t.likes_count, 'dislikes', t.dislikes_count)
    from public.topics t where t.id = vote_topic.topic_id
  );
end;
$$;

create function public.vote_reply(reply_id bigint, value integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if vote_reply.value is null or vote_reply.value not in (-1, 0, 1) then
    raise exception 'invalid_vote' using errcode = '22023';
  end if;
  if vote_reply.value = 0 then
    delete from public.reply_votes v where v.user_id = me and v.reply_id = vote_reply.reply_id;
  else
    perform private.require_member();
    if not exists (
      select 1 from public.topic_replies r join public.topics t on t.id = r.topic_id
      where r.id = vote_reply.reply_id and r.status = 'visible' and t.status = 'visible'
    ) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    insert into public.reply_votes as v (user_id, reply_id, value)
      values (me, vote_reply.reply_id, vote_reply.value)
      on conflict (user_id, reply_id) do update set value = excluded.value;
  end if;
  return (
    select jsonb_build_object('vote', vote_reply.value, 'likes', r.likes_count, 'dislikes', r.dislikes_count)
    from public.topic_replies r where r.id = vote_reply.reply_id
  );
end;
$$;

-- Salvar (saved = true) ou tirar dos salvos. Até 500 por pessoa; tirar vale sempre.
create function public.save_topic(topic_id text, saved boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if coalesce(saved, true) then
    perform private.require_member();
    perform private.require_visible_topic(save_topic.topic_id);
    if (select count(*) from public.saved_topics s where s.user_id = me) >= 500 then
      raise exception 'save_limit' using errcode = '54000';
    end if;
    insert into public.saved_topics (user_id, topic_id)
      values (me, save_topic.topic_id)
      on conflict do nothing;
  else
    delete from public.saved_topics s where s.user_id = me and s.topic_id = save_topic.topic_id;
  end if;
  return jsonb_build_object('saved', coalesce(saved, true));
end;
$$;

-- O que a pessoa conectada fez num tópico: o voto nele, nas respostas e se salvou.
create function public.my_topic_state(topic_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'vote', coalesce((select v.value from public.topic_votes v
                      where v.user_id = auth.uid() and v.topic_id = my_topic_state.topic_id), 0),
    'saved', exists (select 1 from public.saved_topics s
                     where s.user_id = auth.uid() and s.topic_id = my_topic_state.topic_id),
    'replies', coalesce((select jsonb_object_agg(v.reply_id::text, v.value)
                         from public.reply_votes v
                         join public.topic_replies r on r.id = v.reply_id
                         where v.user_id = auth.uid() and r.topic_id = my_topic_state.topic_id), '{}'::jsonb)
  )
  where auth.uid() is not null;
$$;

-- Os tópicos salvos, mais recentes primeiro. Os que saíram do ar aparecem como
-- indisponíveis, para poder tirar.
create function public.my_saved_topics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    case when t.status = 'visible'
      then private.topic_summary(t) || jsonb_build_object('available', true, 'savedAt', s.created_at)
      else jsonb_build_object('id', t.id, 'title', t.title, 'available', false, 'savedAt', s.created_at)
    end
    order by s.created_at desc), '[]'::jsonb)
  from public.saved_topics s
  join public.topics t on t.id = s.topic_id
  where s.user_id = auth.uid();
$$;

-- API pública: totais nos tópicos e respostas, e a ordem "top" ------------------------------

create or replace function private.topic_summary(t public.topics)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'slug', t.slug,
    'title', t.title,
    'excerpt', left(regexp_replace(t.body, '\s+', ' ', 'g'), 200),
    'tags', to_jsonb(t.tags),
    'author', private.author_json(t.author_id),
    'replies', t.replies_count,
    'likes', t.likes_count,
    'dislikes', t.dislikes_count,
    'profiles', (select count(*) from public.topic_profiles tp
                 join public.profiles p on p.id = tp.profile_id
                 where tp.topic_id = t.id and p.status = 'published'),
    'createdAt', t.created_at,
    'activityAt', t.activity_at,
    'editedAt', t.edited_at
  );
$$;

create or replace function public.api_list_topics(
  q text default null,
  tag text default null,
  profile_id text default null,
  sort text default 'activity',
  page integer default 1,
  page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  query tsquery := private.search_query(left(q, 100));
  wanted_tag text := nullif(private.clean_tag(left(tag, 60)), '');
  wanted_profile text := nullif(api_list_topics.profile_id, '');
  order_by text := coalesce(sort, 'activity');
  size integer := least(greatest(coalesce(page_size, 20), 1), 50);
  current_page integer := greatest(coalesce(page, 1), 1);
  result jsonb;
begin
  if order_by not in ('activity', 'recent', 'replies', 'top') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;
  with matches as (
    select t.*
    from public.topics t
    where t.status = 'visible'
      and (query is null or t.search @@ query)
      and (wanted_tag is null or wanted_tag = any(t.tags))
      and (wanted_profile is null or exists (
        select 1 from public.topic_profiles tp where tp.topic_id = t.id and tp.profile_id = wanted_profile))
  ),
  ordered as (
    select m.id, row_number() over (
      order by
        case order_by
          when 'replies' then m.replies_count
          when 'top' then m.likes_count - m.dislikes_count
          else 0
        end desc,
        case when order_by = 'recent' then m.created_at else m.activity_at end desc,
        m.id
    ) as position
    from matches m
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(private.topic_summary(t) order by o.position)
       from ordered o
       join public.topics t on t.id = o.id
       where o.position > (current_page - 1) * size and o.position <= current_page * size),
      '[]'::jsonb),
    'page', current_page,
    'pageSize', size,
    'total', (select count(*) from matches)
  ) into result;
  return result;
end;
$$;

create or replace function public.api_list_replies(topic_id text, page integer default 1, page_size integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select least(greatest(coalesce(page_size, 50), 1), 100) as size, greatest(coalesce(page, 1), 1) as page
  ),
  visible as (
    select r.*, row_number() over (order by r.created_at, r.id) as position
    from public.topic_replies r
    where r.topic_id = api_list_replies.topic_id and r.status = 'visible'
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
          'id', v.id,
          'author', private.author_json(v.author_id),
          'body', v.body,
          'likes', v.likes_count,
          'dislikes', v.dislikes_count,
          'createdAt', v.created_at
        ) order by v.position)
       from visible v, params
       where v.position > (params.page - 1) * params.size and v.position <= params.page * params.size),
      '[]'::jsonb),
    'page', params.page,
    'pageSize', params.size,
    'total', (select count(*) from visible)
  )
  from params
  where exists (
    select 1 from public.topics t where t.id = api_list_replies.topic_id and t.status = 'visible'
  );
$$;

-- Resposta nova já com os totais (zerados), como na lista.
create or replace function public.add_reply(topic_id text, body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := private.require_member();
  created public.topic_replies;
begin
  perform private.require_visible_topic(add_reply.topic_id);
  perform private.require_under_daily_limit(
    (select count(*) from public.topic_replies r
     where r.author_id = me and r.created_at > now() - interval '1 day'),
    60
  );
  insert into public.topic_replies (topic_id, author_id, body)
    values (add_reply.topic_id, me, private.clean_post(add_reply.body, 5000))
    returning * into created;
  return jsonb_build_object(
    'id', created.id,
    'author', private.author_json(me),
    'body', created.body,
    'likes', 0,
    'dislikes', 0,
    'createdAt', created.created_at
  );
end;
$$;

-- Conta ----------------------------------------------------------------------------------

-- Exportação (LGPD) também com os votos e os tópicos salvos.
create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exportedAt', now(),
    'account', jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'emailConfirmedAt', u.email_confirmed_at,
      'createdAt', u.created_at,
      'lastSignInAt', u.last_sign_in_at,
      'providers', coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb)
    ),
    'public', jsonb_build_object(
      'username', p.username,
      'role', p.role,
      'banned', p.banned,
      'termsAcceptedAt', p.terms_accepted_at,
      'createdAt', p.created_at
    ),
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'status', pr.status,
        'notes', pr.notes,
        'createdAt', pr.created_at,
        'file', jsonb_build_object(
          'format', 'macitrun-profile', 'version', pr.schema_version,
          'profile', pr.payload, 'testedOn', pr.tested_on)
      ) order by pr.created_at)
      from public.profiles pr where pr.author_id = u.id), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'profileId', c.profile_id, 'body', c.body,
        'status', c.status, 'createdAt', c.created_at
      ) order by c.created_at)
      from public.comments c where c.author_id = u.id), '[]'::jsonb),
    'likes', coalesce((
      select jsonb_agg(jsonb_build_object('profileId', l.profile_id, 'createdAt', l.created_at)
        order by l.created_at)
      from public.likes l where l.user_id = u.id), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'targetType', r.target_type, 'targetId', r.target_id, 'reason', r.reason,
        'createdAt', r.created_at, 'resolvedAt', r.resolved_at
      ) order by r.created_at)
      from public.reports r where r.reporter_id = u.id), '[]'::jsonb),
    'saved', coalesce((
      select jsonb_agg(jsonb_build_object('profileId', s.profile_id, 'createdAt', s.created_at)
        order by s.created_at)
      from public.saved_profiles s where s.user_id = u.id), '[]'::jsonb),
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'body', t.body, 'tags', to_jsonb(t.tags),
        'profileIds', coalesce((select jsonb_agg(tp.profile_id order by tp.position)
                                from public.topic_profiles tp where tp.topic_id = t.id), '[]'::jsonb),
        'status', t.status, 'createdAt', t.created_at, 'editedAt', t.edited_at
      ) order by t.created_at)
      from public.topics t where t.author_id = u.id), '[]'::jsonb),
    'replies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'topicId', r.topic_id, 'body', r.body,
        'status', r.status, 'createdAt', r.created_at
      ) order by r.created_at)
      from public.topic_replies r where r.author_id = u.id), '[]'::jsonb),
    'topicVotes', coalesce((
      select jsonb_agg(jsonb_build_object('topicId', v.topic_id, 'value', v.value, 'createdAt', v.created_at)
        order by v.created_at)
      from public.topic_votes v where v.user_id = u.id), '[]'::jsonb),
    'replyVotes', coalesce((
      select jsonb_agg(jsonb_build_object('replyId', v.reply_id, 'value', v.value, 'createdAt', v.created_at)
        order by v.created_at)
      from public.reply_votes v where v.user_id = u.id), '[]'::jsonb),
    'savedTopics', coalesce((
      select jsonb_agg(jsonb_build_object('topicId', s.topic_id, 'createdAt', s.created_at)
        order by s.created_at)
      from public.saved_topics s where s.user_id = u.id), '[]'::jsonb)
  )
  from auth.users u
  join public.users_public p on p.id = u.id
  where u.id = auth.uid();
$$;

-- Permissões das funções -----------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;

revoke execute on function
  public.vote_topic(text, integer),
  public.vote_reply(bigint, integer),
  public.save_topic(text, boolean),
  public.my_topic_state(text),
  public.my_saved_topics(),
  public.api_list_topics(text, text, text, text, integer, integer),
  public.api_list_replies(text, integer, integer),
  public.add_reply(text, text),
  public.export_my_data()
  from public, anon, authenticated;
grant execute on function
  public.api_list_topics(text, text, text, text, integer, integer),
  public.api_list_replies(text, integer, integer)
  to anon, authenticated;
grant execute on function
  public.vote_topic(text, integer),
  public.vote_reply(bigint, integer),
  public.save_topic(text, boolean),
  public.my_topic_state(text),
  public.my_saved_topics(),
  public.add_reply(text, text),
  public.export_my_data()
  to authenticated;
