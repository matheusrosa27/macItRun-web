# macItRun-web

Website for macItRun: product page, downloads and (in later phases) the community of setup profiles for Windows apps and games.
Angular 20 with SSR, PrimeNG 20 (Aura theme), Tailwind CSS 4 and Transloco (pt, en, es), hosted on Vercel.

## Development

Requires Node 22 (`nvm use`).

```bash
npm ci
```

```bash
npm start
```

Opens at http://localhost:4200 (with SSR). To try the production build:

```bash
npm run build && PORT=4000 npm run serve:ssr
```

Checks (the same ones CI runs):

```bash
npm run lint && npm run test:ci && npm run build
```

## Structure

```
src/app/core/        languages, SEO, theme, GitHub release, URLs (site.ts)
src/app/layout/      header, footer, language and theme switchers
src/app/pages/       home, download, legal (privacy, terms, licenses), not-found
src/i18n/            translations pt.json, en.json, es.json (same keys, tested)
src/server.ts        Express server: SSR + GET /api/site/release
api/ssr.mjs          Vercel function that calls the Angular server
vercel.json          static files from the CDN, everything else through the function; security headers
```

## Routes and rendering

Every page lives under a language prefix: `/pt`, `/en`, `/es`. Without one (`/`, `/download`), the
server redirects based on `Accept-Language` (Portuguese as the fallback).

| Route | Rendering |
| --- | --- |
| `/:lang`, `/:lang/privacy`, `/:lang/terms`, `/:lang/licenses` | prerendered at build time |
| `/:lang/download` | SSR, cached for 10 min on the CDN (current release version) |
| `/:lang/**` | SSR, 404 |

The release comes from `matheusrosa27/macItRun-runtime` through the GitHub API, cached in the process
for 10 minutes. The optional `GITHUB_TOKEN` variable (read-only access to public repositories) avoids
the limit of 60 requests per hour.

## Deploy

Vercel deploys on every push. Project settings: Framework "Other", default commands
(`vercel.json` defines everything). Environment variables: `GITHUB_TOKEN` (optional).
