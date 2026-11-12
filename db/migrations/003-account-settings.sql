ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
  'user.registered', 'user.logged_in', 'user.logged_out', 'user.username_changed', 'user.password_changed',
  'task.created', 'task.updated', 'task.completed', 'task.cancelled', 'task.reopened', 'task.deleted'
));
