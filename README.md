# Localy

Localy is a private, paid SaaS application for discovering local businesses that do not list a website, and for managing personalized outreach to offer them website development.

The workflow: pick an area on a map, search Google Maps through the official Places API, review businesses with transparent opportunity signals, save prospects, write personalized templates, send from your own Gmail or Outlook mailbox through a background queue with automatic follow-ups, and track replies, campaigns and results.

## Contents

- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Commands](#commands)
- [Configuration](#configuration)
- [Third-party setup](#third-party-setup)
- [Data retention and compliance](#data-retention-and-compliance)
- [Security](#security)
- [Testing](#testing)
- [Deployment](#deployment)

## Architecture

```
apps/
  web/        React 19 + TypeScript + Vite + Tailwind CSS 4 (SPA)
  api/        Fastify 5 REST API (auth, workspaces, discovery, prospects, campaigns, inbox, billing, admin)
  worker/     Background jobs (pg-boss on PostgreSQL): sending, follow-ups, reply sync, health checks, cleanup
packages/
  config/     Validated environment configuration (zod)
  shared/     Types, validation schemas, template rendering, website classification, signals (used by web and server)
  database/   Drizzle ORM schema, migrations, plans, development seed
  email/      Email provider abstraction: Gmail API, Microsoft Graph, development sandbox
  core/       Business logic services used by the API and the worker (route handlers stay thin)
tests/        Integration tests (real API + real PostgreSQL + local fakes of third-party APIs)
e2e/          Playwright end-to-end tests of critical user flows
```

Request flow for outreach:

```
Browser -> API (validate, authorize, enforce plan) -> campaign.tick job -> email.send jobs -> Gmail / Graph API -> result recorded
                                                   ^ dispatcher (every minute) promotes scheduled campaigns and recovers stranded work
Inbox sync (every 2 minutes) -> match replies/bounces to threads -> stop follow-ups -> notify
```

Key design points:

- **Workspaces** own all data. Every query is scoped by workspace ID, and membership is re-verified on every request. Roles are owner, admin and member; the permission matrix lives in `packages/core/src/permissions.ts`.
- **Platform admin** access is separate from workspace roles: it requires `users.is_platform_admin` (granted only from the CLI) plus a password re-confirmation that expires after 30 minutes.
- **Sending** never happens in a web request. Messages are created with a deterministic idempotency key per recipient and step, claimed atomically by the worker (`queued -> sending`), re-checked for suppression, replies and campaign state immediately before sending, and retried with exponential backoff for transient provider errors.
- **Billing state** is written only by verified Stripe webhooks (and an explicit Checkout sync). Plan limits are enforced server-side.

## Getting started

Requirements: Node.js 22.12 or newer. PostgreSQL 13 or newer (a development server is included).

```bash
npm install
cp .env.example .env          # then set SESSION_SECRET and EMAIL_ENCRYPTION_KEY
npm run db:start              # terminal 1: local PostgreSQL 18 on :5432 (development only)
npm run db:setup              # migrations + development seed data
npm run dev                   # web on :5173, API on :4000, worker
```

Open http://localhost:5173 and either create an account or sign in with the development seed account:

- Email: `demo@localy.dev`
- Password: `localy-demo-2026`

The seed workspace is clearly labelled "(development data)", every seeded row has `is_dev_data = true`, and the seed script refuses to run with `NODE_ENV=production`.

Without SMTP configured, verification and password-reset emails are captured in the developer outbox at http://localhost:5173/dev/mail. Without Google or Microsoft OAuth configured, you can connect the **development sandbox mailbox** from Integrations. It records every send exactly like a real mailbox but never delivers anything, and replies can be simulated from the Inbox to exercise reply detection. Neither the outbox nor the sandbox is available in production.

Features whose credentials are missing (Places, Maps, Gmail, Outlook, Stripe, AI) are shown as "not configured" in the app, with the exact environment variables required. Nothing is replaced with mock data.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Web, API and worker in watch mode |
| `npm run db:start` | Development PostgreSQL (embedded, development only) |
| `npm run db:migrate` | Apply migrations and ensure default plans |
| `npm run db:seed` | Insert development seed data (refuses in production) |
| `npm run db:setup` | Migrate and seed |
| `npm run db:generate` | Generate a new migration after editing `packages/database/src/schema.ts` |
| `npm run admin:grant -- you@example.com` | Grant platform admin (add `--revoke` to remove) |
| `npm run build` | Production build of web, API and worker |
| `npm run start:api` / `npm run start:worker` | Run production builds |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript across all packages |
| `npm test` | Unit and integration tests (needs PostgreSQL) |
| `npm run test:e2e` | Playwright end-to-end tests (needs the dev stack running) |

## Configuration

All configuration is environment variables, validated at startup (`packages/config`). See `.env.example` for the full list with comments. Production refuses to start with the development secrets.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Signs unsubscribe tokens and cookies (48+ random bytes) |
| `EMAIL_ENCRYPTION_KEY` | 32-byte base64 key for AES-256-GCM encryption of OAuth tokens and 2FA secrets |
| `APP_URL` / `API_URL` | Public URLs (OAuth redirect URIs and unsubscribe links use `API_URL`) |
| `GOOGLE_MAPS_API_KEY` | Server key for Places API (New) and Geocoding. Never sent to browsers |
| `GOOGLE_MAPS_BROWSER_KEY` | Referrer-restricted key for the Maps JavaScript API |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in and Gmail |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Outlook / Microsoft 365 |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Billing |
| `STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_AGENCY` | Stripe Price IDs for paid plans |
| `SMTP_URL` / `MAIL_FROM` | System email (verification, resets, invitations, notifications) |
| `AI_PROVIDER` + `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Optional AI drafting (always reviewed before sending) |

## Third-party setup

**Google Maps Platform.** Enable Places API (New), Geocoding API and Maps JavaScript API. Create two keys: a server key restricted by IP to your API servers (`GOOGLE_MAPS_API_KEY`) and a browser key restricted by HTTP referrer to your `APP_URL` and limited to the Maps JavaScript API (`GOOGLE_MAPS_BROWSER_KEY`). Set quotas and budget alerts in Google Cloud. Localy also rate-limits Places requests per process (`PLACES_REQUESTS_PER_SECOND`) and meters requests per workspace against plan limits.

**Google OAuth (sign-in and Gmail).** Create an OAuth client (web application) with the redirect URI `${API_URL}/api/oauth/google/callback`. Gmail sending uses the scopes `gmail.send` and `gmail.readonly` (reply and bounce detection), which Google classifies as sensitive and restricted scopes: production use requires OAuth app verification.

**Microsoft (Outlook / Microsoft 365).** Register an app in Microsoft Entra ID with the redirect URI `${API_URL}/api/oauth/microsoft/callback` and delegated permissions `Mail.Send`, `Mail.Read`, `User.Read`, `offline_access`, `openid`, `email`, `profile`.

**Stripe.** Create a product for each paid plan with a recurring Price, set the Price IDs, and add a webhook endpoint at `${API_URL}/api/webhooks/stripe` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.payment_failed`. Enable the Stripe customer portal. Plan limits and descriptions are stored in the `plans` table and editable from the admin console; prices are always read from Stripe.

## Data retention and compliance

Localy follows the Google Maps Platform terms:

- Only **place IDs** are stored indefinitely (prospects, search history, discovered-places metering).
- **Coordinates** from Google (search locations) are cached for at most 30 days. The daily cleanup job clears them and keeps the place ID, so locations are re-resolved when needed.
- Business names, addresses, phone numbers, ratings, hours and website URLs are **fetched live** for display and are never written to the database or exported. The user's own entries (contact names, emails, notes, their own business name overrides) are user data.
- Google Maps content is displayed on a Google Map or with "Google Maps" attribution, and the result-ranking explainer is available in Discover.
- Localy reports website status exactly as listed ("No website listed", "Website listed", "Social profile only") and never claims a business definitely has no website. Optional website checks make one lightweight request per listed site, read no content, refuse private network addresses and identify themselves with a descriptive User-Agent.

Outreach compliance: nothing is sent without explicit confirmation; every outreach email includes an unsubscribe link (on by default, one-click `List-Unsubscribe` headers included) and an optional postal address; unsubscribes and bounces are suppressed across the workspace; daily limits apply per campaign and per mailbox; sequences stop automatically when a prospect replies. Opens are not tracked.

## Security

- Passwords hashed with Argon2id (OWASP parameters); constant-time sign-in for unknown emails.
- Sessions: 256-bit random tokens in HttpOnly cookies, stored only as SHA-256 hashes, with expiry, per-device listing and revocation. Password changes and resets revoke other sessions.
- Optional TOTP two-factor authentication with single-use recovery codes.
- CSRF: state-changing cookie-authenticated requests require a custom header and a matching Origin.
- Rate limiting globally and strictly on authentication endpoints.
- Input validation with zod on every route; parameterized SQL via Drizzle; strict Content Security Policy and security headers via Helmet.
- OAuth 2.0 with PKCE and single-use, user-bound, expiring state. Tokens encrypted with AES-256-GCM.
- API keys shown once and stored as SHA-256 hashes; read-only scope enforced.
- Workspace isolation enforced in every service query; covered by integration tests.
- Audit log for sign-ins, settings, members, campaigns, sends, integrations, billing, exports and deletions. Technical errors are logged server-side (including an `error_logs` table visible in the admin console) and never returned to users.

## Testing

```bash
npm run db:start       # if not already running
npm test               # unit + integration (creates and migrates the localy_test database)
npm run dev            # in another terminal, for end-to-end tests
npm run test:e2e
```

Integration tests run the real Fastify app against a real PostgreSQL database. Third-party HTTP APIs (Places, Geocoding, Gmail, Graph, Google OAuth, Stripe) are replaced by a local fake server (`tests/support/fake-services.ts`) that is used only by the test suite. Coverage includes authentication, sessions, 2FA, password reset, email verification, CSRF, rate limiting, authorization and workspace isolation, roles, invitations, admin separation, discovery (field masks, radius filtering, website classification, metering, limits, quota errors, retention cleanup), prospects, campaigns, the sending pipeline (idempotency, duplicate prevention, daily and monthly limits, pause and resume, follow-ups, stop-on-reply, unsubscribes, bounces, Gmail sending, revoked authorization), Stripe webhooks, OAuth flows, templates and personalization, settings, API keys, exports and account deletion.

End-to-end tests (Playwright) cover sign-up with email verification and onboarding, prospect management with notes, tags and global search, composing and sending outreach through the worker with reply handling, and route protection. Set `CHROME_PATH` to use a specific Chromium build.

## Deployment

The web app, API and worker deploy independently:

- **Web**: `npm run build -w @localy/web` produces static files in `apps/web/dist`. Serve them from a CDN with `/api/*` and `/u/*` proxied to the API, or let the API serve them (it does automatically when `apps/web/dist` exists) for a single-origin deployment.
- **API**: `npm run build -w @localy/api` then `node apps/api/dist/main.js`. Stateless; scale horizontally. Runs migrations on start unless `RUN_MIGRATIONS_ON_START=false`.
- **Worker**: `npm run build -w @localy/worker` then `node apps/worker/dist/main.js`. Multiple workers are safe: jobs are claimed with `SKIP LOCKED`, schedules are singletons and sends are idempotent.

Use a managed PostgreSQL instance, set `NODE_ENV=production`, unique `SESSION_SECRET` and `EMAIL_ENCRYPTION_KEY`, HTTPS `APP_URL`/`API_URL`, `SMTP_URL`, and the provider credentials above. If the web app and API are on different origins, set `CORS_ORIGINS` and, for cross-site cookies, `COOKIE_SAMESITE=none`.
