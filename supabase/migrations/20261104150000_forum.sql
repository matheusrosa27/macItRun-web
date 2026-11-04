-- Fórum da comunidade: tópicos de discussão independentes, para jogos e apps.
--
-- Cada tópico tem título, texto, até 5 tags livres (normalizadas: "Dark Souls III" vira
-- "dark-souls-iii") e pode citar até 5 perfis de configuração publicados. As respostas seguem
-- em ordem cronológica (discussão simples, sem "resposta certa").
--
-- Mesmas regras da comunidade: leitura pública por RLS e pelas funções api_*; toda escrita
-- passa por funções SECURITY DEFINER sobre auth.uid(), com conta completa, sem banimento,
-- texto puro e limite diário (10 tópicos e 60 respostas por pessoa). Denúncias e moderação
-- valem também para tópicos e respostas.

-- Ajudas ----------------------------------------------------------------------------------

-- Título: uma linha só (quebras e espaços repetidos viram um espaço), 3 a 120 caracteres.
create function private.clean_topic_title(value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g');
begin
  if char_length(cleaned) not between 3 and 120
    or cleaned ~ '[\x01-\x1f\x7f  ]'
  then
    raise exception 'title_invalid' using errcode = '22023';
  end if;
  return cleaned;
end;
$$;

-- Texto de tópico ou resposta: como os comentários, mas com tamanho próprio.
create function private.clean_post(value text, max_length integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := btrim(replace(replace(coalesce(value, ''), E'\r\n', E'\n'), E'\r', E'\n'), E' \n\t');
begin
  if char_length(cleaned) not between 1 and max_length
    or cleaned ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f  ]'
  then
    raise exception 'body_invalid' using errcode = '22023';
  end if;
  return cleaned;
end;
$$;

-- Uma tag: minúscula, sem acento, palavras ligadas por hífen ("Áudio / Som" vira "audio-som").
create function private.clean_tag(value text)
returns text
language sql
stable
set search_path = ''
as $$
  select trim(both '-' from replace(private.search_text(value), ' ', '-'));
$$;

-- Até 5 tags de até 30 caracteres, sem repetir, na ordem em que vieram. Vazias são ignoradas.
create function private.clean_tags(value text[])
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  result text[] := '{}';
  tag text;
  cleaned text;
begin
  foreach tag in array coalesce(value, '{}') loop
    cleaned := private.clean_tag(tag);
    continue when cleaned = '';
    if char_length(cleaned) > 30 then
      raise exception 'tags_invalid' using errcode = '22023';
    end if;
    if not cleaned = any(result) then
      result := result || cleaned;
    end if;
  end loop;
  if cardinality(result) > 5 then
    raise exception 'tags_invalid' using errcode = '22023';
  end if;
  return result;
end;
$$;

-- Trecho legível da URL: /forum/<id>/<slug>.
create function private.topic_slug(title text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(trim(both '-' from left(replace(private.search_text(title), ' ', '-'), 60)), ''), 'topic');
$$;

-- Busca por título, tags e texto.
create function private.topic_search(title text, tags text[], body text)
returns tsvector
language sql
stable
set search_path = ''
as $$
  select
    setweight(to_tsvector('simple', private.search_text(title)), 'A')
    || setweight(to_tsvector('simple', private.search_text(array_to_string(tags, ' '))), 'B')
    || setweight(to_tsvector('simple', private.search_text(left(body, 4000))), 'C');
$$;

-- Tópicos -------------------------------------------------------------------------------

create table public.topics (
  id text primary key default private.new_profile_id(),
  slug text not null default 'topic',
  -- null: a pessoa apagou a conta e deixou os tópicos ("autor removido").
  author_id uuid references public.users_public (id) on delete set null,
  title text not null check (char_length(title) between 3 and 120),
  -- Texto puro, exibido como texto (nunca HTML).
  body text not null check (char_length(body) between 1 and 10000 and body ~ '\S'),
  tags text[] not null default '{}' check (cardinality(tags) <= 5),
  -- visible; hidden (admin ou 3 denúncias). O autor apaga de vez.
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  replies_count integer not null default 0,
  -- Última resposta visível (ou a criação): ordem padrão do fórum.
  activity_at timestamptz not null default now(),
  search tsvector,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index topics_activity_idx on public.topics (activity_at desc, id) where status = 'visible';
create index topics_recent_idx on public.topics (created_at desc, id) where status = 'visible';
create index topics_replies_idx on public.topics (replies_count desc, activity_at desc) where status = 'visible';
create index topics_tags_idx on public.topics using gin (tags);
create index topics_search_idx on public.topics using gin (search);
create index topics_author_idx on public.topics (author_id, created_at);

-- Antes de gravar: slug e busca acompanham título, tags e texto; id, autor e data não mudam.
create function private.topics_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.activity_at := new.created_at;
  elsif new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or (new.author_id is distinct from old.author_id and new.author_id is not null)
  then
    raise exception 'topic_immutable' using errcode = '42501';
  end if;
  if tg_op = 'INSERT'
    or new.title is distinct from old.title
    or new.tags is distinct from old.tags
    or new.body is distinct from old.body
  then
    new.slug := private.topic_slug(new.title);
    new.search := private.topic_search(new.title, new.tags, new.body);
  end if;
  return new;
end;
$$;

create trigger topics_before_write
  before insert or update on public.topics
  for each row execute function private.topics_before_write();

-- Perfis de configuração citados no tópico (até 5, na ordem escolhida).
create table public.topic_profiles (
  topic_id text not null references public.topics (id) on delete cascade,
  profile_id text not null references public.profiles (id) on delete cascade,
  position smallint not null default 0,
  primary key (topic_id, profile_id)
);

create index topic_profiles_profile_idx on public.topic_profiles (profile_id);

-- Respostas ------------------------------------------------------------------------------

create table public.topic_replies (
  id bigint generated always as identity primary key,
  topic_id text not null references public.topics (id) on delete cascade,
  -- Apagar a conta apaga as respostas da pessoa (como os comentários).
  author_id uuid not null references public.users_public (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000 and body ~ '\S'),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at timestamptz not null default now()
);

create index topic_replies_topic_idx on public.topic_replies (topic_id, created_at, id);
create index topic_replies_author_idx on public.topic_replies (author_id, created_at);

-- Total de respostas visíveis e última atividade, recalculados a cada mudança.
create function private.count_topic_replies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target text := coalesce(new.topic_id, old.topic_id);
begin
  update public.topics t set
    replies_count = (select count(*) from public.topic_replies r
                     where r.topic_id = target and r.status = 'visible'),
    activity_at = coalesce((select max(r.created_at) from public.topic_replies r
                            where r.topic_id = target and r.status = 'visible'), t.created_at)
  where t.id = target;
  return null;
end;
$$;

create trigger topic_replies_count
  after insert or update of status or delete on public.topic_replies
  for each row execute function private.count_topic_replies();

-- RLS ----------------------------------------------------------------------------------

alter table public.topics enable row level security;
alter table public.topic_profiles enable row level security;
alter table public.topic_replies enable row level security;

revoke all on public.topics, public.topic_profiles, public.topic_replies from anon, authenticated;

-- Tópicos: todos leem os visíveis; o autor e os admins veem também os escondidos.
grant select on public.topics to anon, authenticated;
create policy "topics: todos leem os visíveis"
  on public.topics for select
  to anon, authenticated
  using (status = 'visible' or author_id = auth.uid() or private.is_admin());

grant select on public.topic_profiles to anon, authenticated;
create policy "topic_profiles: de tópicos visíveis"
  on public.topic_profiles for select
  to anon, authenticated
  using (
    exists (select 1 from public.topics t where t.id = topic_id and t.status = 'visible')
    or private.is_admin()
  );

grant select on public.topic_replies to anon, authenticated;
create policy "topic_replies: todos leem as visíveis"
  on public.topic_replies for select
  to anon, authenticated
  using (
    (status = 'visible'
      and exists (select 1 from public.topics t where t.id = topic_id and t.status = 'visible'))
    or private.is_admin()
  );

-- Escrever -------------------------------------------------------------------------------

create function private.require_visible_topic(target text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.topics t where t.id = target and t.status = 'visible') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Troca os perfis citados. Vale perfil publicado ou que o tópico já citava (editar um tópico
-- não falha porque um perfil citado saiu do ar).
create function private.set_topic_profiles(target text, profile_ids text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ids text[] := '{}';
  wanted text;
begin
  foreach wanted in array coalesce(profile_ids, '{}') loop
    continue when wanted is null or wanted = any(ids);
    ids := ids || wanted;
  end loop;
  if cardinality(ids) > 5 or (
    select count(*) from public.profiles p
    where p.id = any(ids)
      and (p.status = 'published'
        or exists (select 1 from public.topic_profiles tp where tp.topic_id = target and tp.profile_id = p.id))
  ) <> cardinality(ids) then
    raise exception 'profiles_invalid' using errcode = '22023';
  end if;
  delete from public.topic_profiles tp where tp.topic_id = target;
  insert into public.topic_profiles (topic_id, profile_id, position)
    select target, x.id, (x.n - 1)::smallint from unnest(ids) with ordinality as x (id, n);
end;
$$;

create function public.create_topic(
  title text,
  body text,
  tags text[] default '{}',
  profile_ids text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := private.require_member();
  created public.topics;
begin
  perform private.require_under_daily_limit(
    (select count(*) from public.topics t
     where t.author_id = me and t.created_at > now() - interval '1 day'),
    10
  );
  insert into public.topics (author_id, title, body, tags)
    values (
      me,
      private.clean_topic_title(create_topic.title),
      private.clean_post(create_topic.body, 10000),
      private.clean_tags(create_topic.tags)
    )
    returning * into created;
  perform private.set_topic_profiles(created.id, create_topic.profile_ids);
  return jsonb_build_object('id', created.id, 'slug', created.slug);
end;
$$;

-- O autor edita título, texto, tags e perfis citados.
create function public.update_topic(
  topic_id text,
  title text,
  body text,
  tags text[] default '{}',
  profile_ids text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := private.require_member();
  updated public.topics;
begin
  update public.topics t set
    title = private.clean_topic_title(update_topic.title),
    body = private.clean_post(update_topic.body, 10000),
    tags = private.clean_tags(update_topic.tags),
    edited_at = now()
  where t.id = update_topic.topic_id and t.author_id = me
  returning * into updated;
  if updated.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.set_topic_profiles(updated.id, update_topic.profile_ids);
  return jsonb_build_object('id', updated.id, 'slug', updated.slug);
end;
$$;

-- O autor apaga o tópico, com as respostas (vale mesmo banido: apagar é sempre permitido).
create function public.delete_topic(topic_id text)
returns void
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
  if not exists (select 1 from public.topics t where t.id = delete_topic.topic_id and t.author_id = me) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  delete from public.reports r
    where (r.target_type = 'topic' and r.target_id = delete_topic.topic_id)
       or (r.target_type = 'reply' and r.target_id in (
             select x.id::text from public.topic_replies x where x.topic_id = delete_topic.topic_id));
  delete from public.topics t where t.id = delete_topic.topic_id;
end;
$$;

create function public.add_reply(topic_id text, body text)
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
    'createdAt', created.created_at
  );
end;
$$;

-- O autor apaga a própria resposta (vale mesmo banido).
create function public.delete_reply(reply_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  delete from public.topic_replies where id = reply_id and author_id = me;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Admins apagam de vez (com as denúncias do item).
create function public.admin_delete_topic(topic_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  delete from public.reports r
    where (r.target_type = 'topic' and r.target_id = admin_delete_topic.topic_id)
       or (r.target_type = 'reply' and r.target_id in (
             select x.id::text from public.topic_replies x where x.topic_id = admin_delete_topic.topic_id));
  delete from public.topics t where t.id = admin_delete_topic.topic_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.admin_delete_reply(reply_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  delete from public.reports where target_type = 'reply' and target_id = admin_delete_reply.reply_id::text;
  delete from public.topic_replies where id = admin_delete_reply.reply_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- API pública ----------------------------------------------------------------------------

create function private.topic_summary(t public.topics)
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
    'profiles', (select count(*) from public.topic_profiles tp
                 join public.profiles p on p.id = tp.profile_id
                 where tp.topic_id = t.id and p.status = 'published'),
    'createdAt', t.created_at,
    'activityAt', t.activity_at,
    'editedAt', t.edited_at
  );
$$;

-- Lista do fórum: busca, uma tag, tópicos que citam um perfil e ordem (atividade, novos ou
-- mais respondidos).
create function public.api_list_topics(
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
  if order_by not in ('activity', 'recent', 'replies') then
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
        case when order_by = 'replies' then m.replies_count else 0 end desc,
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

-- O tópico com o texto e os perfis citados que estão publicados. null se não está visível.
create function public.api_get_topic(topic_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (private.topic_summary(t) - 'excerpt') || jsonb_build_object(
    'body', t.body,
    'profiles', coalesce(
      (select jsonb_agg(jsonb_build_object(
          'id', p.id, 'slug', p.slug, 'name', p.game_name, 'graphics', p.graphics,
          'author', private.author_json(p.author_id)
        ) order by tp.position)
       from public.topic_profiles tp
       join public.profiles p on p.id = tp.profile_id
       where tp.topic_id = t.id and p.status = 'published'),
      '[]'::jsonb)
  )
  from public.topics t
  where t.id = api_get_topic.topic_id and t.status = 'visible';
$$;

create function public.api_list_replies(topic_id text, page integer default 1, page_size integer default 50)
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

-- As tags mais usadas nos tópicos visíveis (para os filtros e as sugestões ao escrever).
create function public.api_topic_tags(max_tags integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tag', used.tag, 'count', used.uses)
                            order by used.uses desc, used.tag), '[]'::jsonb)
  from (
    select x.tag, count(*) as uses
    from public.topics t, unnest(t.tags) as x (tag)
    where t.status = 'visible'
    group by x.tag
    order by uses desc, x.tag
    limit least(greatest(coalesce(max_tags, 30), 1), 100)
  ) used;
$$;

-- Denúncias e moderação: agora também tópicos e respostas ----------------------------------

alter table public.reports drop constraint reports_target_type_check;
alter table public.reports
  add constraint reports_target_type_check check (target_type in ('profile', 'comment', 'topic', 'reply'));

create or replace function public.report(target_type text, target_id text, reason text, detail text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := private.require_member();
  owner uuid;
  open_reports integer;
  hidden boolean := false;
begin
  if report.target_type = 'profile' then
    select p.author_id into owner from public.profiles p
      where p.id = report.target_id and p.status = 'published';
  elsif report.target_type = 'comment' and report.target_id ~ '^\d{1,18}$' then
    select c.author_id into owner from public.comments c
      join public.profiles p on p.id = c.profile_id
      where c.id = report.target_id::bigint and c.status = 'visible' and p.status = 'published';
  elsif report.target_type = 'topic' then
    select t.author_id into owner from public.topics t
      where t.id = report.target_id and t.status = 'visible';
  elsif report.target_type = 'reply' and report.target_id ~ '^\d{1,18}$' then
    select r.author_id into owner from public.topic_replies r
      join public.topics t on t.id = r.topic_id
      where r.id = report.target_id::bigint and r.status = 'visible' and t.status = 'visible';
  else
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if owner = me then
    raise exception 'own_content' using errcode = '42501';
  end if;
  perform private.require_under_daily_limit(
    (select count(*) from public.reports r
     where r.reporter_id = me and r.created_at > now() - interval '1 day'),
    20
  );

  insert into public.reports (reporter_id, target_type, target_id, reason, detail)
    values (me, report.target_type, report.target_id, report.reason, private.clean_text(report.detail, 500))
    on conflict (reporter_id, target_type, target_id) do nothing;

  select count(distinct r.reporter_id) into open_reports from public.reports r
    where r.target_type = report.target_type and r.target_id = report.target_id and r.resolved_at is null;
  if open_reports >= private.hide_after_reports() then
    if report.target_type = 'profile' then
      update public.profiles set status = 'hidden' where id = report.target_id and status = 'published';
    elsif report.target_type = 'comment' then
      update public.comments set status = 'hidden' where id = report.target_id::bigint and status = 'visible';
    elsif report.target_type = 'topic' then
      update public.topics set status = 'hidden' where id = report.target_id and status = 'visible';
    else
      update public.topic_replies set status = 'hidden' where id = report.target_id::bigint and status = 'visible';
    end if;
    hidden := true;
  end if;
  return jsonb_build_object('reported', true, 'hidden', hidden);
end;
$$;

-- O item denunciado, para a tela de moderação. Tópicos e respostas trazem topicId em vez de
-- profileId; o texto do tópico vem cortado em 1.000 caracteres.
create or replace function private.moderation_target(target_type text, target_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case target_type
    when 'profile' then (
      select jsonb_build_object(
        'profileId', p.id, 'slug', p.slug, 'name', p.game_name, 'status', p.status,
        'author', (select jsonb_build_object('id', u.id, 'username', u.username, 'banned', u.banned)
                   from public.users_public u where u.id = p.author_id))
      from public.profiles p where p.id = target_id)
    when 'comment' then (
      select jsonb_build_object(
        'profileId', p.id, 'slug', p.slug, 'name', p.game_name, 'body', c.body, 'status', c.status,
        'author', (select jsonb_build_object('id', u.id, 'username', u.username, 'banned', u.banned)
                   from public.users_public u where u.id = c.author_id))
      from public.comments c join public.profiles p on p.id = c.profile_id
      where target_id ~ '^\d{1,18}$' and c.id = target_id::bigint)
    when 'topic' then (
      select jsonb_build_object(
        'topicId', t.id, 'slug', t.slug, 'name', t.title, 'body', left(t.body, 1000), 'status', t.status,
        'author', (select jsonb_build_object('id', u.id, 'username', u.username, 'banned', u.banned)
                   from public.users_public u where u.id = t.author_id))
      from public.topics t where t.id = target_id)
    when 'reply' then (
      select jsonb_build_object(
        'topicId', t.id, 'slug', t.slug, 'name', t.title, 'body', r.body, 'status', r.status,
        'author', (select jsonb_build_object('id', u.id, 'username', u.username, 'banned', u.banned)
                   from public.users_public u where u.id = r.author_id))
      from public.topic_replies r join public.topics t on t.id = r.topic_id
      where target_id ~ '^\d{1,18}$' and r.id = target_id::bigint)
  end;
$$;

create or replace function public.admin_hidden_items()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(item order by item ->> 'at' desc)
    from (
      select jsonb_build_object('targetType', 'profile', 'targetId', p.id, 'at', p.updated_at,
               'target', private.moderation_target('profile', p.id)) as item
      from public.profiles p where p.status = 'hidden'
      union all
      select jsonb_build_object('targetType', 'comment', 'targetId', c.id::text, 'at', c.created_at,
               'target', private.moderation_target('comment', c.id::text))
      from public.comments c where c.status = 'hidden'
      union all
      select jsonb_build_object('targetType', 'topic', 'targetId', t.id, 'at', t.created_at,
               'target', private.moderation_target('topic', t.id))
      from public.topics t where t.status = 'hidden'
      union all
      select jsonb_build_object('targetType', 'reply', 'targetId', r.id::text, 'at', r.created_at,
               'target', private.moderation_target('reply', r.id::text))
      from public.topic_replies r where r.status = 'hidden'
    ) items
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_moderate(target_type text, target_id text, hide boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  if admin_moderate.target_type = 'profile' then
    update public.profiles
      set status = case when hide then 'hidden' else 'published' end
      where id = admin_moderate.target_id and status in ('published', 'hidden');
  elsif admin_moderate.target_type = 'comment' and admin_moderate.target_id ~ '^\d{1,18}$' then
    update public.comments
      set status = case when hide then 'hidden' else 'visible' end
      where id = admin_moderate.target_id::bigint;
  elsif admin_moderate.target_type = 'topic' then
    update public.topics
      set status = case when hide then 'hidden' else 'visible' end
      where id = admin_moderate.target_id;
  elsif admin_moderate.target_type = 'reply' and admin_moderate.target_id ~ '^\d{1,18}$' then
    update public.topic_replies
      set status = case when hide then 'hidden' else 'visible' end
      where id = admin_moderate.target_id::bigint;
  else
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.reports
    set resolved_at = now()
    where target_type = admin_moderate.target_type and target_id = admin_moderate.target_id
      and resolved_at is null;
end;
$$;

-- Conta ----------------------------------------------------------------------------------

-- Exportação (LGPD) também com tópicos e respostas.
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
      from public.topic_replies r where r.author_id = u.id), '[]'::jsonb)
  )
  from auth.users u
  join public.users_public p on p.id = u.id
  where u.id = auth.uid();
$$;

-- Apagar a conta: a mesma escolha vale para perfis e tópicos (ficam como "autor removido" ou
-- somem junto). Respostas, como comentários, sempre saem (cascade).
create or replace function public.delete_my_account(keep_profiles boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not coalesce(keep_profiles, true) then
    delete from public.profiles where author_id = me;
    delete from public.topics where author_id = me;
  end if;
  begin
    delete from auth.audit_log_entries where payload ->> 'actor_id' = me::text;
  exception when insufficient_privilege or undefined_table then
    null;
  end;
  delete from auth.users where id = me;
end;
$$;

-- Permissões das funções -----------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;

revoke execute on function
  public.create_topic(text, text, text[], text[]),
  public.update_topic(text, text, text, text[], text[]),
  public.delete_topic(text),
  public.add_reply(text, text),
  public.delete_reply(bigint),
  public.admin_delete_topic(text),
  public.admin_delete_reply(bigint),
  public.api_list_topics(text, text, text, text, integer, integer),
  public.api_get_topic(text),
  public.api_list_replies(text, integer, integer),
  public.api_topic_tags(integer),
  public.report(text, text, text, text),
  public.admin_hidden_items(),
  public.admin_moderate(text, text, boolean),
  public.export_my_data(),
  public.delete_my_account(boolean)
  from public, anon, authenticated;
grant execute on function
  public.api_list_topics(text, text, text, text, integer, integer),
  public.api_get_topic(text),
  public.api_list_replies(text, integer, integer),
  public.api_topic_tags(integer)
  to anon, authenticated;
grant execute on function
  public.create_topic(text, text, text[], text[]),
  public.update_topic(text, text, text, text[], text[]),
  public.delete_topic(text),
  public.add_reply(text, text),
  public.delete_reply(bigint),
  public.admin_delete_topic(text),
  public.admin_delete_reply(bigint),
  public.report(text, text, text, text),
  public.admin_hidden_items(),
  public.admin_moderate(text, text, boolean),
  public.export_my_data(),
  public.delete_my_account(boolean)
  to authenticated;
