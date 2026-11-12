import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { projectRoot } from './setup-local.mjs';

function run(args, options = {}) {
  const environment = { ...process.env };
  delete environment.POSTGRES_PASSWORD;
  delete environment.APP_DB_PASSWORD;
  const result = spawnSync('docker', [
    'compose', '--project-name', 'crimson-tasks-local', '--file', 'compose.yaml', '--env-file', '.env.docker',
    'exec', '-T', 'db', ...args,
  ], { cwd: projectRoot, env: environment, encoding: 'utf8', timeout: 120_000, ...options });
  if (result.error || result.status !== 0) throw new Error('Обновление БД не завершено. Проверьте локальный PostgreSQL; сохранённая резервная копия не удалена.');
  return result.stdout ?? '';
}

function query(sql) {
  return run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'crimson_tasks'], { input: sql }).trim();
}

export async function migrateLocalDatabase() {
  const directory = path.join(projectRoot, 'db/migrations');
  const filenames = (await readdir(directory)).filter(name => /^\d[\w.-]*\.sql$/.test(name)).sort();
  const exists = query("SELECT to_regclass('public.app_migrations') IS NOT NULL;") === 't';
  const applied = exists ? JSON.parse(query("SELECT COALESCE(json_object_agg(name, checksum), '{}'::json) FROM app_migrations;")) : {};
  const pending = [];
  for (const name of filenames) {
    const sql = await readFile(path.join(directory, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (applied[name] && applied[name] !== checksum) throw new Error(`Применённая миграция ${name} изменена. Создайте новую миграцию вместо изменения старой.`);
    if (!applied[name]) pending.push({ name, sql, checksum });
  }
  if (!pending.length) return;

  const backupDirectory = path.join(projectRoot, '.local-backups');
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupDirectory, `before-migration-${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(4).toString('hex')}.dump`);
  const backup = await open(backupPath, 'wx', 0o600);
  try {
    run(['pg_dump', '-U', 'postgres', '-d', 'crimson_tasks', '-Fc'], { stdio: ['ignore', backup.fd, 'pipe'] });
  } finally { await backup.close(); }
  const source = await open(backupPath, 'r');
  try {
    run(['pg_restore', '--list'], { stdio: [source.fd, 'ignore', 'pipe'] });
  } finally { await source.close(); }
  console.log(`Резервная копия БД проверена: ${path.relative(projectRoot, backupPath)}`);

  query([
    'BEGIN;',
    "SET LOCAL lock_timeout = '10s';",
    'CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());',
    ...pending.flatMap(({ name, sql, checksum }) => [sql, `INSERT INTO app_migrations (name, checksum) VALUES ('${name}', '${checksum}');`]),
    'COMMIT;',
  ].join('\n'));
  console.log(`Применены миграции БД: ${pending.map(item => item.name).join(', ')}`);
}
