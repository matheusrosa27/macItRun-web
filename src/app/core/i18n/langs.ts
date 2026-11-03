export const LANGS = ['pt', 'en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

/** Português é a reserva quando o navegador não pede nenhum dos três. */
export const DEFAULT_LANG: Lang = 'pt';

/** Valor do atributo lang do <html> e do hreflang. */
export const HTML_LANG: Record<Lang, string> = { pt: 'pt-BR', en: 'en', es: 'es' };

/** Rótulo de cada idioma no seletor, sempre no próprio idioma. */
export const LANG_LABEL: Record<Lang, string> = { pt: 'Português', en: 'English', es: 'Español' };

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/**
 * Escolhe o idioma pela preferência do navegador: a lista de `navigator.languages`
 * ou o cabeçalho Accept-Language ("pt-BR,pt;q=0.9,en;q=0.8").
 */
export function pickLang(preferred: string | readonly string[] | null | undefined): Lang {
  if (!preferred) return DEFAULT_LANG;
  const tags =
    typeof preferred === 'string'
      ? preferred
          .split(',')
          .map((part) => {
            const [tag, ...params] = part.trim().split(';');
            const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
            return { tag, q: q ? Number(q.slice(2)) : 1 };
          })
          .filter((t) => t.tag && t.q > 0)
          .sort((a, b) => b.q - a.q)
          .map((t) => t.tag)
      : preferred;
  for (const tag of tags) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}
