import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';

// Migration credentials are deliberately separate from the restricted runtime role.
if (!process.env.MIGRATION_DATABASE_URL) throw new Error('Set MIGRATION_DATABASE_URL for the database owner.');
const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  await client.query('CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const { rows: applied } = await client.query('SELECT name, checksum FROM app_migrations');
  const directory = new URL('../db/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => /^\d[\w.-]*\.sql$/.test(name)).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = applied.find(migration => migration.name === name);
    if (previous && previous.checksum !== checksum) throw new Error('AppliedMigrationChanged');
    if (previous) continue;
    await client.query(sql);
    await client.query('INSERT INTO app_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
  }
  await client.query('COMMIT');
  console.log('PostgreSQL schema applied.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed:', error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
