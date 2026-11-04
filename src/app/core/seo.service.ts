import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { TranslocoService } from '@jsverse/transloco';
import { HTML_LANG, Lang, LANGS } from './i18n/langs';
import { LATEST_ZIP_URL, SITE_URL } from './site';

const OG_LOCALE: Record<Lang, string> = { pt: 'pt_BR', en: 'en_US', es: 'es_ES' };
const DEFAULT_IMAGE = `${SITE_URL}/img/logo-512.png`;
const JSON_LD_ID = 'seo-json-ld';

/** Título, descrição, Open Graph e links de idioma de cada página. */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly document = inject(DOCUMENT);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly transloco = inject(TranslocoService);

  /**
   * @param page chave em `seo.<page>` nos arquivos de tradução
   * @param lang idioma da URL atual
   * @param path caminho depois do idioma, sem barra inicial ("download", "" para a Home)
   * @param noindex tira a página dos buscadores (conta, nova senha)
   */
  update(page: string, lang: Lang, path: string, noindex = false): void {
    const t = (key: string) => this.transloco.translate(key, {}, lang);
    const siteName = t('app.name');
    const pageTitle = t(`seo.${page}.title`);
    const title = page === 'home' ? pageTitle : `${pageTitle} · ${siteName}`;
    const description = t(`seo.${page}.description`);
    const url = this.url(lang, path);

    this.document.documentElement.lang = HTML_LANG[lang];
    this.title.setTitle(title);
    this.setName('description', description);
    this.setProperty('og:type', 'website');
    this.setProperty('og:site_name', siteName);
    this.setProperty('og:title', title);
    this.setProperty('og:description', description);
    this.setProperty('og:url', url);
    this.setImage(DEFAULT_IMAGE, 512, 512);
    this.setProperty('og:locale', OG_LOCALE[lang]);
    this.setName('robots', noindex ? 'noindex' : 'index, follow');
    // Dados estruturados: o app na Home; nas outras, cada página põe os seus (ou nenhum).
    this.setJsonLd(page === 'home' ? this.appJsonLd(lang, description) : null);

    this.setLink('canonical', url);
    for (const other of LANGS) this.setLink('alternate', this.url(other, path), HTML_LANG[other]);
    this.setLink('alternate', this.url('pt', path), 'x-default');
  }

  /** Título e descrição vindos da própria página (ex.: o nome do jogo de um perfil). */
  setPageText(pageTitle: string, description: string): void {
    const title = `${pageTitle} · ${this.transloco.translate('app.name')}`;
    this.title.setTitle(title);
    this.setName('description', description);
    this.setProperty('og:title', title);
    this.setProperty('og:description', description);
  }

  /**
   * Imagem de compartilhamento. Quadrada (o logo) vira cartão pequeno; larga (a do perfil,
   * 1200×630), cartão grande.
   */
  setImage(url: string, width: number, height: number): void {
    this.setProperty('og:image', url);
    this.setProperty('og:image:width', String(width));
    this.setProperty('og:image:height', String(height));
    this.setName('twitter:card', width > height ? 'summary_large_image' : 'summary');
  }

  /**
   * Dados estruturados (schema.org) da página, num <script type="application/ld+json">.
   * `null` tira o que havia.
   */
  setJsonLd(data: object | null): void {
    let script = this.document.getElementById(JSON_LD_ID);
    if (!data) {
      script?.remove();
      return;
    }
    if (!script) {
      script = this.document.createElement('script');
      script.id = JSON_LD_ID;
      script.setAttribute('type', 'application/ld+json');
      this.document.head.appendChild(script);
    }
    // "<" escapado para nenhum texto de usuário fechar o <script>.
    script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  }

  /** Migalhas (Início › … › página atual) para o Google mostrar no resultado. */
  breadcrumbs(lang: Lang, items: { name: string; path?: string }[]): object {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        ...(item.path !== undefined ? { item: this.url(lang, item.path) } : {}),
      })),
    };
  }

  private appJsonLd(lang: Lang, description: string): object {
    return {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: this.transloco.translate('app.name', {}, lang),
      description,
      url: this.url(lang, ''),
      image: DEFAULT_IMAGE,
      downloadUrl: LATEST_ZIP_URL,
      applicationCategory: 'GameApplication',
      operatingSystem: 'macOS 26 (Apple silicon)',
      inLanguage: HTML_LANG[lang],
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    };
  }

  /** Tira a página dos buscadores (ex.: perfil que não existe mais). */
  setNoindex(): void {
    this.setName('robots', 'noindex');
  }

  private url(lang: Lang, path: string): string {
    return `${SITE_URL}/${lang}${path ? `/${path}` : ''}`;
  }

  private setName(name: string, content: string): void {
    this.meta.updateTag({ name, content });
  }

  private setProperty(property: string, content: string): void {
    this.meta.updateTag({ property, content }, `property="${property}"`);
  }

  private setLink(rel: string, href: string, hreflang?: string): void {
    const selector = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]`;
    let link = this.document.head.querySelector<HTMLLinkElement>(selector);
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', rel);
      if (hreflang) link.setAttribute('hreflang', hreflang);
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', href);
  }
}
