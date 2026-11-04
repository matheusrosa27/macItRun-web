// Função da Vercel que gera a imagem de compartilhamento (Open Graph, 1200×630) de cada perfil
// de configuração, com o nome do jogo. vercel.json leva /og/profile/<id>?lang=pt para cá.
// Os textos vêm dos arquivos de tradução; o perfil, da API pública.
import { ImageResponse } from '@vercel/og';
import en from '../src/i18n/en.json' with { type: 'json' };
import es from '../src/i18n/es.json' with { type: 'json' };
import pt from '../src/i18n/pt.json' with { type: 'json' };

const TRANSLATIONS = { pt, en, es };
const ID = /^[a-z0-9-]{1,32}$/;

/** Nó do satori sem JSX: { type, props: { style, children } }. */
const h = (type, style, ...children) => ({ type, props: { style, children: children.flat() } });

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host ?? 'localhost'}`);
  const id = url.searchParams.get('id') ?? '';
  const lang = TRANSLATIONS[url.searchParams.get('lang')] ? url.searchParams.get('lang') : 'pt';
  const t = TRANSLATIONS[lang];

  const profile = ID.test(id) ? await fetchProfile(id) : null;
  if (!profile) {
    res.status(404).setHeader('Cache-Control', 'public, max-age=60').end();
    return;
  }

  const p = profile.profile;
  const details = [
    p.graphics && t.community.graphics[p.graphics],
    p.windowsVersion && t.community.windows[p.windowsVersion],
  ].filter(Boolean);
  const author = profile.community.author?.username;

  const image = new ImageResponse(
    h(
      'div',
      {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        color: '#f8fafc',
        background: 'linear-gradient(135deg, #0b1220 0%, #172554 60%, #1d4ed8 100%)',
      },
      h(
        'div',
        { display: 'flex', alignItems: 'center', gap: '20px', fontSize: '40px' },
        { type: 'img', props: { src: `${url.origin}/img/logo-192.png`, width: 72, height: 72, style: { borderRadius: '16px' } } },
        h('span', {}, t.app.name),
      ),
      h(
        'div',
        { display: 'flex', flexDirection: 'column', gap: '18px' },
        h('span', { fontSize: '34px', color: '#93c5fd' }, t.seo.communityProfile.title),
        h(
          'span',
          { fontSize: p.name.length > 40 ? '64px' : '88px', lineHeight: 1.05, letterSpacing: '-1px' },
          p.name,
        ),
      ),
      h(
        'div',
        { display: 'flex', justifyContent: 'space-between', fontSize: '32px', color: '#cbd5e1' },
        h('span', {}, details.join('  ·  ')),
        h('span', {}, author ? `@${author}` : ''),
      ),
    ),
    { width: 1200, height: 630 },
  );

  res.status(200);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
  res.end(Buffer.from(await image.arrayBuffer()));
}

async function fetchProfile(id) {
  const raw = process.env.SUPABASE_URL;
  if (!raw) return null;
  try {
    const response = await fetch(`${new URL(raw).origin}/functions/v1/api/v1/profiles/${id}`);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
