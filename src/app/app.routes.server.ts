import { RenderMode, ServerRoute } from '@angular/ssr';
import { LANGS } from './core/i18n/langs';
import { RELEASE_CACHE_MS } from './core/release/release';

const eachLang = async () => LANGS.map((lang) => ({ lang }));

export const serverRoutes: ServerRoute[] = [
  // Páginas fixas: geradas no build, uma por idioma.
  { path: ':lang', renderMode: RenderMode.Prerender, getPrerenderParams: eachLang },
  { path: ':lang/privacy', renderMode: RenderMode.Prerender, getPrerenderParams: eachLang },
  { path: ':lang/terms', renderMode: RenderMode.Prerender, getPrerenderParams: eachLang },
  { path: ':lang/licenses', renderMode: RenderMode.Prerender, getPrerenderParams: eachLang },
  // Download mostra a versão atual: renderiza no servidor e a CDN guarda por 10 minutos.
  {
    path: ':lang/download',
    renderMode: RenderMode.Server,
    headers: {
      'Cache-Control': `public, max-age=0, s-maxage=${RELEASE_CACHE_MS / 1000}, stale-while-revalidate=60`,
    },
  },
  { path: ':lang/**', renderMode: RenderMode.Server, status: 404 },
  { path: '**', renderMode: RenderMode.Server },
];
