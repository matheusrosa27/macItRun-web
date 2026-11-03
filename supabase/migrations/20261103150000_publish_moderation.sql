-- Fase 5: publicar e moderar.
--
-- Publicar: só a API (service_role) grava perfis, depois de validar o arquivo com o schema do
-- perfil (Zod); o banco confere de novo a conta, o limite diário, o tamanho e a forma.
-- O autor edita as notas e despublica os próprios perfis. Denúncias: 3 pessoas diferentes
-- escondem o item até um admin revisar. Admins ocultam, restauram e banem.
-- Limites: 10 perfis, 60 comentários e 20 denúncias por pessoa por dia; por IP, na API.

-- Conta que pode participar, pelo id (a API publica em nome da pessoa, com a chave secreta).
create function private.require_member_id(user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  member public.users_public;
begin
  if user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into member from public.users_public where id = user_id;
  if not found or member.username is null or member.terms_accepted_at is null then
    raise exception 'account_incomplete' using errcode = '42501';
  end if;
  if member.banned then
    raise exception 'user_banned' using errcode = '42501';
  end if;
  return user_id;
end;
$$;

create or replace function private.require_member()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_member_id(auth.uid());
$$;

-- Texto puro de até `max_length` caracteres (notas e motivos). Vazio vira ''.
create function private.clean_text(value text, max_length integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := btrim(replace(replace(coalesce(value, ''), E'\r\n', E'\n'), E'\r', E'\n'), E' \n\t');
begin
  if char_length(cleaned) > max_length
    or cleaned ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f\u2028\u2029]'
  then
    raise exception 'text_invalid' using errcode = '22023';
  end if;
  return cleaned;
end;
$$;

create function private.require_under_daily_limit(counted bigint, max_per_day integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if counted >= max_per_day then
    raise exception 'daily_limit' using errcode = '54000';
  end if;
end;
$$;

-- Publicar ------------------------------------------------------------------------------

-- Só a API chama, com a chave secreta, depois de validar o arquivo e o login da pessoa.
create function public.publish_profile(author_id uuid, payload jsonb, tested_on jsonb, notes text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := private.require_member_id(publish_profile.author_id);
  created public.profiles;
begin
  perform private.require_under_daily_limit(
    (select count(*) from public.profiles p
     where p.author_id = me and p.created_at > now() - interval '1 day'),
    10
  );
  insert into public.profiles (author_id, payload, tested_on, notes)
    values (me, publish_profile.payload, coalesce(publish_profile.tested_on, '{}'), private.clean_text(publish_profile.notes, 2000))
    returning * into created;
  return jsonb_build_object('id', created.id, 'slug', created.slug);
end;
$$;

-- Os perfis da própria pessoa, publicados ou não (para /account).
create function public.my_profiles()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'slug', p.slug,
    'name', p.game_name,
    'status', p.status,
    'notes', p.notes,
    'likes', p.likes_count,
    'comments', p.comments_count,
    'downloads', p.downloads_count,
    'createdAt', p.created_at
  ) order by p.created_at desc), '[]'::jsonb)
  from public.profiles p
  where p.author_id = auth.uid();
$$;

create function public.update_profile_notes(profile_id text, notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := private.require_member();
begin
  update public.profiles
    set notes = private.clean_text(update_profile_notes.notes, 2000)
    where id = update_profile_notes.profile_id and author_id = me and status <> 'removed';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Despublicar: some da comunidade (o autor ainda vê em /account). Vale mesmo banido.
create function public.unpublish_profile(profile_id text)
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
  update public.profiles
    set status = 'removed'
    where id = unpublish_profile.profile_id and author_id = me and status <> 'removed';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Comentar: agora com limite diário ------------------------------------------------------

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
    'author', (select jsonb_build_object('username', u.username) from public.users_public u where u.id = me),
    'body', created.body,
    'createdAt', created.created_at
  );
end;
$$;

-- Denúncias ------------------------------------------------------------------------------

alter table public.reports drop constraint reports_reason_check;
alter table public.reports
  add constraint reports_reason_check check (reason in ('spam', 'offensive', 'cheating', 'unsafe', 'other')),
  add column detail text not null default '' check (char_length(detail) <= 500);

-- Quantas pessoas diferentes denunciaram e ainda esperam revisão para esconder o item.
create function private.hide_after_reports()
returns integer
language sql
immutable
as $$ select 3 $$;

-- Denunciar um perfil publicado ou um comentário visível de outra pessoa. Denunciar de novo
-- o mesmo item não conta outra vez. Com 3 denúncias de pessoas diferentes, o item some até
-- um admin revisar.
create function public.report(target_type text, target_id text, reason text, detail text default '')
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
    else
      update public.comments set status = 'hidden' where id = report.target_id::bigint and status = 'visible';
    end if;
    hidden := true;
  end if;
  return jsonb_build_object('reported', true, 'hidden', hidden);
end;
$$;

-- Moderação (admins) ---------------------------------------------------------------------

create function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
end;
$$;

-- O item denunciado, para a tela de moderação.
create function private.moderation_target(target_type text, target_id text)
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
    else (
      select jsonb_build_object(
        'profileId', p.id, 'slug', p.slug, 'name', p.game_name, 'body', c.body, 'status', c.status,
        'author', (select jsonb_build_object('id', u.id, 'username', u.username, 'banned', u.banned)
                   from public.users_public u where u.id = c.author_id))
      from public.comments c join public.profiles p on p.id = c.profile_id
      where target_id ~ '^\d{1,18}$' and c.id = target_id::bigint)
  end;
$$;

-- Denúncias abertas, agrupadas por item, as com mais denúncias primeiro.
create function public.admin_open_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(item order by (item ->> 'count')::int desc, item ->> 'lastAt' desc)
    from (
      select jsonb_build_object(
        'targetType', r.target_type,
        'targetId', r.target_id,
        'count', count(*),
        'lastAt', max(r.created_at),
        'reports', jsonb_agg(jsonb_build_object(
          'reason', r.reason,
          'detail', r.detail,
          'reporter', (select u.username from public.users_public u where u.id = r.reporter_id),
          'createdAt', r.created_at
        ) order by r.created_at),
        'target', private.moderation_target(r.target_type, r.target_id)
      ) as item
      from public.reports r
      where r.resolved_at is null
      group by r.target_type, r.target_id
    ) grouped
  ), '[]'::jsonb);
end;
$$;

-- Itens escondidos (por admin ou por denúncias), para restaurar.
create function public.admin_hidden_items()
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
    ) items
  ), '[]'::jsonb);
end;
$$;

-- Decide um item: esconder (hide = true) ou manter/restaurar; as denúncias abertas dele
-- ficam resolvidas. Perfil despublicado pelo autor não volta por aqui.
create function public.admin_moderate(target_type text, target_id text, hide boolean)
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

-- Banir tira publicar, comentar, curtir e denunciar; o que já foi publicado fica como está.
create function public.admin_set_banned(user_id uuid, banned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  if admin_set_banned.user_id = auth.uid() then
    raise exception 'own_content' using errcode = '42501';
  end if;
  update public.users_public set banned = admin_set_banned.banned where id = admin_set_banned.user_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Limite por IP na API --------------------------------------------------------------------

-- Contagem por janela de tempo. A chave é um hash do IP feito na API (o IP nunca chega aqui)
-- e as linhas somem depois de um dia.
create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

create function public.api_rate_limit(key text, max_hits integer, window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  started timestamptz := to_timestamp(
    floor(extract(epoch from now()) / window_seconds) * window_seconds
  );
  total integer;
begin
  insert into private.rate_limits as r (key, window_start, hits)
    values (api_rate_limit.key, started, 1)
    on conflict (key, window_start) do update set hits = r.hits + 1
    returning hits into total;
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;
  return total <= max_hits;
end;
$$;

-- Permissões das funções -----------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;

revoke execute on function
  public.publish_profile(uuid, jsonb, jsonb, text),
  public.my_profiles(),
  public.update_profile_notes(text, text),
  public.unpublish_profile(text),
  public.add_comment(text, text),
  public.report(text, text, text, text),
  public.admin_open_reports(),
  public.admin_hidden_items(),
  public.admin_moderate(text, text, boolean),
  public.admin_set_banned(uuid, boolean),
  public.api_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.publish_profile(uuid, jsonb, jsonb, text),
  public.api_rate_limit(text, integer, integer)
  to service_role;
grant execute on function
  public.my_profiles(),
  public.update_profile_notes(text, text),
  public.unpublish_profile(text),
  public.add_comment(text, text),
  public.report(text, text, text, text),
  public.admin_open_reports(),
  public.admin_hidden_items(),
  public.admin_moderate(text, text, boolean),
  public.admin_set_banned(uuid, boolean)
  to authenticated;
