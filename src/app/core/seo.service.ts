import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { TranslocoService } from '@jsverse/transloco';
import { HTML_LANG, Lang, LANGS } from './i18n/langs';
import { SITE_URL } from './site';

const OG_LOCALE: Record<Lang, string> = { pt: 'pt_BR', en: 'en_US', es: 'es_ES' };
const DEFAULT_IMAGE = `${SITE_URL}/img/logo-512.png`;

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
    this.setProperty('og:image', DEFAULT_IMAGE);
    this.setProperty('og:locale', OG_LOCALE[lang]);
    this.setName('twitter:card', 'summary');
    this.setName('robots', noindex ? 'noindex' : 'index, follow');

    this.setLink('canonical', url);
    for (const other of LANGS) this.setLink('alternate', this.url(other, path), HTML_LANG[other]);
    this.setLink('alternate', this.url('pt', path), 'x-default');
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
