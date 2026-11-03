// Tipos de db.mjs, para os testes em TypeScript (a API).
import type { PGlite, Transaction } from '@electric-sql/pglite';

export function createDb(options?: { seed?: boolean }): Promise<PGlite>;
export function signUp(
  db: PGlite,
  user: { email: string; metadata?: Record<string, unknown>; providers?: string[] },
): Promise<string>;
export function as<T>(db: PGlite, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T>;
export function asService<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T>;
