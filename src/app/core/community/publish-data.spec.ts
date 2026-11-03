import { decodeProfileData, encodeProfileData } from './publish-data';

describe('publish data (#data=)', () => {
  it('volta o mesmo texto, com acentos e símbolos', () => {
    const text = '{"profile":{"name":"Pokémon™ Ação","notes":"a+b/c?"}}';
    const data = encodeProfileData(text);
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeProfileData(data)).toBe(text);
  });

  it('aceita com ou sem o = do fim', () => {
    expect(decodeProfileData('eyJhIjoxfQ')).toBe('{"a":1}');
    expect(decodeProfileData('eyJhIjoxfQ==')).toBe('{"a":1}');
  });

  it('recusa o que não é base64url nem UTF-8', () => {
    expect(decodeProfileData('não é base64')).toBeNull();
    expect(decodeProfileData('eyJh+/')).toBeNull();
    expect(decodeProfileData('_w')).toBeNull();
  });
});
