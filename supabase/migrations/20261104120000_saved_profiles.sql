-- Salvar perfis de configuração: lista particular de favoritos de cada pessoa, separada da
-- curtida (que é pública e conta no ranking). Só a própria pessoa vê o que salvou.

create table public.saved_profiles (
  user_id uuid not null references public.users_public (id) on delete cascade,
  profile_id text not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, profile_id)
);

create index saved_profiles_user_idx on public.saved_profiles (user_id, created_at desc);

alter table public.saved_profiles enable row level security;
revoke all on public.saved_profiles from anon, authenticated;
grant select on public.saved_profiles to authenticated;
create policy "saved_profiles: cada um vê os seus"
  on public.saved_profiles for select
  to authenticated
  using (user_id = auth.uid());

-- Salvar (saved = true) ou tirar dos salvos. Salvar duas vezes guarda uma. Só perfis
-- publicados entram; tirar vale sempre (mesmo se o perfil sumiu ou a conta foi banida).
create function public.save_profile(profile_id text, saved boolean default true)
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
    perform private.require_published(save_profile.profile_id);
    if (select count(*) from public.saved_profiles s where s.user_id = me) >= 500 then
      raise exception 'save_limit' using errcode = '54000';
    end if;
    insert into public.saved_profiles (user_id, profile_id)
      values (me, save_profile.profile_id)
      on conflict do nothing;
  else
    delete from public.saved_profiles where user_id = me and profile_id = save_profile.profile_id;
  end if;
  return jsonb_build_object('saved', coalesce(saved, true));
end;
$$;

-- Os salvos da pessoa, mais recentes primeiro, no formato da lista da comunidade. Perfis que
-- saíram do ar (escondidos ou despublicados) aparecem como indisponíveis, para poder tirar.
create function public.my_saved_profiles()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    case when p.status = 'published'
      then private.profile_summary(p) || jsonb_build_object('available', true, 'savedAt', s.created_at)
      else jsonb_build_object('id', p.id, 'name', p.game_name, 'available', false, 'savedAt', s.created_at)
    end
    order by s.created_at desc), '[]'::jsonb)
  from public.saved_profiles s
  join public.profiles p on p.id = s.profile_id
  where s.user_id = auth.uid();
$$;

-- Exportação (LGPD) também com os salvos.
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
      from public.saved_profiles s where s.user_id = u.id), '[]'::jsonb)
  )
  from auth.users u
  join public.users_public p on p.id = u.id
  where u.id = auth.uid();
$$;

revoke execute on function
  public.save_profile(text, boolean),
  public.my_saved_profiles()
  from public, anon, authenticated;
grant execute on function
  public.save_profile(text, boolean),
  public.my_saved_profiles()
  to authenticated;
