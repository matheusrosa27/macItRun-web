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
npm run lint && npm run test:ci && npm run typecheck:node && npm run test:node && npm run build
```

`test:node` runs, with `node:test`:

- the profile format tests (`packages/profile-schema`): every case in `cases.json` through both the
  Zod schema and the JSON Schema, which must agree;
- the database tests: the SQL migrations in an in-memory Postgres (PGlite) with a stub of Supabase's
  `auth` schema, checking the RLS rules, search, counters and account functions;
- the `/api/v1` tests: the real handler on top of that database, with the seeded profile.

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
src/app/core/community/  community API client and types
src/app/pages/       home, download, community (list, profile), auth (signup, login, reset-password),
                     account, legal, not-found
src/app/shared/      Turnstile captcha
src/i18n/            translations pt.json, en.json, es.json (same keys, tested)
src/server.ts        Express server: SSR + GET /api/site/release
api/ssr.mjs          Vercel function that calls the Angular server
api/og.mjs           Vercel function that draws the share image of a setup profile
vercel.json          static files from the CDN, everything else through the function; security headers
supabase/migrations/ SQL migrations (tables, RLS, functions)
supabase/seed.sql    example profile (Dark Souls III), the same as the example file
supabase/functions/  public API /api/v1 (Supabase Edge Function, Deno)
supabase/tests/      database tests (node:test + PGlite)
packages/profile-schema/
                     .macitrun-profile format v1: profile.schema.json (source of the rules, copied
                     to the Mac app), Zod schema, shared test cases and an example file
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
| `/:lang/community`, `/:lang/community/:id/:slug` | SSR, cached for 1 min on the CDN; likes and comments of the signed-in user happen in the browser |
| `/:lang/account` | browser only (needs the session) |
| `/:lang/community/publish` | browser only (reads the profile from `#data=` or a file) |
| `/:lang/admin` | browser only, admins (moderation) |
| `/:lang/**` | SSR, 404 |
| `/api/v1/**` | proxied to the Supabase Edge Function `api` (see below) |
| `/sitemap.xml`, `/robots.txt` | from the Express server; sitemap has every page in 3 languages plus each published setup profile, cached 1 h |
| `/og/profile/:id?lang=` | 1200×630 share image with the game name (`api/og.mjs`, `@vercel/og`), cached 1 day |

The release comes from `matheusrosa27/macItRun-runtime` through the GitHub API, cached in the process
for 10 minutes. The optional `GITHUB_TOKEN` variable (read-only access to public repositories) avoids
the limit of 60 requests per hour.

## Deploy

Vercel deploys on every push. Project settings: Framework "Other", default commands
(`vercel.json` defines everything). Environment variables:

| Variable | Value |
| --- | --- |
| `SITE_URL` | optional, the public address (default `https://mac-it-run.vercel.app`); used in canonical links, sitemap and share images |
| `NG_ALLOWED_HOSTS` | optional, extra host names the SSR server accepts (comma-separated), e.g. the custom domain |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | publishable (anon) key, never the secret / service_role key |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key |
| `GITHUB_TOKEN` | optional, read-only; avoids GitHub's 60 requests/hour limit |

## Public API (`/api/v1`)

The Mac app depends on this contract (it only reads); the site uses it too.

| Request | Response |
| --- | --- |
| `GET /api/v1/profiles?q=&graphics=&sort=likes\|recent\|downloads&page=` | `{ items, page, pageSize, total }`, 20 per page, cached 60 s |
| `GET /api/v1/profiles/{id}` | the `.macitrun-profile` file plus `community` (id, slug, author, notes, likes, comments, downloads, dates) |
| `GET /api/v1/profiles/{id}/download` | the `.macitrun-profile` file as an attachment; counts one download |
| `GET /api/v1/profiles/{id}/comments?page=` | visible comments, `{ items, page, pageSize, total }` |
| `POST` / `DELETE /api/v1/profiles/{id}/like` | like / unlike (login): `{ liked, likes }`; liking twice counts once |
| `POST /api/v1/profiles/{id}/comments` | comment (login), body `{ "body": "..." }`: the new comment (201) |
| `GET /api/v1/profile-filters` | values for the community filters: `{ macs }` |
| `POST /api/v1/profiles` | publish (login), body `{ "file": <.macitrun-profile text or object>, "notes": "..." }`: `{ id, slug }` (201) |
| `POST /api/v1/reports` | report (login), body `{ "targetType": "profile"\|"comment", "targetId", "reason", "detail" }` |

The list also takes `windowsVersion=` and `mac=` (the community page's filters). Login is
`Authorization: Bearer <Supabase access token>`; writes run as that user through database
functions that validate everything again (signed in, username and terms set, not banned,
profile published, plain-text comment of 1 to 2,000 characters).

Errors: `{ "error": "not_found" }` (404), `{ "error": "invalid_parameter", "parameter": "sort" }`
(400), `{ "error": "invalid_profile", "issues": [{ "path", "code" }] }` (400), `comment_invalid` /
`text_invalid` / `invalid_json` (400), `not_authenticated` (401), `account_incomplete` /
`user_banned` / `own_content` (403), `too_large` (413), `daily_limit` / `rate_limited` (429),
`method_not_allowed` (405), `internal_error` (500).

Limits: 10 profiles, 60 comments and 20 reports per person per day (in the database); 30 writes
per minute per IP in the API (the database only sees a hash of the IP, kept for a day). Three
reports from different people hide a profile or comment until an admin reviews it. The API validates every profile with
the shared schema before serving it.

It runs as the Supabase Edge Function `api` (`supabase/functions/api`). `vercel.json` proxies
`/api/v1/*` to it, so it lives on the site's domain. Reads use the publishable key (RLS applies);
the secret key, which Supabase injects into the function, only counts downloads.

Deploy (after changing `supabase/functions` or `packages/profile-schema`):

```bash
npx supabase login
```

```bash
npx supabase functions deploy api --project-ref fcrrcxelhbdiihxxggur --no-verify-jwt --use-api
```

## Custom domain

1. Vercel → Settings → Domains: add the domain (e.g. `macitrun.app` and `www.macitrun.app`) and
   follow the DNS instructions; HTTPS is automatic. Make it the primary domain so
   `mac-it-run.vercel.app` redirects to it.
2. Vercel → Environment Variables: `SITE_URL=https://<domain>` and `NG_ALLOWED_HOSTS=<domain>,www.<domain>`,
   then redeploy (`SITE_URL` is read at build time).
3. `vercel.json`: change the project ref in the `/api/v1` rewrite only if the Supabase project changes.
4. Supabase → Authentication → URL Configuration: Site URL `https://<domain>` and add
   `https://<domain>/**` to the redirect URLs.
5. Cloudflare Turnstile: add the domain to the widget's hostnames.
6. Google Cloud (OAuth consent screen): add the domain to the authorized domains and set the home,
   privacy and terms links; GitHub OAuth app: update the homepage URL.
7. The Mac app: point its site constant to the new address (it calls `/api/v1` there).

## Publishing from the app

The app's Publish button opens `/<lang>/community/publish#data=<.macitrun-profile file in
base64url>`. The fragment never reaches the server. To try it without the app:

```bash
echo "https://mac-it-run.vercel.app/pt/community/publish#data=$(base64 < packages/profile-schema/examples/dark-souls-3.macitrun-profile | tr '+/' '-_' | tr -d '=\n')"
```

## Moderation

Admins see `/<lang>/admin` (a link appears in My account): open reports (hide or keep), hidden
items (restore) and ban/unban the author. To make someone an admin, in the SQL Editor:

```sql
update public.users_public set role = 'admin' where username = '<username>';
```

## Supabase setup

1. Run the files in `supabase/migrations/` in order in the SQL Editor (or `npx supabase db push`),
   then `supabase/seed.sql` for the example profile.
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
