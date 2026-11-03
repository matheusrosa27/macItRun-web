-- Fase 4: comunidade. Curtir, comentar e apagar o próprio comentário; filtros por versão do
-- Windows e Mac testado na lista.
--
-- Toda escrita passa por estas funções (SECURITY DEFINER sobre auth.uid()), que validam no
-- servidor: conta completa (nome e termos), sem banimento, perfil publicado, texto puro.

-- Quem pode participar: logado, com nome de usuário e termos aceitos, e sem banimento.
create function private.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  member public.users_public;
begin
  if me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into member from public.users_public where id = me;
  if member.username is null or member.terms_accepted_at is null then
    raise exception 'account_incomplete' using errcode = '42501';
  end if;
  if member.banned then
    raise exception 'user_banned' using errcode = '42501';
  end if;
  return me;
end;
$$;

create function private.require_published(profile_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = profile_id and p.status = 'published') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Curtir (liked = true) ou descurtir. Curtir duas vezes conta uma.
create function public.like_profile(profile_id text, liked boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := private.require_member();
begin
  perform private.require_published(like_profile.profile_id);
  if coalesce(liked, true) then
    insert into public.likes (user_id, profile_id)
      values (me, like_profile.profile_id)
      on conflict do nothing;
  else
    delete from public.likes where user_id = me and profile_id = like_profile.profile_id;
  end if;
  return jsonb_build_object(
    'liked', coalesce(liked, true),
    'likes', (select p.likes_count from public.profiles p where p.id = like_profile.profile_id)
  );
end;
$$;

-- Texto de comentário: quebras de linha normalizadas, sem espaços nas pontas, 1 a 2.000
-- caracteres e sem caracteres de controle (fora quebra de linha e tab). Guardado como texto
-- puro; quem exibe trata como texto, nunca HTML.
create function private.clean_comment(body text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := btrim(replace(replace(coalesce(body, ''), E'\r\n', E'\n'), E'\r', E'\n'), E' \n\t');
begin
  if char_length(cleaned) not between 1 and 2000
    or cleaned ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f\u2028\u2029]'
  then
    raise exception 'comment_invalid' using errcode = '22023';
  end if;
  return cleaned;
end;
$$;

create function public.add_comment(profile_id text, body text)
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
  insert into public.comments (profile_id, author_id, body)
    values (add_comment.profile_id, me, private.clean_comment(add_comment.body))
    returning * into created;
  return jsonb_build_object(
    'id', created.id,
    'author', (select jsonb_build_object('username', u.username) from public.users_public u where u.id = me),
    'body', created.body,
    'createdAt', created.created_at
  );
end;
$$;

-- O autor apaga o próprio comentário (vale mesmo banido: apagar é sempre permitido).
create function public.delete_comment(comment_id bigint)
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
  delete from public.comments where id = comment_id and author_id = me;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Lista com os filtros da página Comunidade: versão do Windows e Mac testado.
drop function public.api_list_profiles(text, text, text, integer, integer);
create function public.api_list_profiles(
  q text default null,
  graphics text default null,
  sort text default 'likes',
  page integer default 1,
  page_size integer default 20,
  windows_version text default null,
  mac text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  query tsquery := private.search_query(left(q, 100));
  size integer := least(greatest(coalesce(page_size, 20), 1), 50);
  current_page integer := greatest(coalesce(page, 1), 1);
  result jsonb;
begin
  if sort is not null and sort not in ('likes', 'recent', 'downloads') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;
  with matches as (
    select p.*
    from public.profiles p
    where p.status = 'published'
      and (query is null or p.search @@ query)
      and (nullif(api_list_profiles.graphics, '') is null or p.graphics = api_list_profiles.graphics)
      and (nullif(api_list_profiles.windows_version, '') is null
        or p.windows_version = api_list_profiles.windows_version)
      and (nullif(api_list_profiles.mac, '') is null or p.tested_on ->> 'mac' = api_list_profiles.mac)
  ),
  ordered as (
    select m.id, row_number() over (
      order by
        case coalesce(sort, 'likes')
          when 'likes' then m.likes_count
          when 'downloads' then m.downloads_count
          else 0
        end desc,
        m.created_at desc,
        m.id
    ) as position
    from matches m
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(private.profile_summary(p) order by o.position)
       from ordered o
       join public.profiles p on p.id = o.id
       where o.position > (current_page - 1) * size and o.position <= current_page * size),
      '[]'::jsonb),
    'page', current_page,
    'pageSize', size,
    'total', (select count(*) from matches)
  ) into result;
  return result;
end;
$$;

-- Valores para os filtros: os Macs em que há perfis publicados testados.
create function public.api_profile_filters()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'macs', coalesce(
      (select jsonb_agg(mac order by mac)
       from (select distinct p.tested_on ->> 'mac' as mac
             from public.profiles p
             where p.status = 'published' and p.tested_on ->> 'mac' is not null) macs),
      '[]'::jsonb)
  );
$$;

create index profiles_windows_idx on public.profiles (windows_version) where status = 'published';
create index profiles_mac_idx on public.profiles ((tested_on ->> 'mac')) where status = 'published';

-- Permissões das funções -----------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;

revoke execute on function
  public.like_profile(text, boolean),
  public.add_comment(text, text),
  public.delete_comment(bigint),
  public.api_list_profiles(text, text, text, integer, integer, text, text),
  public.api_profile_filters()
  from public, anon, authenticated;
grant execute on function
  public.api_list_profiles(text, text, text, integer, integer, text, text),
  public.api_profile_filters()
  to anon, authenticated;
grant execute on function
  public.like_profile(text, boolean),
  public.add_comment(text, text),
  public.delete_comment(bigint)
  to authenticated;
