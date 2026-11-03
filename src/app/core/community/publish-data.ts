/**
 * O botão Publicar do app abre /community/publish#data=<arquivo .macitrun-profile em base64url>.
 * O fragmento (#) não vai para o servidor nem para os logs.
 */
export const PENDING_PROFILE_KEY = 'macitrun.pendingProfile';

/** O texto do arquivo, ou null se `data` não é base64url de um UTF-8 válido. */
export function decodeProfileData(data: string): string | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(data) || data.length > 32_768) return null;
  try {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** O inverso (o que o app faz), para testes e para gerar links. */
export function encodeProfileData(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
