import type {
  GameProfile,
  Graphics,
  ProfileIssue,
  RequirableApp,
  Requires,
  TestedOn,
  WindowsVersion,
} from '@macitrun/profile-schema';
import { PUBLIC_ENV } from '../../../environments/public-env';

export type { GameProfile, Graphics, ProfileIssue, RequirableApp, Requires, TestedOn, WindowsVersion };

// Os mesmos valores do pacote do perfil; copiados para não trazer o Zod para estas páginas.
export const GRAPHICS: readonly Graphics[] = ['dxmt', 'dxvk', 'wine'];
export const WINDOWS_VERSIONS: readonly WindowsVersion[] = ['win11', 'win10', 'win81', 'win8', 'win7', 'winxp'];
/** Lojas e launchers que um jogo pode exigir (catálogo "Apps prontos" do app). */
export const REQUIRABLE_APPS: readonly RequirableApp[] = [
  'steam',
  'epic-games',
  'gog-galaxy',
  'ubisoft-connect',
  'ea-app',
  'rockstar',
];

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
  /** Tags públicas (admin, legend, veteran, contributor, newcomer, pioneer). */
  badges?: string[];
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
  /** Loja(s) onde o jogo é instalado e launchers obrigatórios; null se o perfil não diz. */
  requires?: Requires | null;
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
  store?: string;
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
  type: 'profile' | 'comment' | 'topic' | 'reply';
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

/** O perfil como o admin edita (admin_get_profile). */
export interface AdminProfile {
  format: 'macitrun-profile';
  version: 1;
  profile: GameProfile;
  testedOn: TestedOn;
  notes: string;
  status: 'published' | 'hidden' | 'removed';
  author: string | null;
}

/** O que o admin muda; o que não vier fica como está. `author: null` tira o autor. */
export interface AdminChanges {
  file?: string;
  notes?: string;
  status?: 'published' | 'hidden' | 'removed';
  author?: string | null;
}

/** Um perfil salvo pela pessoa. Fora do ar (escondido ou despublicado), só id e nome. */
export type SavedProfile = (ProfileSummary & { available: true; savedAt: string }) | {
  id: string;
  name: string;
  available: false;
  savedAt: string;
};

// Fórum -----------------------------------------------------------------------------------

/** Ordem da lista do fórum: última atividade (padrão), mais novos ou mais respondidos. */
export const TOPIC_SORTS = ['activity', 'recent', 'replies'] as const;
export type TopicSort = (typeof TOPIC_SORTS)[number];

// Os mesmos limites do banco (migração do fórum).
export const TOPIC_TITLE_MIN = 3;
export const TOPIC_TITLE_MAX = 120;
export const TOPIC_BODY_MAX = 10000;
export const REPLY_MAX = 5000;
export const TOPIC_TAGS_MAX = 5;
export const TOPIC_TAG_MAX = 30;
export const TOPIC_PROFILES_MAX = 5;

/** Um tópico na lista (GET /topics). Texto vindo de usuário: exibir sempre como texto. */
export interface TopicSummary {
  id: string;
  slug: string;
  title: string;
  /** Começo do texto, numa linha só (até 200 caracteres). */
  excerpt: string;
  tags: string[];
  /** null: a pessoa apagou a conta e deixou o tópico. */
  author: Author | null;
  replies: number;
  /** Quantos perfis de configuração publicados o tópico cita. */
  profiles: number;
  createdAt: string;
  /** Última resposta (ou a criação). */
  activityAt: string;
  editedAt: string | null;
}

/** Um perfil de configuração citado num tópico. */
export interface TopicProfile {
  id: string;
  slug: string;
  name: string;
  graphics: Graphics | null;
  author: Author | null;
}

/** Um tópico completo (GET /topics/{id}). */
export interface TopicDetail extends Omit<TopicSummary, 'excerpt' | 'profiles'> {
  body: string;
  profiles: TopicProfile[];
}

export type TopicReply = ProfileComment;

export interface TopicTag {
  tag: string;
  count: number;
}

export interface TopicListParams {
  q?: string;
  tag?: string;
  /** Só tópicos que citam este perfil de configuração. */
  profile?: string;
  sort?: string;
  page?: number;
}

/** O que a pessoa escreve ao criar ou editar um tópico. */
export interface TopicInput {
  title: string;
  body: string;
  tags: string[];
  profileIds: string[];
}

/**
 * Tag como o banco guarda (private.clean_tag): minúscula, sem acento, palavras ligadas por
 * hífen ("Dark Souls III" → "dark-souls-iii"). O banco normaliza de novo.
 */
export function cleanTag(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
