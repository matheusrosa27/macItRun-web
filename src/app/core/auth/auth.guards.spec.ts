import { safeNext } from './auth.guards';

describe('safeNext', () => {
  it('aceita caminhos do site no mesmo idioma', () => {
    expect(safeNext('/pt/community/publish', 'pt')).toBe('/pt/community/publish');
    expect(safeNext('/en/account?tab=1', 'en')).toBe('/en/account?tab=1');
  });

  it('recusa outros sites, outro idioma ou nada, e volta para a conta', () => {
    for (const next of [undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/en/account', 'pt/x']) {
      expect(safeNext(next, 'pt')).withContext(String(next)).toBe('/pt/account');
    }
  });
});
