import { randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function ensureLocalEnvironment(directory = projectRoot) {
  const target = path.join(directory, '.env.docker');
  let created = false;
  try {
    await writeFile(target, [
      '# Generated locally. Keep this file while the PostgreSQL volume exists.',
      `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`,
      `APP_DB_PASSWORD=${randomBytes(24).toString('hex')}`,
      '',
    ].join('\n'), { flag: 'wx', mode: 0o600 });
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const values = parseEnv(await readFile(target, 'utf8'));
  for (const key of ['POSTGRES_PASSWORD', 'APP_DB_PASSWORD']) {
    if (!/^[A-Za-z0-9]{32,}$/.test(values[key] ?? '')) {
      throw new Error(`В .env.docker отсутствует корректный ${key}. Существующий файл не изменён.`);
    }
  }
  if (process.platform !== 'win32') await chmod(target, 0o600);
  return { target, created };
}
