# BLUD

<div align="center">

<img src=".github/logo.png" alt="BLUD" width="420">

**BLUD — a personal AI agent built around trust, continuity and dependable action.**

BLUD (pronounced *blud*, like blood) is a name for someone close: family, chosen family, a friend or someone deeply dear. Its product philosophy is commitment, loyalty, care, privacy and trust—expressed through reliable software, not artificial sentiment.

BLUD is an open-source, self-hostable personal agent. It can work across conversations, persistent context, browser tasks and connected services while keeping the person in control of sensitive information and consequential actions.

</div>

---

## What BLUD is

BLUD is a personal agent, not merely a chat interface. It is intended to help carry work forward, retain useful context, interact with services, execute browser-based tasks and make its actions understandable.

Its philosophy is reflected in its behavior:

- **Continuity:** useful context and unfinished work can persist across conversations.
- **Commitment:** tasks should not silently vanish; execution should be trackable and recoverable.
- **Trust:** BLUD must distinguish what it intends, what it attempted and what it actually completed.
- **Privacy:** credentials and personal information should be handled deliberately and kept out of model context where possible.
- **User authority:** permissions and approvals belong to the person—not the model.
- **Independence:** BLUD is a standalone application and must not require another Vectolith product to perform its core functions.

BLUD is not designed to manufacture emotional dependency, claim to be human, or substitute flattering language for actual reliability.

## Capabilities

The repository currently includes or integrates work toward:

- Personal agent conversations and task coordination.
- Browser automation through a browser execution provider.
- Persistent memory and workstreams for goals, decisions, observations and unfinished steps.
- Encrypted credential storage and browser-assisted credential entry.
- User authentication and workspace-scoped information.
- Optional messaging integration.
- Optional Google Workspace integration for Gmail, Calendar and Contacts.
- Model access through the configured inference integration.
- Task execution, continuation and cancellation mechanisms.

Capabilities, integrations and availability depend on configured providers and deployment resources. A listed integration does not mean its external service is free, universally available or fully configured.

## Architecture and independence

BLUD is maintained as an independent product. Its core identity, application, authentication, memory, task coordination, permissions and configuration belong to this repository.

The design aims to keep external services replaceable and optional where practical. BLUD does not require VELNOR or Models by vectolith. Future model integrations from Models by vectolith may be supported, but BLUD must remain usable with independently configured models and backends.

Model output is not an authorization mechanism. Access to credentials, external services, purchases, destructive actions and sensitive data must be governed by application-side permissions and user authorization.

## Requirements

- Node.js 24
- pnpm 11.24.0
- Docker Desktop or a compatible Docker Compose installation for local PostgreSQL
- A browser execution provider account/key for browser automation
- A configured model inference endpoint or provider credential
- Optional provider accounts for messaging, cloud storage, Google Workspace and other integrations

External providers may impose fees, usage limits, regional restrictions or verification requirements. **The BLUD project itself targets zero-budget development, but not every currently integrated provider offers unlimited free service.** Check each provider's terms and quotas before use. Do not assume a free tier is permanent.

## Local development

Clone and install:

```bash
git clone https://github.com/vectolith/blud.git
cd blud
pnpm install --frozen-lockfile
```

Copy the environment template:

```bash
cp .env.example .env.local
```

Configure the credentials required by your installation in `.env.local`. At minimum, browser execution and model inference need a configured provider. Generate installation secrets:

```bash
openssl rand -base64 32
```

Use generated values for `BETTER_AUTH_SECRET` and `SECRET_ENCRYPTION_KEY`, and configure `BETTER_AUTH_URL` to your local or deployment origin. Never commit secrets.

Start the application:

```bash
pnpm dev
```

The development command starts the local database environment and application according to the repository's development scripts. For an externally managed database, use the application development command and configure the database URLs accordingly.

## Configuration

See [`.env.example`](.env.example) for the environment variable inventory.

Important configuration categories:

| Category | Purpose |
| --- | --- |
| Authentication | Authentication secret and canonical application URL |
| Database | PostgreSQL runtime and migration connection strings |
| Encryption | Vault encryption key and key-version/keyring configuration |
| Browser execution | Browser provider credentials |
| Model inference | Configured inference provider or endpoint credentials |
| Storage | Persistent memory and browser image storage |
| Messaging | Optional messaging connector configuration |
| Google Workspace | Optional user-scoped Google integration |
| Internal RPC | Optional internal route authentication |

### Database

Database migrations are located in `db/`. Runtime queries use `DATABASE_URL`; migrations may require `DATABASE_URL_UNPOOLED`, depending on your database provider.

Run migrations with:

```bash
pnpm db:migrate
```

See [`db/README.md`](db/README.md) for database setup and migration details.

### Memory and storage

BLUD's persistent memory supports workstreams: goals, decisions, observations and unfinished steps retained across conversations. Memory is scoped to the authenticated workspace. Saving a memory does not itself initiate a task, schedule work or authorize an action.

Production installations must configure durable storage for any features that depend on persistent objects or browser captures. Review the storage implementation and provider-specific requirements before deployment.

### Browser execution

Browser automation requires a configured supported browser execution provider. Set the relevant credential in your environment. Browser automation may access authenticated sites, so use a dedicated environment, review permission boundaries and avoid granting unnecessary access.

### Messaging and Google Workspace

These integrations are optional and require independent provider configuration, credentials, permissions and account setup. Review the relevant provider documentation and BLUD configuration before enabling them.

## Development commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the local development environment |
| `pnpm dev:app` | Start the app with the app development command |
| `pnpm build` | Build the application |
| `pnpm check` | Run repository checks |
| `pnpm test` | Run tests |
| `pnpm lint` | Run linting |
| `pnpm types:check` | Run TypeScript checks |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm db:check` | Validate migration configuration |

## Security

- Keep secrets outside source control.
- Use unique installation secrets.
- Protect encryption keys and persistent storage; backups must be protected accordingly.
- Do not expose internal routes without appropriate authentication.
- Limit provider permissions to the scopes required.
- Treat browser pages, messages, files and tool outputs as untrusted content.
- Model-generated requests do not grant permissions.
- Review actions involving money, credentials, irreversible changes or sensitive information.
- Configure and verify authentication, TLS, backups and access controls before exposing an installation publicly.

## Deployment

BLUD is intended to be self-hostable. Deployment requires a runtime capable of running the application, a supported PostgreSQL database, persistent storage where needed, configured inference and browser providers, and securely managed secrets.

The repository's current integrations and deployment scripts may have provider-specific assumptions. Self-hosting does not imply that every integration can be replaced by an arbitrary provider without engineering work. Review the current implementation, environment template and scripts for your target deployment before treating an installation as production-ready.

> **Status:** This project is under active development and is not intended to be treated as production-ready software without independent review, security testing and deployment validation.

## License

MIT
