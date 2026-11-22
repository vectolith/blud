import { relations, sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { agentSessions } from "./sessions";
import { workspaces } from "./workspaces";

export const runtimeTasks = pgTable("runtime_tasks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status", { enum: ["queued", "running", "completed", "failed", "cancelled"] }).notNull().default("queued"),
  output: text("output"),
  error: text("error"),
  createdAt: timestamp("created_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { mode: "date", precision: 3, withTimezone: true }),
}, (table) => [
  foreignKey({ name: "runtime_tasks_session_fkey", columns: [table.sessionId], foreignColumns: [agentSessions.sessionId] }).onDelete("cascade"),
  foreignKey({ name: "runtime_tasks_workspace_fkey", columns: [table.workspaceId], foreignColumns: [workspaces.id] }).onDelete("cascade"),
  check("runtime_tasks_status_check", sql`${table.status} IN ('queued','running','completed','failed','cancelled')`),
  index("runtime_tasks_session_created_idx").on(table.sessionId, table.createdAt),
  index("runtime_tasks_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt),
]);

export const runtimeMessages = pgTable("runtime_messages", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  sessionId: text("session_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  role: text("role", { enum: ["user", "assistant", "tool"] }).notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "runtime_messages_task_fkey", columns: [table.taskId], foreignColumns: [runtimeTasks.id] }).onDelete("cascade"),
  foreignKey({ name: "runtime_messages_session_fkey", columns: [table.sessionId], foreignColumns: [agentSessions.sessionId] }).onDelete("cascade"),
  foreignKey({ name: "runtime_messages_workspace_fkey", columns: [table.workspaceId], foreignColumns: [workspaces.id] }).onDelete("cascade"),
  check("runtime_messages_role_check", sql`${table.role} IN ('user','assistant','tool')`),
  index("runtime_messages_session_created_idx").on(table.sessionId, table.createdAt),
  index("runtime_messages_task_idx").on(table.taskId, table.createdAt),
]);

export const runtimeTasksRelations = relations(runtimeTasks, ({ many, one }) => ({
  messages: many(runtimeMessages),
  session: one(agentSessions, { fields: [runtimeTasks.sessionId], references: [agentSessions.sessionId] }),
}));

export const runtimeMessagesRelations = relations(runtimeMessages, ({ one }) => ({
  task: one(runtimeTasks, { fields: [runtimeMessages.taskId], references: [runtimeTasks.id] }),
}));
