import { isValidUsername, suggestUsername } from './username';

describe('username', () => {
  it('aceita minúsculas, números, - e _, de 3 a 20 caracteres', () => {
    for (const name of ['ana', 'ana_mac', 'mac-it-2', '9lives', 'a'.repeat(20), ' Ana ']) {
      expect(isValidUsername(name)).withContext(name).toBeTrue();
    }
  });

  it('recusa curto, longo, símbolos, começo com - ou _ e nomes reservados', () => {
    for (const name of ['ab', 'a'.repeat(21), 'com espaço', 'ana!', '-ana', '_ana', 'josé', 'admin', 'macitrun']) {
      expect(isValidUsername(name)).withContext(name).toBeFalse();
    }
  });

  it('sugere um nome válido a partir do GitHub ou do e-mail', () => {
    expect(suggestUsername('Octo.Cat')).toBe('octo-cat');
    expect(suggestUsername('João.Silva')).toBe('joao-silva');
    expect(suggestUsername('__x__long_name_with_more_than_twenty')).toBe('x__long_name_with_mo');
    expect(suggestUsername('ab')).toBe('');
    expect(suggestUsername('admin')).toBe('');
    expect(suggestUsername(undefined)).toBe('');
  });
});
