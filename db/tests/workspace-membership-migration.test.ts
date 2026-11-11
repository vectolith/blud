import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("workspace membership user foreign key migration", () => {
  it("preserves valid memberships and cascades deleted Better Auth users", async () => {
    const database = new PGlite();
    databases.push(database);
    await createLegacyWorkspaceSchema(database);
    await database.exec(`
      INSERT INTO "user" (id, name, email)
      VALUES ('owner-a', 'Owner A', 'owner-a@example.com');
      INSERT INTO workspaces (id) VALUES ('workspace-a');
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES ('workspace-a', 'owner-a', 'owner');
    `);

    await applyMigration(database);

    const constraint = await database.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'workspace_memberships'::regclass
        AND conname = 'workspace_memberships_user_id_fkey'
    `);
    expect(constraint.rows).toEqual([
      { conname: "workspace_memberships_user_id_fkey" },
    ]);

    await database.exec(`DELETE FROM "user" WHERE id = 'owner-a'`);
    const remaining = await database.query(`
      SELECT count(*)::int AS memberships FROM workspace_memberships
    `);
    expect(remaining.rows[0]).toEqual({ memberships: 0 });
  });

  it("fails without deleting or rewriting existing orphaned membership data", async () => {
    const database = new PGlite();
    databases.push(database);
    await createLegacyWorkspaceSchema(database);
    await database.exec(`
      INSERT INTO workspaces (id) VALUES ('workspace-orphan');
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES ('workspace-orphan', 'missing-user', 'owner');
    `);

    await expect(applyMigration(database)).rejects.toThrow(
      /foreign key constraint/i
    );

    const remaining = await database.query(`
      SELECT workspace_id, user_id, role FROM workspace_memberships
    `);
    expect(remaining.rows).toEqual([
      {
        workspace_id: "workspace-orphan",
        user_id: "missing-user",
        role: "owner",
      },
    ]);
  });
});

async function createLegacyWorkspaceSchema(database: PGlite) {
  await database.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE workspace_memberships (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id),
      CONSTRAINT workspace_memberships_workspace_id_fkey
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      CONSTRAINT workspace_memberships_role_check CHECK (role = 'owner')
    );
  `);
}

async function applyMigration(database: PGlite) {
  const migration = await readFile(
    new URL(
      "../migrations/0016_workspace_membership_user_fk.sql",
      import.meta.url
    ),
    "utf8"
  );
  /* oxlint-disable eslint/no-await-in-loop -- migration statements must remain ordered. */
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
  /* oxlint-enable eslint/no-await-in-loop */
}
