# BLUD go-live runbook

The application builds in CI (`pnpm check` plus `pnpm build` on Node 24) and the iMessage
channel is wired at `agent/channels/sendblue.ts`. What is left is hosting: BLUD needs a public
HTTPS origin, a Postgres database, and the environment below. Nothing else is missing.

## 1. Host and database (one-time, needs your account login)

The repository ships a Render blueprint (`render.yaml`) that provisions the web service and a
Postgres instance together. Any Node 24 host that can run `pnpm install --frozen-lockfile && pnpm
db:migrate && pnpm build` followed by `pnpm start` works the same way.

1. In Render: **New +** -> **Blueprint**, point it at `vectolith/blud`, apply. This creates
   `blud` (web, free plan) and `blud-postgres` (free plan).
2. `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are wired from the database automatically.
   `db:migrate` runs before the build, so the schema is created on first deploy.
3. Fill the `sync: false` values from section 2 in the service's Environment tab.
4. Deploy. `/api/health` is the health check; it answers 503 when the database is unreachable.

Render's free Postgres is deleted after 30 days; move to a paid plan before a real beta.

## 2. Environment

Required for the app to start:

| Variable                | Where it comes from                                      |
| ----------------------- | -------------------------------------------------------- |
| `DATABASE_URL`          | provided by the `blud-postgres` blueprint database       |
| `DATABASE_URL_UNPOOLED` | same database, used by `db:migrate` at build time        |
| `SECRET_ENCRYPTION_KEY` | `openssl rand -base64 32`. Encrypts the credential vault |
| `BETTER_AUTH_SECRET`    | `openssl rand -base64 32`                                |
| `BETTER_AUTH_URL`       | the public origin, e.g. `https://blud.vercel.app`        |

Required for iMessage:

| Variable                  | Where it comes from                                      |
| ------------------------- | -------------------------------------------------------- |
| `SENDBLUE_API_KEY`        | Sendblue dashboard, API key id                           |
| `SENDBLUE_API_SECRET`     | Sendblue dashboard, API secret                           |
| `SENDBLUE_FROM_NUMBER`    | the Sendblue line, E.164                                 |
| `SENDBLUE_WEBHOOK_SECRET` | a value you generate; Sendblue sends it on every webhook |

Generate the webhook secret with `openssl rand -hex 32`, then add the same value to the Sendblue
webhook configuration so inbound requests carry it.

Required for artifacts and scheduler callbacks:

| Variable               | Where it comes from                                           |
| ---------------------- | ------------------------------------------------------------- |
| `S3_ENDPOINT`          | S3-compatible storage endpoint (R2, B2, MinIO, AWS S3)        |
| `S3_REGION`            | that provider's region, `auto` for R2                         |
| `S3_BUCKET`            | bucket that holds browser artifacts and installation secrets  |
| `S3_ACCESS_KEY_ID`     | access key with read/write on that bucket                     |
| `S3_SECRET_ACCESS_KEY` | matching secret                                               |
| `BLUD_INTERNAL_KEY`    | `openssl rand -hex 32`. Authenticates scheduled-run callbacks |

When the `S3_*` values are unset the app falls back to an in-process object store, which is fine for
local development and loses data on restart.

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
