import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("Better Auth workspace cleanup trigger", () => {
  it("removes a deleted user's personal workspace and cascades its data", async () => {
    const database = new PGlite();
    databases.push(database);
    await createLegacyWorkspaceSchema(database);
    await database.exec(`
      INSERT INTO "user" (id) VALUES ('owner-a');
      INSERT INTO workspaces (id) VALUES ('personal:owner-a');
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES ('personal:owner-a', 'better-auth:owner-a', 'owner');
      INSERT INTO vault_items (id, workspace_id, label)
      VALUES ('vault-owner-a', 'personal:owner-a', 'private item');
    `);

    await applyMigration(database);
    await database.exec(`DELETE FROM "user" WHERE id = 'owner-a'`);

    const remainingWorkspaces = await database.query(
      "SELECT id FROM workspaces"
    );
    const remainingMemberships = await database.query(
      "SELECT workspace_id, user_id FROM workspace_memberships"
    );
    const remainingVaultItems = await database.query(
      "SELECT id FROM vault_items"
    );
    expect(remainingWorkspaces.rows).toEqual([]);
    expect(remainingMemberships.rows).toEqual([]);
    expect(remainingVaultItems.rows).toEqual([]);
  });

  it("preserves a workspace and its data while another principal still belongs to it", async () => {
    const database = new PGlite();
    databases.push(database);
    await createLegacyWorkspaceSchema(database);
    await database.exec(`
      INSERT INTO "user" (id) VALUES ('owner-a'), ('owner-b');
      INSERT INTO workspaces (id) VALUES ('workspace-shared');
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES
        ('workspace-shared', 'better-auth:owner-a', 'owner'),
        ('workspace-shared', 'better-auth:owner-b', 'owner');
      INSERT INTO vault_items (id, workspace_id, label)
      VALUES ('vault-shared', 'workspace-shared', 'shared item');
    `);

    await applyMigration(database);
    await database.exec(`DELETE FROM "user" WHERE id = 'owner-a'`);

    const memberships = await database.query(
      "SELECT workspace_id, user_id FROM workspace_memberships"
    );
    const workspaces = await database.query("SELECT id FROM workspaces");
    const vaultItems = await database.query(
      "SELECT id, workspace_id FROM vault_items"
    );
    expect(memberships.rows).toEqual([
      {
        workspace_id: "workspace-shared",
        user_id: "better-auth:owner-b",
      },
    ]);
    expect(workspaces.rows).toEqual([{ id: "workspace-shared" }]);
    expect(vaultItems.rows).toEqual([
      { id: "vault-shared", workspace_id: "workspace-shared" },
    ]);

    await database.exec(`DELETE FROM "user" WHERE id = 'owner-b'`);
    const finalWorkspaces = await database.query("SELECT id FROM workspaces");
    const finalVaultItems = await database.query("SELECT id FROM vault_items");
    expect(finalWorkspaces.rows).toEqual([]);
    expect(finalVaultItems.rows).toEqual([]);
  });
});

async function createLegacyWorkspaceSchema(database: PGlite) {
  await database.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY);
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE workspace_memberships (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id),
      CONSTRAINT workspace_memberships_workspace_id_fkey
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE vault_items (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      label TEXT NOT NULL,
      CONSTRAINT vault_items_workspace_id_fkey
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
  `);
}

async function applyMigration(database: PGlite) {
  const migration = await readFile(
    new URL(
      "../migrations/0016_better_auth_workspace_cleanup.sql",
      import.meta.url
    ),
    "utf8"
  );
  /* oxlint-disable eslint/no-await-in-loop -- SQL migration statements must execute in file order. */
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
  /* oxlint-enable eslint/no-await-in-loop */
}
