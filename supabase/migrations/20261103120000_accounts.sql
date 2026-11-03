-- Fase 2: contas.
--
-- Cada usuário do Supabase Auth (auth.users) ganha uma linha em public.users_public,
-- criada por gatilho no cadastro. O nome de usuário e o aceite dos termos vêm dos
-- metadados do cadastro por e-mail; quem entra pelo Google ou GitHub completa os dois em /account.
--
-- O navegador só lê id, username e created_at. Todo o resto (mudar o nome, aceitar os
-- termos, exportar e apagar a conta) passa por funções SECURITY DEFINER que agem sempre
-- sobre auth.uid(), para nunca precisar da chave service_role no navegador.

create schema if not exists private;
revoke all on schema private from public;

-- Nome de usuário: minúsculas, 3 a 20 caracteres, começando por letra ou número.
-- A mesma regra fica em src/app/core/auth/username.ts.
create function private.is_valid_username(name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select name ~ '^[a-z0-9][a-z0-9_-]{2,19}$'
    and name not in (
      'admin', 'administrator', 'anonymous', 'api', 'deleted', 'help', 'macitrun',
      'mod', 'moderator', 'null', 'root', 'soporte', 'support', 'suporte', 'system',
      'undefined', 'www'
    );
$$;

create table public.users_public (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique check (private.is_valid_username(username)),
  role text not null default 'user' check (role in ('user', 'admin')),
  banned boolean not null default false,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.users_public is
  'Dados públicos de cada conta. username é null até a pessoa escolher um (cadastro pelo Google ou GitHub).';

alter table public.users_public enable row level security;

-- Só as colunas públicas; role, banned e terms_accepted_at ficam de fora do navegador.
revoke all on public.users_public from anon, authenticated;
grant select (id, username, created_at) on public.users_public to anon, authenticated;

create policy "users_public: todos leem"
  on public.users_public for select
  to anon, authenticated
  using (true);

-- Cadastro: cria a linha pública. Nome inválido ou já usado vira null (a pessoa escolhe
-- outro em /account) em vez de impedir o cadastro.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := lower(nullif(trim(new.raw_user_meta_data ->> 'username'), ''));
  accepted timestamptz :=
    case when (new.raw_user_meta_data ->> 'terms_accepted') = 'true' then now() end;
begin
  if wanted is not null
    and private.is_valid_username(wanted)
    and not exists (select 1 from public.users_public where username = wanted)
  then
    begin
      insert into public.users_public (id, username, terms_accepted_at)
      values (new.id, wanted, accepted);
      return new;
    exception when unique_violation then
      -- Outro cadastro levou o nome ao mesmo tempo: segue sem nome.
      null;
    end;
  end if;

  insert into public.users_public (id, username, terms_accepted_at)
  values (new.id, null, accepted);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Nome livre? Usado no cadastro antes de enviar o formulário.
create function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_valid_username(lower(name))
    and not exists (select 1 from public.users_public where username = lower(name));
$$;

-- A própria conta, com o que o navegador não lê direto da tabela.
create function public.get_my_account()
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
    'createdAt', p.created_at
  )
  from auth.users u
  join public.users_public p on p.id = u.id
  where u.id = auth.uid();
$$;

-- Escolhe ou troca o nome de usuário. Erros com código próprio para o site traduzir.
create function public.set_username(new_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  name text := lower(trim(new_username));
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if name is null or not private.is_valid_username(name) then
    raise exception 'username_invalid' using errcode = '22023';
  end if;
  begin
    update public.users_public set username = name where id = auth.uid();
  exception when unique_violation then
    raise exception 'username_taken' using errcode = '23505';
  end;
end;
$$;

-- Aceite dos termos (cadastro pelo Google ou GitHub). Guarda só o primeiro aceite.
create function public.accept_terms()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.users_public
    set terms_accepted_at = coalesce(terms_accepted_at, now())
    where id = auth.uid();
end;
$$;

-- Cópia dos dados da pessoa (LGPD, art. 18). As próximas fases somam perfis,
-- comentários, curtidas e denúncias.
create function public.export_my_data()
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
    )
  )
  from auth.users u
  join public.users_public p on p.id = u.id
  where u.id = auth.uid();
$$;

-- Apaga a conta: auth.users leva junto identidades, sessões e users_public (cascade).
-- O registro de auditoria do Auth também guarda e-mail e IP: sai junto, se a permissão deixar.
create function public.delete_my_account()
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
  begin
    delete from auth.audit_log_entries where payload ->> 'actor_id' = me::text;
  exception when insufficient_privilege or undefined_table then
    null;
  end;
  delete from auth.users where id = me;
end;
$$;

-- Funções: ninguém executa por padrão (o Supabase concede EXECUTE a anon e authenticated
-- em toda função nova); libera só o necessário.
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function
  public.username_available(text),
  public.get_my_account(),
  public.set_username(text),
  public.accept_terms(),
  public.export_my_data(),
  public.delete_my_account()
  from public, anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function
  public.get_my_account(),
  public.set_username(text),
  public.accept_terms(),
  public.export_my_data(),
  public.delete_my_account()
  to authenticated;
