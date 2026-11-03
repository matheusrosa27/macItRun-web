import { Injectable } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { from, map, Observable } from 'rxjs';
import { Lang } from './langs';

/**
 * As traduções entram no próprio bundle (um pedaço por idioma), assim o servidor
 * renderiza com o texto certo sem fazer requisição HTTP para si mesmo.
 */
const TRANSLATIONS: Record<Lang, () => Promise<{ default: Translation }>> = {
  pt: () => import('../../../i18n/pt.json'),
  en: () => import('../../../i18n/en.json'),
  es: () => import('../../../i18n/es.json'),
};

@Injectable({ providedIn: 'root' })
export class BundledTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    const load = TRANSLATIONS[lang as Lang] ?? TRANSLATIONS.pt;
    return from(load()).pipe(map((module) => module.default));
  }
}
