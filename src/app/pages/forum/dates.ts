import { HTML_LANG, Lang } from '../../core/i18n/langs';

/** Data curta ("4 de nov. de 2026") para listas e cabeçalhos do fórum. */
export function forumDate(lang: Lang, value: string): string {
  return new Intl.DateTimeFormat(HTML_LANG[lang], { dateStyle: 'medium' }).format(new Date(value));
}

/** Data com hora, para cada resposta. */
export function forumDateTime(lang: Lang, value: string): string {
  return new Intl.DateTimeFormat(HTML_LANG[lang], { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
