CREATE TABLE "integration_connections" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL,
  "provider_key" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "display_name" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "integration_connections_owner_user_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade,
  CONSTRAINT "integration_connections_provider_check" CHECK ("provider_key" IN ('github', 'google_workspace')),
  CONSTRAINT "integration_connections_status_check" CHECK ("status" IN ('active', 'reauthorization_required', 'revoked', 'failed')),
  CONSTRAINT "integration_connections_revocation_check" CHECK ("status" = 'revoked' OR "revoked_at" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_id_owner_uidx" ON "integration_connections" USING btree ("id", "owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_owner_provider_account_uidx" ON "integration_connections" USING btree ("owner_user_id", "provider_key", "provider_account_id");
--> statement-breakpoint
CREATE INDEX "integration_connections_owner_idx" ON "integration_connections" USING btree ("owner_user_id", "created_at");
--> statement-breakpoint
CREATE TABLE "integration_credentials" (
  "id" text PRIMARY KEY NOT NULL,
  "connection_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "credential_type" text NOT NULL,
  "algorithm" text DEFAULT 'aes-256-gcm' NOT NULL,
  "ciphertext" text NOT NULL,
  "iv" text NOT NULL,
  "auth_tag" text NOT NULL,
  "key_version" text NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "integration_credentials_connection_owner_fkey" FOREIGN KEY ("connection_id", "owner_user_id") REFERENCES "public"."integration_connections"("id", "owner_user_id") ON DELETE cascade,
  CONSTRAINT "integration_credentials_type_check" CHECK ("credential_type" IN ('oauth_tokens', 'api_token')),
  CONSTRAINT "integration_credentials_algorithm_check" CHECK ("algorithm" = 'aes-256-gcm')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credentials_connection_type_uidx" ON "integration_credentials" USING btree ("connection_id", "credential_type");
--> statement-breakpoint
CREATE INDEX "integration_credentials_owner_idx" ON "integration_credentials" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE TABLE "integration_connection_scopes" (
  "connection_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "scope" text NOT NULL,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "integration_connection_scopes_pkey" PRIMARY KEY ("connection_id", "scope"),
  CONSTRAINT "integration_connection_scopes_connection_owner_fkey" FOREIGN KEY ("connection_id", "owner_user_id") REFERENCES "public"."integration_connections"("id", "owner_user_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "integration_connection_scopes_owner_idx" ON "integration_connection_scopes" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE TABLE "integration_action_grants" (
  "connection_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "action_key" text NOT NULL,
  "decision" text DEFAULT 'allow' NOT NULL,
  "granted_by_user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "integration_action_grants_pkey" PRIMARY KEY ("connection_id", "action_key"),
  CONSTRAINT "integration_action_grants_connection_owner_fkey" FOREIGN KEY ("connection_id", "owner_user_id") REFERENCES "public"."integration_connections"("id", "owner_user_id") ON DELETE cascade,
  CONSTRAINT "integration_action_grants_grantor_user_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade,
  CONSTRAINT "integration_action_grants_decision_check" CHECK ("decision" IN ('allow', 'deny')),
  CONSTRAINT "integration_action_grants_owner_only_check" CHECK ("granted_by_user_id" = "owner_user_id")
);
--> statement-breakpoint
CREATE INDEX "integration_action_grants_owner_idx" ON "integration_action_grants" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE TABLE "integration_authorization_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL,
  "provider_key" text NOT NULL,
  "state_hash" text NOT NULL,
  "pkce_verifier_ciphertext" text NOT NULL,
  "pkce_verifier_iv" text NOT NULL,
  "pkce_verifier_auth_tag" text NOT NULL,
  "key_version" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "integration_authorization_attempts_owner_user_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade,
  CONSTRAINT "integration_authorization_attempts_provider_check" CHECK ("provider_key" IN ('github', 'google_workspace')),
  CONSTRAINT "integration_authorization_attempts_status_check" CHECK ("status" IN ('pending', 'completed', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_authorization_attempts_state_hash_uidx" ON "integration_authorization_attempts" USING btree ("state_hash");
--> statement-breakpoint
CREATE INDEX "integration_authorization_attempts_owner_idx" ON "integration_authorization_attempts" USING btree ("owner_user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "integration_authorization_attempts_expiry_idx" ON "integration_authorization_attempts" USING btree ("status", "expires_at");
