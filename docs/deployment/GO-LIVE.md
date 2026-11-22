# BLUD go-live runbook

The application builds in CI (`pnpm check` plus `pnpm build` on Node 24) and the iMessage
channel is wired at `agent/channels/sendblue.ts`. What is left is hosting: BLUD needs a public
HTTPS origin, a Postgres database, and the environment below. Nothing else is missing.

## 1. Host and database (one-time, needs your account login)

The repository is already configured for Vercel (`vercel.json`, `buildCommand: pnpm turbo run
build:vercel`), which is the deployment the code was written against. Any Node 24 host that can
run `pnpm install --frozen-lockfile && pnpm turbo run build:vercel` works.

1. Import `vectolith/blud` at vercel.com (free Hobby tier is enough for a beta).
2. Create a free Postgres database at neon.tech and copy two connection strings:
   - pooled, for `DATABASE_URL`
   - direct/unpooled, for `DATABASE_URL_UNPOOLED` (used by `db:migrate`, which runs before the
     build, so the schema is created on first deploy)
3. Set the environment variables in section 2 on the deployment.
4. Deploy. The first deploy runs the migration and then builds.

## 2. Environment

Required for the app to start:

| Variable | Where it comes from |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection string |
| `DATABASE_URL_UNPOOLED` | Neon direct connection string |
| `SECRET_ENCRYPTION_KEY` | `openssl rand -base64 32`. Encrypts the credential vault |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | the public origin, e.g. `https://blud.vercel.app` |

Required for iMessage:

| Variable | Where it comes from |
| --- | --- |
| `SENDBLUE_API_KEY` | Sendblue dashboard, API key id |
| `SENDBLUE_API_SECRET` | Sendblue dashboard, API secret |
| `SENDBLUE_FROM_NUMBER` | the Sendblue line, E.164 |
| `SENDBLUE_WEBHOOK_SECRET` | a value you generate; Sendblue sends it on every webhook |

Generate the webhook secret with `openssl rand -hex 32`, then add the same value to the Sendblue
webhook configuration so inbound requests carry it.

## 3. Point the provider at the deployment

Sendblue webhook URL: `https://<your-origin>/sendblue/webhook`

The channel answers on that exact path, with no prefix and no extra segment. A POST with the
correct secret is answered 202 for delivery receipts and handled as a message otherwise; a request
with the wrong secret is answered 401, and a production deployment with no configured secret
answers 503.

## 4. Verify

- `GET /api/health` returns healthy.
- Text the Sendblue line from an allowlisted number: the first inbound message creates the
  workspace and the reply arrives on the same thread.
- A second number must not see the first workspace, which is what the principal in
  `agent/lib/sendblue/identity.ts` guarantees.

## 5. Public pages

The overview, privacy and terms pages needed by the messaging provider live at
https://vectolith.github.io/blud-site/ (repository `vectolith/blud-site`). Point the Sendblue
application at that privacy URL when it asks for one.
