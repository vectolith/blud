CREATE OR REPLACE FUNCTION "cleanup_better_auth_user_workspaces"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  removed_workspace_ids TEXT[];
BEGIN
  SELECT array_agg(DISTINCT "workspace_id")
  INTO removed_workspace_ids
  FROM "workspace_memberships"
  WHERE "user_id" = 'better-auth:' || OLD."id";

  DELETE FROM "workspace_memberships"
  WHERE "user_id" = 'better-auth:' || OLD."id";

  IF removed_workspace_ids IS NOT NULL THEN
    DELETE FROM "workspaces" AS workspace
    WHERE workspace."id" = ANY(removed_workspace_ids)
      AND NOT EXISTS (
        SELECT 1
        FROM "workspace_memberships" AS membership
        WHERE membership."workspace_id" = workspace."id"
      );
  END IF;

  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "user_workspace_cleanup_after_delete"
AFTER DELETE ON "user"
FOR EACH ROW
EXECUTE FUNCTION "cleanup_better_auth_user_workspaces"();
