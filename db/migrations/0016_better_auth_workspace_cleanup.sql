CREATE FUNCTION "cleanup_better_auth_user_workspaces"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  WITH removed_memberships AS (
    DELETE FROM "workspace_memberships"
    WHERE "user_id" = 'better-auth:' || OLD."id"
    RETURNING "workspace_id"
  )
  DELETE FROM "workspaces" AS workspace
  USING (
    SELECT DISTINCT "workspace_id"
    FROM removed_memberships
  ) AS removed_workspace
  WHERE workspace."id" = removed_workspace."workspace_id"
    AND NOT EXISTS (
      SELECT 1
      FROM "workspace_memberships" AS membership
      WHERE membership."workspace_id" = workspace."id"
    );

  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "user_workspace_cleanup_after_delete"
AFTER DELETE ON "user"
FOR EACH ROW
EXECUTE FUNCTION "cleanup_better_auth_user_workspaces"();
