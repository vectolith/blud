import { index, jsonb, pgTable, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const runtimeTasks = pgTable(
  "runtime_tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    state: text("state").notNull(),
    attempts: integer("attempts").notNull().default(0),
    payload: jsonb("payload").notNull(),
    result: jsonb("result"),
    error: text("error"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("runtime_tasks_workspace_state_idx").on(t.workspaceId, t.state, t.createdAt),
    index("runtime_tasks_lease_idx").on(t.state, t.leaseUntil),
  ],
);

export const runtimeTaskEvents = pgTable(
  "runtime_task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => runtimeTasks.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => [
    uniqueIndex("runtime_task_events_sequence_idx").on(t.taskId, t.sequence),
    index("runtime_task_events_workspace_idx").on(t.workspaceId, t.taskId),
  ],
);
