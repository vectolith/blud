ALTER TABLE "workspace_memberships"
  ADD CONSTRAINT "workspace_memberships_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "public"."user"("id")
  ON DELETE cascade
  ON UPDATE no action;
