import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    displayName: text("display_name"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("integration_connections_id_owner_uidx").on(
      table.id,
      table.ownerUserId
    ),
    unique("integration_connections_owner_provider_account_uidx").on(
      table.ownerUserId,
      table.providerKey,
      table.providerAccountId
    ),
    index("integration_connections_owner_idx").on(
      table.ownerUserId,
      table.createdAt
    ),
    check(
      "integration_connections_provider_check",
      sql`${table.providerKey} IN ('github', 'google_workspace')`
    ),
    check(
      "integration_connections_status_check",
      sql`${table.status} IN ('active', 'reauthorization_required', 'revoked', 'failed')`
    ),
    check(
      "integration_connections_revocation_check",
      sql`${table.status} = 'revoked' OR ${table.revokedAt} IS NULL`
    ),
  ]
);

export const integrationCredentials = pgTable(
  "integration_credentials",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    credentialType: text("credential_type").notNull(),
    algorithm: text("algorithm").notNull().default("aes-256-gcm"),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    keyVersion: text("key_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("integration_credentials_connection_type_uidx").on(
      table.connectionId,
      table.credentialType
    ),
    foreignKey({
      name: "integration_credentials_connection_owner_fkey",
      columns: [table.connectionId, table.ownerUserId],
      foreignColumns: [
        integrationConnections.id,
        integrationConnections.ownerUserId,
      ],
    }).onDelete("cascade"),
    check(
      "integration_credentials_type_check",
      sql`${table.credentialType} IN ('oauth_tokens', 'api_token')`
    ),
    check(
      "integration_credentials_algorithm_check",
      sql`${table.algorithm} = 'aes-256-gcm'`
    ),
    index("integration_credentials_owner_idx").on(table.ownerUserId),
  ]
);

export const integrationConnectionScopes = pgTable(
  "integration_connection_scopes",
  {
    connectionId: text("connection_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    scope: text("scope").notNull(),
    grantedAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: "integration_connection_scopes_pkey",
      columns: [table.connectionId, table.scope],
    }),
    foreignKey({
      name: "integration_connection_scopes_connection_owner_fkey",
      columns: [table.connectionId, table.ownerUserId],
      foreignColumns: [
        integrationConnections.id,
        integrationConnections.ownerUserId,
      ],
    }).onDelete("cascade"),
    index("integration_connection_scopes_owner_idx").on(table.ownerUserId),
  ]
);

export const integrationActionGrants = pgTable(
  "integration_action_grants",
  {
    connectionId: text("connection_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    actionKey: text("action_key").notNull(),
    decision: text("decision").notNull().default("allow"),
    grantedByUserId: text("granted_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: "integration_action_grants_pkey",
      columns: [table.connectionId, table.actionKey],
    }),
    foreignKey({
      name: "integration_action_grants_connection_owner_fkey",
      columns: [table.connectionId, table.ownerUserId],
      foreignColumns: [
        integrationConnections.id,
        integrationConnections.ownerUserId,
      ],
    }).onDelete("cascade"),
    check(
      "integration_action_grants_decision_check",
      sql`${table.decision} IN ('allow', 'deny')`
    ),
    check(
      "integration_action_grants_owner_only_check",
      sql`${table.grantedByUserId} = ${table.ownerUserId}`
    ),
    index("integration_action_grants_owner_idx").on(table.ownerUserId),
  ]
);

export const integrationAuthorizationAttempts = pgTable(
  "integration_authorization_attempts",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    stateHash: text("state_hash").notNull().unique(),
    pkceVerifierCiphertext: text("pkce_verifier_ciphertext").notNull(),
    pkceVerifierIv: text("pkce_verifier_iv").notNull(),
    pkceVerifierAuthTag: text("pkce_verifier_auth_tag").notNull(),
    keyVersion: text("key_version").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "integration_authorization_attempts_provider_check",
      sql`${table.providerKey} IN ('github', 'google_workspace')`
    ),
    check(
      "integration_authorization_attempts_status_check",
      sql`${table.status} IN ('pending', 'completed', 'failed', 'expired')`
    ),
    index("integration_authorization_attempts_owner_idx").on(
      table.ownerUserId,
      table.createdAt
    ),
    index("integration_authorization_attempts_expiry_idx").on(
      table.status,
      table.expiresAt
    ),
  ]
);

export const integrationConnectionsRelations = relations(
  integrationConnections,
  ({ one, many }) => ({
    owner: one(user, {
      fields: [integrationConnections.ownerUserId],
      references: [user.id],
    }),
    credentials: many(integrationCredentials),
    scopes: many(integrationConnectionScopes),
    actionGrants: many(integrationActionGrants),
  })
);
