-- Do que cada jogo depende (campo "requires" do perfil: a loja onde ele é instalado, com o id do
-- jogo nela, e os launchers obrigatórios). Vai no resumo da lista, para a comunidade e o app
-- mostrarem, e vira o filtro "loja" da busca.

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
    'requires', p.payload -> 'requires',
    'author', private.author_json(p.author_id),
    'likes', p.likes_count,
    'comments', p.comments_count,
    'downloads', p.downloads_count,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at
  );
$$;

-- A lista ganha o filtro por loja (ex.: só perfis de jogos da Steam).
drop function public.api_list_profiles(text, text, text, integer, integer, text, text);
create function public.api_list_profiles(
  q text default null,
  graphics text default null,
  sort text default 'likes',
  page integer default 1,
  page_size integer default 20,
  windows_version text default null,
  mac text default null,
  store text default null
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
      and (nullif(api_list_profiles.store, '') is null
        or p.payload -> 'requires' -> 'stores' @> jsonb_build_array(jsonb_build_object('app', api_list_profiles.store)))
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

create index profiles_stores_idx on public.profiles using gin ((payload -> 'requires' -> 'stores'))
  where status = 'published';

revoke execute on function
  public.api_list_profiles(text, text, text, integer, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.api_list_profiles(text, text, text, integer, integer, text, text, text)
  to anon, authenticated;
