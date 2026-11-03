import { RUNTIME_REPO } from '../site';

/** O que o site mostra da release mais recente do app. */
export interface ReleaseInfo {
  version: string;
  name: string;
  publishedAt: string;
  /** Texto puro da release; nunca é interpretado como HTML ou Markdown. */
  notes: string;
  htmlUrl: string;
  zipUrl: string;
  zipSize: number | null;
}

interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  published_at: string;
  body: string | null;
  html_url: string;
  assets: GitHubAsset[];
}

/** Rota do servidor do site que devolve a release (ver src/server.ts). */
export const RELEASE_ENDPOINT = '/api/site/release';

export const RELEASE_CACHE_MS = 10 * 60 * 1000;
const LATEST_RELEASE_API = `https://api.github.com/repos/${RUNTIME_REPO}/releases/latest`;

export function toReleaseInfo(release: GitHubRelease): ReleaseInfo | null {
  const zip = release.assets.find((asset) => asset.name === 'macItRun.zip');
  if (!zip) return null;
  return {
    version: release.tag_name.replace(/^v/, ''),
    name: release.name ?? release.tag_name,
    publishedAt: release.published_at,
    notes: release.body?.trim() ?? '',
    htmlUrl: release.html_url,
    zipUrl: zip.browser_download_url,
    zipSize: zip.size,
  };
}

let cache: { at: number; value: Promise<ReleaseInfo | null> } | null = null;

/**
 * Busca a release mais recente no GitHub, guardando a resposta por 10 minutos no
 * processo (só roda no servidor). Um token opcional evita o limite de 60 pedidos/hora.
 */
export function fetchLatestRelease(token?: string, now = Date.now()): Promise<ReleaseInfo | null> {
  if (cache && now - cache.at < RELEASE_CACHE_MS) return cache.value;
  const value = fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'macItRun-web',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(5000),
  })
    .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
    .then((release: GitHubRelease) => toReleaseInfo(release))
    .catch(() => {
      // Falhou: não guarda o erro, tenta de novo no próximo pedido.
      cache = null;
      return null;
    });
  cache = { at: now, value };
  return value;
}
