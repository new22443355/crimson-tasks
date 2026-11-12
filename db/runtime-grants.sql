-- Apply as database owner after schema.sql. Role test must already exist.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO test;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, tasks, auth_rate_limits TO test;
GRANT SELECT, INSERT ON audit_events TO test;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM test;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO test;
