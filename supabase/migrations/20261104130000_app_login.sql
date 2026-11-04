-- Login do app de Mac pelo navegador. A pessoa entra no site como quiser (e-mail, Google ou
-- GitHub), autoriza o macItRun em /<idioma>/app-login e o site devolve um código de uso único
-- para o app (macitrun://auth-callback?code=...). O app troca o código, com o segredo que só ele
-- tem (PKCE: o desafio é o SHA-256 desse segredo), por um token de login próprio. Assim o app
-- ganha uma sessão só dele, e outro programa que capture o link não consegue usar o código.
--
-- Só a API (service_role) mexe nesta tabela; nada fica exposto ao navegador.

create table private.app_logins (
  code text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  challenge text not null,
  -- Hash do link de login gerado pelo Supabase Auth (auth.admin.generateLink).
  token_hash text not null,
  created_at timestamptz not null default now()
);

create index app_logins_user_idx on private.app_logins (user_id, created_at desc);

-- Guarda um pedido de login. Limpa os vencidos e no máximo 5 pendentes por pessoa.
create function public.app_login_create(code text, user_id uuid, challenge text, token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if app_login_create.code !~ '^[A-Za-z0-9_-]{32,64}$'
     or app_login_create.challenge !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  delete from private.app_logins where created_at < now() - interval '5 minutes';
  if (select count(*) from private.app_logins a where a.user_id = app_login_create.user_id) >= 5 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  insert into private.app_logins (code, user_id, challenge, token_hash)
    values (app_login_create.code, app_login_create.user_id, app_login_create.challenge, app_login_create.token_hash);
  return jsonb_build_object('code', app_login_create.code);
end;
$$;

-- Troca o código pelo token de login. O código vale uma vez (mesmo se o segredo vier errado)
-- e por 5 minutos; devolve null se não valer.
create function public.app_login_redeem(code text, verifier_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  pending private.app_logins;
begin
  delete from private.app_logins a where a.code = app_login_redeem.code returning * into pending;
  if pending is null or pending.created_at < now() - interval '5 minutes'
     or pending.challenge <> app_login_redeem.verifier_hash then
    return null;
  end if;
  return jsonb_build_object('tokenHash', pending.token_hash);
end;
$$;

revoke execute on function
  public.app_login_create(text, uuid, text, text),
  public.app_login_redeem(text, text)
  from public, anon, authenticated;
grant execute on function
  public.app_login_create(text, uuid, text, text),
  public.app_login_redeem(text, text)
  to service_role;
