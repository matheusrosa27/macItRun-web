import { HTML_LANG, LANGS } from './i18n/langs';

/** Páginas fixas que vão para o sitemap (caminho depois do idioma). */
export const SITEMAP_PAGES = ['', 'download', 'community', 'forum', 'privacy', 'terms', 'licenses'];

/** Áreas fora dos buscadores (conta, moderação, publicar, nova senha). */
export const ROBOTS_DISALLOW = ['account', 'admin', 'community/publish', 'forum/new', 'reset-password'];

export interface SitemapProfile {
  id: string;
  slug: string;
  updatedAt: string;
}

/** Um tópico do fórum no sitemap (a data é a da última resposta). */
export interface SitemapTopic {
  id: string;
  slug: string;
  activityAt: string;
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * sitemap.xml com cada página nos três idiomas, ligadas entre si (hreflang), mais a página de
 * cada perfil de configuração publicado e de cada tópico visível do fórum.
 */
export function buildSitemap(siteUrl: string, profiles: SitemapProfile[], topics: SitemapTopic[] = []): string {
  const entries: { path: string; lastmod?: string }[] = [
    ...SITEMAP_PAGES.map((path) => ({ path })),
    ...profiles.map((p) => ({ path: `community/${p.id}/${p.slug}`, lastmod: p.updatedAt.slice(0, 10) })),
    ...topics.map((t) => ({ path: `forum/${t.id}/${t.slug}`, lastmod: t.activityAt.slice(0, 10) })),
  ];
  const url = (lang: string, path: string) => `${siteUrl}/${lang}${path ? `/${path}` : ''}`;
  const urls = entries.flatMap(({ path, lastmod }) =>
    LANGS.map((lang) => {
      const alternates = [
        ...LANGS.map(
          (other) =>
            `    <xhtml:link rel="alternate" hreflang="${HTML_LANG[other]}" href="${escape(url(other, path))}"/>`,
        ),
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${escape(url('pt', path))}"/>`,
      ];
      return [
        '  <url>',
        `    <loc>${escape(url(lang, path))}</loc>`,
        ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
        ...alternates,
        '  </url>',
      ].join('\n');
    }),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

export function buildRobots(siteUrl: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    ...LANGS.flatMap((lang) => ROBOTS_DISALLOW.map((path) => `Disallow: /${lang}/${path}`)),
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}
