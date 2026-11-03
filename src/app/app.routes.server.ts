import { RenderMode, ServerRoute } from '@angular/ssr';
import { LANGS } from './core/i18n/langs';
import { RELEASE_CACHE_MS } from './core/release/release';

const eachLang = async () => LANGS.map((lang) => ({ lang }));
const COMMUNITY_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=60';

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
  // Comunidade: renderiza no servidor (busca e perfis entram no HTML) e a CDN guarda por 1 minuto.
  // Curtidas e comentários de quem está conectado acontecem no navegador.
  { path: ':lang/community', renderMode: RenderMode.Server, headers: { 'Cache-Control': COMMUNITY_CACHE } },
  { path: ':lang/community/:id', renderMode: RenderMode.Server, headers: { 'Cache-Control': COMMUNITY_CACHE } },
  {
    path: ':lang/community/:id/:slug',
    renderMode: RenderMode.Server,
    headers: { 'Cache-Control': COMMUNITY_CACHE },
  },
  { path: ':lang/**', renderMode: RenderMode.Server, status: 404 },
  { path: '**', renderMode: RenderMode.Server },
];
