import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { API_BASE } from './app/core/community/community';
import { fetchLatestRelease, RELEASE_CACHE_MS, RELEASE_ENDPOINT } from './app/core/release/release';
import { SITE_URL } from './app/core/site';
import { buildRobots, buildSitemap, SitemapProfile } from './app/core/sitemap';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
/**
 * A Vercel sempre envia X-Forwarded-For/Host/Proto/Port e sobrescreve os que vêm do
 * cliente. Sem confiar neles, o Angular desiste do SSR e entrega só a casca (CSR).
 * X-Forwarded-Prefix fica de fora: ele muda o caminho dos redirecionamentos.
 */
const angularApp = new AngularNodeAppEngine({
  trustProxyHeaders: ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port'],
});

/**
 * Release mais recente do app (versão, notas e .zip), com cache de 10 minutos no
 * processo e na CDN. O navegador usa ao chegar na página Download por navegação interna.
 */
app.get(RELEASE_ENDPOINT, async (_req, res) => {
  const release = await fetchLatestRelease(process.env['GITHUB_TOKEN']);
  const maxAge = release ? RELEASE_CACHE_MS / 1000 : 60;
  res.set('Cache-Control', `public, max-age=60, s-maxage=${maxAge}, stale-while-revalidate=60`);
  res.json(release);
});

/** robots.txt: tudo liberado, menos conta, moderação, publicar e nova senha. */
app.get('/robots.txt', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.type('text/plain').send(buildRobots(SITE_URL));
});

/**
 * sitemap.xml com as páginas fixas e os perfis de configuração publicados (lidos da API,
 * até 2.000), com cache de 1 hora na CDN.
 */
app.get('/sitemap.xml', async (_req, res) => {
  const profiles: SitemapProfile[] = [];
  if (API_BASE) {
    try {
      for (let page = 1; page <= 40; page++) {
        const response = await fetch(`${API_BASE}/profiles?sort=recent&page=${page}`);
        if (!response.ok) break;
        const list = (await response.json()) as { items: SitemapProfile[]; total: number; pageSize: number };
        profiles.push(...list.items.map(({ id, slug, updatedAt }) => ({ id, slug, updatedAt })));
        if (page * list.pageSize >= list.total) break;
      }
    } catch (error) {
      console.error('sitemap', error);
    }
  }
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=3600');
  res.type('application/xml').send(buildSitemap(SITE_URL, profiles));
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
