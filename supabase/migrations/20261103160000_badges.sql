-- Tags públicas de cada pessoa, ao lado do nome de usuário em todo o site e na API.
--
--   admin        administra a comunidade (sempre visível, para todos saberem quem modera)
--   legend       20 ou mais perfis de configuração publicados, ou 100 curtidas recebidas
--   veteran      5 ou mais perfis publicados, ou 25 curtidas recebidas
--   contributor  pelo menos 1 perfil publicado
--   newcomer     ainda não publicou nenhum perfil
--   pioneer      uma das 100 primeiras contas do site
--
-- Calculadas na hora (nada novo é guardado). As mesmas regras ficam explicadas em
-- src/app/core/community/badges.ts e nas traduções (badges.*).

create or replace function private.user_badges(user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with person as (
    select u.id, u.role, u.created_at from public.users_public u where u.id = user_id
  ),
  stats as (
    select count(*) as profiles, coalesce(sum(p.likes_count), 0) as likes
    from public.profiles p
    where p.author_id = user_id and p.status = 'published'
  ),
  earlier as (
    select count(*) as accounts
    from public.users_public u, person
    where u.created_at < person.created_at or (u.created_at = person.created_at and u.id < person.id)
  )
  select coalesce(jsonb_agg(badge order by position), '[]'::jsonb)
  from person, stats, earlier,
    lateral (values
      (1, case when person.role = 'admin' then 'admin' end),
      (2, case
            when stats.profiles >= 20 or stats.likes >= 100 then 'legend'
            when stats.profiles >= 5 or stats.likes >= 25 then 'veteran'
            when stats.profiles >= 1 then 'contributor'
            else 'newcomer'
          end),
      (3, case when earlier.accounts < 100 then 'pioneer' end)
    ) as badges(position, badge)
  where badge is not null;
$$;

-- Autor como a API mostra: nome e tags. null se a conta foi apagada.
create or replace function private.author_json(user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('username', u.username, 'badges', private.user_badges(u.id))
  from public.users_public u
  where u.id = user_id;
$$;

create index if not exists users_public_created_idx on public.users_public (created_at, id);

create or replace function private.profile_summary(p public.profiles)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'slug', p.slug,
    'name', p.game_name,
    'executables', to_jsonb(p.executables),
    'graphics', p.graphics,
    'windowsVersion', p.windows_version,
    'testedOn', p.tested_on,
    'author', private.author_json(p.author_id),
    'likes', p.likes_count,
    'comments', p.comments_count,
    'downloads', p.downloads_count,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at
  );
$$;

create or replace function public.api_list_comments(profile_id text, page integer default 1, page_size integer default 50)
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
    select c.*, row_number() over (order by c.created_at, c.id) as position
    from public.comments c
    where c.profile_id = api_list_comments.profile_id and c.status = 'visible'
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
    select 1 from public.profiles p where p.id = api_list_comments.profile_id and p.status = 'published'
  );
$$;

create or replace function public.add_comment(profile_id text, body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := private.require_member();
  created public.comments;
begin
  perform private.require_published(add_comment.profile_id);
  perform private.require_under_daily_limit(
    (select count(*) from public.comments c
     where c.author_id = me and c.created_at > now() - interval '1 day'),
    60
  );
  insert into public.comments (profile_id, author_id, body)
    values (add_comment.profile_id, me, private.clean_comment(add_comment.body))
    returning * into created;
  return jsonb_build_object(
    'id', created.id,
    'author', private.author_json(me),
    'body', created.body,
    'createdAt', created.created_at
  );
end;
$$;

-- A própria conta também mostra as tags (em /account).
create or replace function public.get_my_account()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'providers', coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb),
    'username', p.username,
    'role', p.role,
    'banned', p.banned,
    'termsAcceptedAt', p.terms_accepted_at,
    'createdAt', p.created_at,
    'badges', private.user_badges(p.id)
  )
  from auth.users u
  join public.users_public p on p.id = u.id
  where u.id = auth.uid();
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;
