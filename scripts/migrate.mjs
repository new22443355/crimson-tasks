import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Migration credentials are deliberately separate from the restricted runtime role.
if (!process.env.MIGRATION_DATABASE_URL) throw new Error('Set MIGRATION_DATABASE_URL for the database owner.');
const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('PostgreSQL schema applied.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed:', error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
