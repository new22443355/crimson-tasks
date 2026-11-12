#!/bin/sh
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --single-transaction <<'SQL'
\getenv app_password APP_DB_PASSWORD
CREATE ROLE test LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
REVOKE ALL ON DATABASE crimson_tasks FROM PUBLIC;
GRANT CONNECT ON DATABASE crimson_tasks TO test;
\i /opt/crimson/schema.sql
\i /opt/crimson/runtime-grants.sql
SQL
