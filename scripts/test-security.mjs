import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

try {
  await access(new URL('../.env.docker', import.meta.url));
  const source = await readFile(new URL('../tests/rate-limit.integration.mjs', import.meta.url), 'utf8');
  const environment = { ...process.env };
  delete environment.POSTGRES_PASSWORD;
  delete environment.APP_DB_PASSWORD;
  const result = spawnSync('docker', [
    'compose', '--project-name', 'crimson-tasks-local', '--file', 'compose.yaml', '--env-file', '.env.docker',
    'exec', '-T', 'app', 'node', '--input-type=module',
  ], { cwd: projectRoot, env: environment, input: source, stdio: ['pipe', 'inherit', 'inherit'], timeout: 60_000 });
  if (result.error) {
    console.error('Не удалось запустить проверку. Убедитесь, что Docker и npm run local:up запущены.');
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
} catch {
  console.error('Для проверки нужен локальный проект с .env.docker. Сначала выполните npm run local:up.');
  process.exitCode = 1;
}
