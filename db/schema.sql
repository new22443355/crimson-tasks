CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username varchar(32) UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL CHECK (length(trim(title)) > 0),
  description varchar(5000) NOT NULL DEFAULT '',
  priority varchar(6) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_date date,
  completed boolean NOT NULL DEFAULT false,
  cancelled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT tasks_state_check CHECK (NOT (completed AND cancelled))
);
CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  action varchar(32) NOT NULL CHECK (action IN (
    'user.registered', 'user.logged_in', 'user.logged_out',
    'task.created', 'task.updated', 'task.completed', 'task.cancelled', 'task.reopened', 'task.deleted'
  )),
  task_id uuid,
  task_title text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_events(user_id, id DESC);
CREATE INDEX IF NOT EXISTS audit_user_action_idx ON audit_events(user_id, action, id DESC);
CREATE INDEX IF NOT EXISTS audit_user_date_idx ON audit_events(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_modification();

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key char(64) PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS auth_rate_window_idx ON auth_rate_limits(window_start);
