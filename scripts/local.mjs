import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ensureLocalEnvironment, projectRoot } from './setup-local.mjs';

const commands = {
  up: ['up', '--build', '--detach', '--wait', '--wait-timeout', '180'],
  down: ['down'],
  logs: ['logs', '--follow', '--tail', '100'],
  status: ['ps'],
};
const action = process.argv[2];
if (!Object.hasOwn(commands, action)) {
  console.error('Команда: node scripts/local.mjs up|down|logs|status');
  process.exit(1);
}

function docker(args, stdio = 'inherit') {
  const environment = { ...process.env };
  delete environment.POSTGRES_PASSWORD;
  delete environment.APP_DB_PASSWORD;
  const result = spawnSync('docker', args, { cwd: projectRoot, stdio, env: environment });
  if (result.error?.code === 'ENOENT') throw new Error('Docker не найден. Установите и запустите Docker Desktop.');
  if (result.error) throw result.error;
  return result;
}

try {
  if (docker(['info'], 'ignore').status !== 0) throw new Error('Docker Engine не запущен. Запустите Docker Desktop и повторите команду.');
  if (docker(['compose', 'version'], 'ignore').status !== 0) throw new Error('Нужен Docker Compose v2 (входит в Docker Desktop).');
  let environmentExists = true;
  try { await access(path.join(projectRoot, '.env.docker')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    environmentExists = false;
  }
  if (!environmentExists) {
    if (action !== 'up') throw new Error('Файл .env.docker отсутствует. Сначала выполните npm run local:up.');
    if (docker(['volume', 'inspect', 'crimson-tasks-local_postgres_data'], 'ignore').status === 0) {
      throw new Error('Найдена существующая БД, но отсутствует .env.docker. Восстановите этот файл из своей резервной копии; пароли не будут заменены автоматически.');
    }
  }
  const { created } = await ensureLocalEnvironment();
  if (created) console.log('Создан .env.docker со случайными паролями. Файл исключён из Git.');
  const result = docker(['compose', '--project-name', 'crimson-tasks-local', '--file', 'compose.yaml', '--env-file', '.env.docker', ...commands[action]]);
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else if (action === 'up') {
    console.log('\nДневник дел готов: http://127.0.0.1:3000\nСоздайте аккаунт на странице регистрации.');
  } else if (action === 'down') {
    console.log('Приложение остановлено. Данные PostgreSQL сохранены.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
