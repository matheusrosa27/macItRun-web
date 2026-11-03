// Postgres em memória (PGlite) com o mínimo do Supabase que as migrações usam:
// papéis anon/authenticated/service_role, schema auth com users/identities/audit_log_entries,
// auth.uid() lido do JWT da sessão, o schema extensions e os privilégios padrão do Supabase.
import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SUPABASE = join(import.meta.dirname, '..');
const MIGRATIONS = join(SUPABASE, 'migrations');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}',
    raw_app_meta_data jsonb not null default '{}',
    created_at timestamptz not null default now(),
    last_sign_in_at timestamptz
  );
  create table auth.identities (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    provider text not null
  );
  create table auth.audit_log_entries (
    id uuid primary key default gen_random_uuid(),
    payload json
  );

  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated;

  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

/** Banco novo com todas as migrações aplicadas, na ordem dos nomes (e o seed, se pedir). */
export async function createDb({ seed = false } = {}) {
  const db = new PGlite({ extensions: { unaccent } });
  await db.exec(SUPABASE_STUB);
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await db.exec(await readFile(join(MIGRATIONS, file), 'utf8'));
  }
  if (seed) await db.exec(await readFile(join(SUPABASE, 'seed.sql'), 'utf8'));
  return db;
}

/** Cria um usuário como o Supabase Auth faria no cadastro. */
export async function signUp(db, { email, metadata = {}, providers = ['email'] }) {
  const { rows } = await db.query(
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
     values ($1, $2, $3) returning id`,
    [email, metadata, { provider: providers[0], providers }],
  );
  const id = rows[0].id;
  for (const provider of providers) {
    await db.query('insert into auth.identities (user_id, provider) values ($1, $2)', [id, provider]);
  }
  return id;
}

/**
 * Roda `fn` como o navegador: papel anon (sem userId) ou authenticated (com o JWT da
 * pessoa), dentro de uma transação desfeita no fim só se `fn` falhar.
 */
export async function as(db, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' }),
    ]);
    return fn(tx);
  });
}

/** Roda `fn` como a API no servidor, com a chave secreta (papel service_role). */
export async function asService(db, fn) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return fn(tx);
  });
}
