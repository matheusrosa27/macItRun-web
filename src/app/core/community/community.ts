import type { GameProfile, Graphics, ProfileIssue, TestedOn, WindowsVersion } from '@macitrun/profile-schema';
import { PUBLIC_ENV } from '../../../environments/public-env';

export type { GameProfile, Graphics, ProfileIssue, TestedOn, WindowsVersion };

// Os mesmos valores do pacote do perfil; copiados para não trazer o Zod para estas páginas.
export const GRAPHICS: readonly Graphics[] = ['dxmt', 'dxvk', 'wine'];
export const WINDOWS_VERSIONS: readonly WindowsVersion[] = ['win11', 'win10', 'win81', 'win8', 'win7', 'winxp'];

/**
 * A API pública (/api/v1), chamada direto na Edge Function do Supabase: funciona igual no
 * servidor, no navegador e em desenvolvimento (o atalho /api/v1 do domínio só existe na Vercel).
 */
export const API_BASE = PUBLIC_ENV.supabaseUrl ? `${PUBLIC_ENV.supabaseUrl}/functions/v1/api/v1` : '';
export const COMMUNITY_ENABLED = Boolean(API_BASE);

export const SORTS = ['likes', 'recent', 'downloads'] as const;
export type Sort = (typeof SORTS)[number];
export const PAGE_SIZE = 20;

export interface Author {
  username: string | null;
}

/** Um perfil na lista (GET /profiles). */
export interface ProfileSummary {
  id: string;
  slug: string;
  name: string;
  executables: string[];
  graphics: Graphics | null;
  windowsVersion: WindowsVersion | null;
  testedOn: TestedOn;
  /** null: a pessoa apagou a conta e deixou o perfil. */
  author: Author | null;
  likes: number;
  comments: number;
  downloads: number;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Um perfil completo (GET /profiles/{id}): o arquivo .macitrun-profile mais a comunidade. */
export interface ProfileDetail {
  format: 'macitrun-profile';
  version: 1;
  profile: GameProfile;
  testedOn?: TestedOn;
  community: {
    id: string;
    slug: string;
    author: Author | null;
    /** "Como foi": notas do autor no site, texto puro. */
    notes: string;
    likes: number;
    comments: number;
    downloads: number;
    createdAt: string;
    updatedAt: string;
  };
}

export interface ProfileComment {
  id: number;
  author: Author | null;
  /** Texto puro: exibir sempre como texto. */
  body: string;
  createdAt: string;
}

export interface ListParams {
  q?: string;
  graphics?: string;
  windowsVersion?: string;
  mac?: string;
  sort?: string;
  page?: number;
}

/** Abre o app de Mac, que busca o perfil na API. */
export const importUrl = (id: string) => `macitrun://import-profile?id=${encodeURIComponent(id)}`;
export const downloadUrl = (id: string) => `${API_BASE}/profiles/${encodeURIComponent(id)}/download`;

/** Um perfil da própria pessoa, em /account (inclusive despublicados e ocultos). */
export interface MyProfile {
  id: string;
  slug: string;
  name: string;
  status: 'published' | 'hidden' | 'removed';
  notes: string;
  likes: number;
  comments: number;
  downloads: number;
  createdAt: string;
}

export const REPORT_REASONS = ['spam', 'offensive', 'cheating', 'unsafe', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export interface ReportTarget {
  type: 'profile' | 'comment';
  id: string;
}

/** Falha ao publicar: `code` da API e, se o arquivo foi recusado, os problemas dele. */
export class PublishError extends Error {
  readonly code: string;
  readonly issues: ProfileIssue[];

  constructor(code: string, issues: ProfileIssue[]) {
    super(code);
    this.code = code;
    this.issues = issues;
  }
}
