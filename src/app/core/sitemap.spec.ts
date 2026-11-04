import { buildRobots, buildSitemap, SITEMAP_PAGES } from './sitemap';

describe('sitemap', () => {
  const xml = buildSitemap('https://example.com', [
    { id: 'abc', slug: 'dark-souls-iii', updatedAt: '2026-11-03T18:57:59.821Z' },
  ]);

  it('tem cada página nos três idiomas, mais os perfis', () => {
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBe((SITEMAP_PAGES.length + 1) * 3);
    expect(locs).toContain('https://example.com/pt');
    expect(locs).toContain('https://example.com/en/community');
    expect(locs).toContain('https://example.com/es/community/abc/dark-souls-iii');
  });

  it('liga os idiomas e marca a data do perfil', () => {
    expect(xml).toContain('hreflang="pt-BR" href="https://example.com/pt/download"');
    expect(xml).toContain('hreflang="x-default" href="https://example.com/pt/download"');
    expect(xml).toContain('<lastmod>2026-11-03</lastmod>');
  });

  it('escapa o que vier do banco', () => {
    expect(buildSitemap('https://e.com', [{ id: 'a', slug: 'x&y', updatedAt: '2026-01-01' }])).toContain('x&amp;y');
  });

  it('robots tira as áreas privadas e aponta o sitemap', () => {
    const robots = buildRobots('https://example.com');
    expect(robots).toContain('Disallow: /pt/account');
    expect(robots).toContain('Disallow: /es/community/publish');
    expect(robots).toContain('Sitemap: https://example.com/sitemap.xml');
  });
});
