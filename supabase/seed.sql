-- Perfil de exemplo (aceite da Fase 3: a API devolve este perfil igual ao arquivo
-- packages/profile-schema/examples/dark-souls-3.macitrun-profile). Sem autor: aparece como
-- "autor removido" até existir o selo de perfil oficial. Rode depois das migrações.
insert into public.profiles (id, payload, tested_on, notes)
values (
  'darksouls3',
  '{"id": "dark-souls-3", "name": "Dark Souls III", "executables": ["DarkSoulsIII.exe"], "graphics": "dxvk", "windowsVersion": "win10", "dllOverrides": {}, "environment": {}, "arguments": [], "notes": "Com DXMT a GPU falha no efeito de morte dos inimigos."}',
  '{"mac": "Mac17,1", "macOS": "26.1", "runtime": "macitrun-wine-26.3.0", "app": "0.5.2"}',
  'Perfil de exemplo, igual ao que vem no app.'
)
on conflict (id) do nothing;
