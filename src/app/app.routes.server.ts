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
  // Formulários de conta: o HTML é fixo; o login acontece no navegador.
  { path: ':lang/signup', renderMode: RenderMode.Prerender, getPrerenderParams: eachLang },
  { path: ':lang/login', renderMode: RenderMode.Prerender, getPrerenderParams: eachLang },
  { path: ':lang/reset-password', renderMode: RenderMode.Prerender, getPrerenderParams: eachLang },
  // Só faz sentido com a sessão, que fica no navegador.
  { path: ':lang/account', renderMode: RenderMode.Client },
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
