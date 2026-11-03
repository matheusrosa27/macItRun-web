import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID, REQUEST } from '@angular/core';
import { CanMatchFn, RedirectFunction, ResolveFn } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { map } from 'rxjs';
import { isLang, Lang, pickLang } from './langs';

/** Só casa a rota de idioma quando o primeiro trecho da URL é pt, en ou es. */
export const langMatch: CanMatchFn = (_route, segments) => isLang(segments[0]?.path);

/** Carrega as traduções antes de mostrar a página (no servidor e no navegador). */
export const langResolver: ResolveFn<Lang> = (route) => {
  const lang = route.paramMap.get('lang') as Lang;
  const transloco = inject(TranslocoService);
  return transloco.load(lang).pipe(
    map(() => {
      transloco.setActiveLang(lang);
      return lang;
    }),
  );
};

/** Idioma preferido de quem visita: navegador no cliente, Accept-Language no servidor. */
export function preferredLang(): Lang {
  if (isPlatformBrowser(inject(PLATFORM_ID))) return pickLang(navigator.languages);
  return pickLang(inject(REQUEST, { optional: true })?.headers.get('accept-language'));
}

/** URL sem idioma (/, /download) vai para a mesma página no idioma preferido. */
export const redirectToLang: RedirectFunction = ({ url }) => {
  const rest = url.map((segment) => segment.path).join('/');
  return `/${preferredLang()}${rest ? `/${rest}` : ''}`;
};
