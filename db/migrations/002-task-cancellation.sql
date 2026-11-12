ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_state_check'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_state_check CHECK (NOT (completed AND cancelled));
  END IF;
END;
$$;

ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
  'user.registered', 'user.logged_in', 'user.logged_out',
  'task.created', 'task.updated', 'task.completed', 'task.cancelled', 'task.reopened', 'task.deleted'
));

CREATE INDEX IF NOT EXISTS audit_user_action_idx ON audit_events(user_id, action, id DESC);
CREATE INDEX IF NOT EXISTS audit_user_date_idx ON audit_events(user_id, created_at DESC);
