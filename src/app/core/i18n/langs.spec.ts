import { pickLang } from './langs';

describe('pickLang', () => {
  it('follows the Accept-Language order and weights', () => {
    expect(pickLang('en-US,en;q=0.9,pt;q=0.8')).toBe('en');
    expect(pickLang('fr-FR,es;q=0.5,en;q=0.7')).toBe('en');
    expect(pickLang('es-AR')).toBe('es');
  });

  it('accepts the navigator.languages list', () => {
    expect(pickLang(['de-DE', 'pt-BR'])).toBe('pt');
  });

  it('falls back to Portuguese', () => {
    expect(pickLang('fr,de')).toBe('pt');
    expect(pickLang(undefined)).toBe('pt');
    expect(pickLang('en;q=0')).toBe('pt');
  });
});
