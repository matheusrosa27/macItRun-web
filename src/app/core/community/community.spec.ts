import { GRAPHICS as SCHEMA_GRAPHICS, WINDOWS_VERSIONS as SCHEMA_WINDOWS } from '@macitrun/profile-schema';
import { GRAPHICS, WINDOWS_VERSIONS } from './community';

describe('community', () => {
  it('usa os mesmos valores do pacote do perfil', () => {
    expect([...GRAPHICS]).toEqual([...SCHEMA_GRAPHICS]);
    expect([...WINDOWS_VERSIONS]).toEqual([...SCHEMA_WINDOWS]);
  });
});
