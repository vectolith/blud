CREATE TABLE IF NOT EXISTS runtime_tasks (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, owner_id text NOT NULL, state text NOT NULL CHECK (state IN ('queued','running','waiting_approval','completed','failed','cancelled')), attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), payload jsonb NOT NULL, result jsonb, error text, lease_until timestamptz, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS runtime_tasks_workspace_state_idx ON runtime_tasks(workspace_id,state,created_at);
CREATE INDEX IF NOT EXISTS runtime_tasks_lease_idx ON runtime_tasks(state,lease_until);
CREATE TABLE IF NOT EXISTS runtime_task_events (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES runtime_tasks(id) ON DELETE CASCADE, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, sequence integer NOT NULL CHECK(sequence>0), type text NOT NULL, at timestamptz NOT NULL, data jsonb NOT NULL, UNIQUE(task_id,sequence)
);
CREATE INDEX IF NOT EXISTS runtime_task_events_workspace_idx ON runtime_task_events(workspace_id,task_id);
