/** Endereços e dados fixos do projeto, num só lugar. */

/** Endereço público do site (sem barra no fim). Troca quando houver domínio próprio. */
export const SITE_URL = 'https://mac-it-run.vercel.app';

export const RUNTIME_REPO = 'matheusrosa27/macItRun-runtime';
export const RUNTIME_REPO_URL = `https://github.com/${RUNTIME_REPO}`;
export const RELEASES_URL = `${RUNTIME_REPO_URL}/releases`;

/** Sempre aponta para o .zip da release mais recente, mesmo se a API do GitHub falhar. */
export const LATEST_ZIP_URL = `${RELEASES_URL}/latest/download/macItRun.zip`;

export const INSTALL_COMMAND = `curl -fsSL https://raw.githubusercontent.com/${RUNTIME_REPO}/main/install.sh | sh`;

export const KOFI_URL = 'https://ko-fi.com/matheusrosa27';

/** Fontes do runtime Wine distribuído pelo app (LGPL). */
export const WINE_SOURCES_URL = `${RELEASES_URL}/download/runtime-26.3.0-r5/macitrun-wine-26.3.0-r5-sources.tar`;
