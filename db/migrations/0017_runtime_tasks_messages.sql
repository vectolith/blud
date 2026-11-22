CREATE TABLE "runtime_tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "prompt" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "output" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "runtime_tasks_session_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("session_id") ON DELETE cascade,
  CONSTRAINT "runtime_tasks_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "runtime_tasks_status_check" CHECK ("status" IN ('queued','running','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE INDEX "runtime_tasks_session_created_idx" ON "runtime_tasks" ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX "runtime_tasks_workspace_status_idx" ON "runtime_tasks" ("workspace_id", "status", "updated_at");
--> statement-breakpoint
CREATE TABLE "runtime_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "session_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runtime_messages_task_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."runtime_tasks"("id") ON DELETE cascade,
  CONSTRAINT "runtime_messages_session_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("session_id") ON DELETE cascade,
  CONSTRAINT "runtime_messages_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "runtime_messages_role_check" CHECK ("role" IN ('user','assistant','tool'))
);
--> statement-breakpoint
CREATE INDEX "runtime_messages_session_created_idx" ON "runtime_messages" ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX "runtime_messages_task_idx" ON "runtime_messages" ("task_id", "created_at");
