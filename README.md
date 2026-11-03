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
npm run lint && npm run test:ci && npm run test:db && npm run build
```

`test:db` runs the SQL migrations in an in-memory Postgres (PGlite) with a stub of Supabase's
`auth` schema, and checks the RLS rules and account functions.

Accounts need public keys at build time. Locally, put them in `.env.local` (git-ignored):

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
TURNSTILE_SITE_KEY=0x...
```

`scripts/public-env.mjs` writes them to `src/environments/public-env.ts` before every build, serve
and test, and refuses secret keys. Without them the site works, but accounts are turned off.

## Structure

```
src/app/core/        languages, SEO, theme, GitHub release, URLs (site.ts), auth (Supabase)
src/app/layout/      header, footer, language and theme switchers
src/app/pages/       home, download, auth (signup, login, reset-password), account, legal, not-found
src/app/shared/      Turnstile captcha
src/i18n/            translations pt.json, en.json, es.json (same keys, tested)
src/server.ts        Express server: SSR + GET /api/site/release
api/ssr.mjs          Vercel function that calls the Angular server
vercel.json          static files from the CDN, everything else through the function; security headers
supabase/migrations/ SQL migrations (tables, RLS, functions)
supabase/tests/      database tests (node:test + PGlite)
scripts/             build helpers
```

## Routes and rendering

Every page lives under a language prefix: `/pt`, `/en`, `/es`. Without one (`/`, `/download`), the
server redirects based on `Accept-Language` (Portuguese as the fallback).

| Route | Rendering |
| --- | --- |
| `/:lang`, `/:lang/privacy`, `/:lang/terms`, `/:lang/licenses` | prerendered at build time |
| `/:lang/signup`, `/:lang/login`, `/:lang/reset-password` | prerendered; sign-in happens in the browser |
| `/:lang/download` | SSR, cached for 10 min on the CDN (current release version) |
| `/:lang/account` | browser only (needs the session) |
| `/:lang/**` | SSR, 404 |

The release comes from `matheusrosa27/macItRun-runtime` through the GitHub API, cached in the process
for 10 minutes. The optional `GITHUB_TOKEN` variable (read-only access to public repositories) avoids
the limit of 60 requests per hour.

## Deploy

Vercel deploys on every push. Project settings: Framework "Other", default commands
(`vercel.json` defines everything). Environment variables:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | publishable (anon) key, never the secret / service_role key |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key |
| `GITHUB_TOKEN` | optional, read-only; avoids GitHub's 60 requests/hour limit |

## Supabase setup

1. Run the files in `supabase/migrations/` in order in the SQL Editor (or `npx supabase db push`).
2. Authentication → URL Configuration:
   - Site URL: `https://mac-it-run.vercel.app`
   - Redirect URLs: `https://mac-it-run.vercel.app/**`, `https://*-matheusmemphis-7207.vercel.app/**`
     (previews) and `http://localhost:4200/**`, `http://localhost:4000/**`
3. Authentication → Providers → Email: confirm email on, minimum password length 8.
4. Google and GitHub providers: create the OAuth app in each service with the callback
   `https://<project>.supabase.co/auth/v1/callback`, then paste the client ID and secret.
5. Authentication → Attack Protection: CAPTCHA with Turnstile, using the Turnstile secret key.
6. Emails: Supabase's built-in sender only delivers to the project's team members, with a low
   hourly limit. For real users, set a custom SMTP server (e.g. Resend) under Authentication → Emails.
