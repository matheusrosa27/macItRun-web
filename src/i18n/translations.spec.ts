import en from './en.json';
import es from './es.json';
import pt from './pt.json';

/** Todas as chaves de um objeto de traduções, achatadas ("home.hero.title"). */
function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

describe('translations', () => {
  const reference = keys(pt).sort();

  for (const [lang, translation] of Object.entries({ en, es })) {
    it(`${lang} has exactly the same keys as pt`, () => {
      expect(keys(translation).sort()).toEqual(reference);
    });
  }

  it('has no empty text', () => {
    for (const translation of [pt, en, es]) {
      const flat = JSON.stringify(translation);
      expect(flat).not.toContain('""');
    }
  });
});
