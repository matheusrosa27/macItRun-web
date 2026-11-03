-- Fase 3: perfis de configuração, curtidas, comentários, denúncias e downloads.
--
-- Leitura pública só do que está publicado/visível, sempre por RLS. Nesta fase ninguém
-- escreve pelo navegador: publicar, curtir, comentar e denunciar chegam nas fases 4 e 5,
-- com validação no servidor. A API pública (/api/v1) lê pelas funções api_*.

create extension if not exists unaccent with schema extensions;

-- Ajudas ----------------------------------------------------------------------------------

-- Texto para busca: minúsculo, sem acento e só com letras e números ("DARK SOULS™ III" →
-- "dark souls tm iii").
create function private.search_text(value text)
returns text
language sql
stable
set search_path = ''
as $$
  select trim(regexp_replace(
    lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(value, ''))),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

-- Trecho legível da URL: /community/<id>/<slug>.
create function private.slugify(value text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(trim(both '-' from left(replace(private.search_text(value), ' ', '-'), 60)), ''), 'profile');
$$;

-- Id curto e difícil de adivinhar, sem letras que se confundem (0/o, 1/l).
create function private.new_profile_id()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('abcdefghijkmnpqrstuvwxyz23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 10);
$$;

create function private.jsonb_text_array(value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select jsonb_array_elements_text(value)), '{}');
$$;

-- Administradores (usado nas regras de RLS; a coluna role não é legível pelo navegador).
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users_public where id = auth.uid() and role = 'admin'
  );
$$;

-- Perfis --------------------------------------------------------------------------------

create table public.profiles (
  id text primary key default private.new_profile_id(),
  slug text not null,
  -- null: a pessoa apagou a conta e deixou os perfis ("autor removido").
  author_id uuid references public.users_public (id) on delete set null,
  -- O perfil (campo "profile" do arquivo .macitrun-profile), já validado pela API.
  payload jsonb not null,
  -- Onde foi testado (campo "testedOn"), preenchido pelo app.
  tested_on jsonb not null default '{}',
  schema_version integer not null default 1 check (schema_version = 1),
  -- "Como foi": notas do autor no site, texto puro.
  notes text not null default '' check (char_length(notes) <= 2000),
  game_name text generated always as (payload ->> 'name') stored,
  executables text[] generated always as (private.jsonb_text_array(payload -> 'executables')) stored,
  graphics text generated always as (payload ->> 'graphics') stored,
  windows_version text generated always as (payload ->> 'windowsVersion') stored,
  -- published; hidden (admin ou 3 denúncias); removed (o autor despublicou).
  status text not null default 'published' check (status in ('published', 'hidden', 'removed')),
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  downloads_count integer not null default 0,
  search tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- O banco recusa perfil acima de 16 KB, além da validação da API.
  constraint profiles_size check (octet_length(payload::text) + octet_length(tested_on::text) <= 16384),
  constraint profiles_shape check (coalesce(
    jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload -> 'id') = 'string'
    and jsonb_typeof(payload -> 'name') = 'string'
    and jsonb_typeof(payload -> 'executables') = 'array'
    and jsonb_typeof(tested_on) = 'object',
    false
  ))
);

create index profiles_author_idx on public.profiles (author_id);
create index profiles_search_idx on public.profiles using gin (search);
create index profiles_likes_idx on public.profiles (likes_count desc, created_at desc) where status = 'published';
create index profiles_recent_idx on public.profiles (created_at desc) where status = 'published';
create index profiles_downloads_idx on public.profiles (downloads_count desc, created_at desc) where status = 'published';

-- Busca por nome do jogo, executáveis (com e sem .exe) e nome do autor.
create function private.profile_search(payload jsonb, author_id uuid)
returns tsvector
language sql
stable
set search_path = ''
as $$
  select
    setweight(to_tsvector('simple', private.search_text(payload ->> 'name')), 'A')
    || setweight(to_tsvector('simple', private.search_text(
      array_to_string(private.jsonb_text_array(payload -> 'executables'), ' ')
    )), 'B')
    || setweight(to_tsvector('simple', private.search_text(
      (select username from public.users_public where id = author_id)
    )), 'C');
$$;

-- Antes de gravar: slug, busca e data. O perfil em si não muda depois de publicado
-- (publicar de novo cria outro perfil); os contadores não mexem em updated_at.
create function private.profiles_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.slug := private.slugify(new.payload ->> 'name');
    new.search := private.profile_search(new.payload, new.author_id);
    new.updated_at := new.created_at;
    return new;
  end if;
  if new.id is distinct from old.id
    or new.payload is distinct from old.payload
    or new.tested_on is distinct from old.tested_on
    or new.schema_version is distinct from old.schema_version
    or new.slug is distinct from old.slug
    or (new.author_id is distinct from old.author_id and new.author_id is not null)
    or new.created_at is distinct from old.created_at
  then
    raise exception 'profile_immutable' using errcode = '42501';
  end if;
  if new.author_id is distinct from old.author_id then
    new.search := private.profile_search(new.payload, new.author_id);
  end if;
  if new.notes is distinct from old.notes or new.status is distinct from old.status then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger profiles_before_write
  before insert or update on public.profiles
  for each row execute function private.profiles_before_write();

-- Trocou o nome de usuário: a busca dos perfis dele acompanha.
create function private.users_public_after_rename()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
    set search = private.profile_search(payload, author_id)
    where author_id = new.id;
  return null;
end;
$$;

create trigger users_public_after_rename
  after update of username on public.users_public
  for each row
  when (new.username is distinct from old.username)
  execute function private.users_public_after_rename();

-- Curtidas -----------------------------------------------------------------------------

create table public.likes (
  user_id uuid not null references public.users_public (id) on delete cascade,
  profile_id text not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, profile_id)
);

create index likes_profile_idx on public.likes (profile_id);

-- Comentários --------------------------------------------------------------------------

create table public.comments (
  id bigint generated always as identity primary key,
  profile_id text not null references public.profiles (id) on delete cascade,
  -- Apagar a conta apaga os comentários da pessoa.
  author_id uuid not null references public.users_public (id) on delete cascade,
  -- Texto puro, exibido como texto (nunca HTML).
  body text not null check (char_length(body) between 1 and 2000 and body ~ '\S'),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at timestamptz not null default now()
);

create index comments_profile_idx on public.comments (profile_id, created_at);
create index comments_author_idx on public.comments (author_id);

-- Denúncias ----------------------------------------------------------------------------

create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.users_public (id) on delete cascade,
  target_type text not null check (target_type in ('profile', 'comment')),
  target_id text not null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- Uma denúncia por pessoa e item (3 de pessoas diferentes escondem o item, na Fase 5).
  unique (reporter_id, target_type, target_id)
);

create index reports_target_idx on public.reports (target_type, target_id) where resolved_at is null;

-- Downloads: só o total por dia, sem guardar quem baixou ------------------------------------

create table public.downloads (
  profile_id text not null references public.profiles (id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (profile_id, day)
);

-- Contadores ---------------------------------------------------------------------------

create function private.count_likes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
    set likes_count = likes_count + case when tg_op = 'INSERT' then 1 else -1 end
    where id = coalesce(new.profile_id, old.profile_id);
  return null;
end;
$$;

create trigger likes_count
  after insert or delete on public.likes
  for each row execute function private.count_likes();

-- Conta só os comentários visíveis.
create function private.count_comments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  delta integer :=
    (case when tg_op <> 'DELETE' and new.status = 'visible' then 1 else 0 end)
    - (case when tg_op <> 'INSERT' and old.status = 'visible' then 1 else 0 end);
begin
  if delta <> 0 then
    update public.profiles
      set comments_count = comments_count + delta
      where id = coalesce(new.profile_id, old.profile_id);
  end if;
  return null;
end;
$$;

create trigger comments_count
  after insert or update of status or delete on public.comments
  for each row execute function private.count_comments();

-- RLS ----------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;
alter table public.downloads enable row level security;

revoke all on public.profiles, public.likes, public.comments, public.reports, public.downloads
  from anon, authenticated;

-- Perfis: todos leem os publicados; o autor e os admins veem também os escondidos.
grant select on public.profiles to anon, authenticated;
create policy "profiles: todos leem os publicados"
  on public.profiles for select
  to anon, authenticated
  using (status = 'published' or author_id = auth.uid() or private.is_admin());

-- Comentários: todos leem os visíveis de perfis publicados; admins leem todos.
grant select (id, profile_id, author_id, body, status, created_at) on public.comments
  to anon, authenticated;
create policy "comments: todos leem os visíveis"
  on public.comments for select
  to anon, authenticated
  using (
    (status = 'visible'
      and exists (select 1 from public.profiles p where p.id = profile_id and p.status = 'published'))
    or private.is_admin()
  );

-- Curtidas: cada um vê as suas (para saber se já curtiu); o total fica em likes_count.
grant select on public.likes to authenticated;
create policy "likes: cada um vê as suas"
  on public.likes for select
  to authenticated
  using (user_id = auth.uid());

-- Denúncias e downloads: só admins leem.
grant select on public.reports to authenticated;
create policy "reports: só admins leem"
  on public.reports for select
  to authenticated
  using (private.is_admin());

-- API pública ----------------------------------------------------------------------------
-- Funções de leitura da API /api/v1: só perfis publicados e comentários visíveis, já no
-- formato da resposta. Nomes de campos em camelCase, como no arquivo .macitrun-profile.

create function private.profile_summary(p public.profiles)
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
    'author', (select jsonb_build_object('username', u.username)
               from public.users_public u where u.id = p.author_id),
    'likes', p.likes_count,
    'comments', p.comments_count,
    'downloads', p.downloads_count,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at
  );
$$;

-- Termos digitados viram prefixos: "dark sou" acha "Dark Souls".
create function private.search_query(q text)
returns tsquery
language sql
stable
set search_path = ''
as $$
  select to_tsquery('simple', string_agg(word || ':*', ' & '))
  from regexp_split_to_table(private.search_text(q), ' ') word
  where word <> '';
$$;

create function public.api_list_profiles(
  q text default null,
  graphics text default null,
  sort text default 'likes',
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

-- O perfil no formato .macitrun-profile, mais os dados da comunidade.
create function public.api_get_profile(profile_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'format', 'macitrun-profile',
    'version', p.schema_version,
    'profile', p.payload,
    'testedOn', p.tested_on,
    'community', private.profile_summary(p) - 'testedOn' - 'name' - 'executables'
      - 'graphics' - 'windowsVersion' || jsonb_build_object('notes', p.notes)
  )
  from public.profiles p
  where p.id = profile_id and p.status = 'published';
$$;

create function public.api_list_comments(profile_id text, page integer default 1, page_size integer default 50)
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
          'author', (select jsonb_build_object('username', u.username)
                     from public.users_public u where u.id = v.author_id),
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

-- Soma um download (por dia, sem guardar quem). Só a API chama, com a chave secreta.
create function public.record_download(profile_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.profiles
    set downloads_count = downloads_count + 1
    where id = record_download.profile_id and status = 'published';
  if not found then
    return false;
  end if;
  insert into public.downloads as d (profile_id, day, count)
    values (record_download.profile_id, current_date, 1)
    on conflict (profile_id, day) do update set count = d.count + 1;
  return true;
end;
$$;

-- Conta ----------------------------------------------------------------------------------

-- Exportação (LGPD) agora com perfis, comentários, curtidas e denúncias.
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
      from public.reports r where r.reporter_id = u.id), '[]'::jsonb)
  )
  from auth.users u
  join public.users_public p on p.id = u.id
  where u.id = auth.uid();
$$;

-- Apagar a conta: os perfis ficam como "autor removido" (keep_profiles) ou somem junto,
-- à escolha da pessoa. Comentários, curtidas e denúncias dela sempre saem (cascade).
drop function public.delete_my_account();
create function public.delete_my_account(keep_profiles boolean default true)
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
revoke execute on function
  public.api_list_profiles(text, text, text, integer, integer),
  public.api_get_profile(text),
  public.api_list_comments(text, integer, integer),
  public.record_download(text),
  public.export_my_data(),
  public.delete_my_account(boolean)
  from public, anon, authenticated;

-- As regras de RLS chamam is_admin() com o papel de quem lê.
grant usage on schema private to anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;

grant execute on function
  public.api_list_profiles(text, text, text, integer, integer),
  public.api_get_profile(text),
  public.api_list_comments(text, integer, integer)
  to anon, authenticated;
grant execute on function public.record_download(text) to service_role;
grant execute on function public.export_my_data(), public.delete_my_account(boolean) to authenticated;
