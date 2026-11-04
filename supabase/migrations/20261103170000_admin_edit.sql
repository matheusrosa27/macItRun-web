-- Admins editam e apagam perfis de configuração (e apagam comentários).
--
-- Editar passa pela API, que valida o arquivo com o schema do perfil antes; o banco confere
-- se quem pede é admin. Só nessa edição o perfil publicado pode mudar (arquivo, autor), e o
-- slug e a busca acompanham. Apagar leva junto curtidas, comentários, downloads e denúncias.

-- A trava do perfil publicado abre só durante admin_update_profile (marca na transação).
create or replace function private.profiles_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_edit boolean := coalesce(current_setting('macitrun.admin_edit', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.slug := private.slugify(new.payload ->> 'name');
    new.search := private.profile_search(new.payload, new.author_id);
    new.updated_at := new.created_at;
    return new;
  end if;
  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or (not admin_edit and (
      new.payload is distinct from old.payload
      or new.tested_on is distinct from old.tested_on
      or new.schema_version is distinct from old.schema_version
      or new.slug is distinct from old.slug
      or (new.author_id is distinct from old.author_id and new.author_id is not null)
    ))
  then
    raise exception 'profile_immutable' using errcode = '42501';
  end if;
  if admin_edit and new.payload is distinct from old.payload then
    new.slug := private.slugify(new.payload ->> 'name');
  end if;
  if new.author_id is distinct from old.author_id or new.payload is distinct from old.payload then
    new.search := private.profile_search(new.payload, new.author_id);
  end if;
  if new.notes is distinct from old.notes
    or new.status is distinct from old.status
    or new.payload is distinct from old.payload
    or new.tested_on is distinct from old.tested_on
    or new.author_id is distinct from old.author_id
  then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create function private.require_admin_id(user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if user_id is null or not exists (
    select 1 from public.users_public where id = user_id and role = 'admin'
  ) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
end;
$$;

-- Só a API chama (com a chave secreta), depois de validar o arquivo e o login.
-- Campos null ficam como estão; `set_author` com `author` null deixa o perfil sem autor.
create function public.admin_update_profile(
  admin_id uuid,
  profile_id text,
  payload jsonb default null,
  tested_on jsonb default null,
  notes text default null,
  status text default null,
  set_author boolean default false,
  author text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  new_author uuid;
  updated public.profiles;
begin
  perform private.require_admin_id(admin_update_profile.admin_id);
  if set_author and admin_update_profile.author is not null then
    select u.id into new_author from public.users_public u where u.username = lower(admin_update_profile.author);
    if not found then
      raise exception 'author_not_found' using errcode = 'P0002';
    end if;
  end if;
  perform set_config('macitrun.admin_edit', 'on', true);
  update public.profiles p set
    payload = coalesce(admin_update_profile.payload, p.payload),
    tested_on = coalesce(admin_update_profile.tested_on, p.tested_on),
    notes = case when admin_update_profile.notes is null then p.notes
                 else private.clean_text(admin_update_profile.notes, 2000) end,
    status = coalesce(admin_update_profile.status, p.status),
    author_id = case when set_author then new_author else p.author_id end
  where p.id = admin_update_profile.profile_id
  returning * into updated;
  perform set_config('macitrun.admin_edit', 'off', true);
  if updated.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', updated.id, 'slug', updated.slug, 'status', updated.status);
end;
$$;

create function public.admin_delete_profile(profile_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  delete from public.reports r
    where (r.target_type = 'profile' and r.target_id = admin_delete_profile.profile_id)
       or (r.target_type = 'comment' and r.target_id in (
             select c.id::text from public.comments c where c.profile_id = admin_delete_profile.profile_id));
  delete from public.profiles where id = admin_delete_profile.profile_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.admin_delete_comment(comment_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  delete from public.reports where target_type = 'comment' and target_id = admin_delete_comment.comment_id::text;
  delete from public.comments where id = admin_delete_comment.comment_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- O arquivo completo de um perfil em qualquer situação (para o admin editar um escondido).
create function public.admin_get_profile(profile_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_admin();
  return (
    select jsonb_build_object(
      'format', 'macitrun-profile',
      'version', p.schema_version,
      'profile', p.payload,
      'testedOn', p.tested_on,
      'notes', p.notes,
      'status', p.status,
      'author', (select u.username from public.users_public u where u.id = p.author_id)
    )
    from public.profiles p where p.id = admin_get_profile.profile_id
  );
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;

revoke execute on function
  public.admin_update_profile(uuid, text, jsonb, jsonb, text, text, boolean, text),
  public.admin_delete_profile(text),
  public.admin_delete_comment(bigint),
  public.admin_get_profile(text)
  from public, anon, authenticated;
grant execute on function public.admin_update_profile(uuid, text, jsonb, jsonb, text, text, boolean, text)
  to service_role;
grant execute on function
  public.admin_delete_profile(text),
  public.admin_delete_comment(bigint),
  public.admin_get_profile(text)
  to authenticated;
