// Função da Vercel que renderiza as páginas que não são arquivos estáticos
// (Download, 404 e os redirecionamentos de idioma) com o servidor do Angular.
// As páginas pré-renderizadas e os assets saem direto da CDN (ver vercel.json).
export default async function handler(req, res) {
  const { reqHandler } = await import('../dist/macItRun-web/server/server.mjs');
  return reqHandler(req, res);
}
