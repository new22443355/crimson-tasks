import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const suffix = randomBytes(8).toString('hex');
const usernames = [0, 1, 2, 3].map((number) => `qa_limit_${number}_${suffix}`);
const userKeys = usernames.map((username) => hash(`auth-user:${username}`));
const globalKey = hash('auth-instance:local');
const staleKey = hash(`auth-user:qa_stale_${suffix}`);
const password = randomBytes(24).toString('base64url');
const base = `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
});
let connected = false;
let captured = false;
let previousGlobal;

async function login(username, forgedIp) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', 'cf-connecting-ip': forgedIp },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(10_000),
  });
  await response.arrayBuffer();
  return response.status;
}

async function setGlobal(attempts) {
  await client.query(`INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, $2, now())
    ON CONFLICT (key) DO UPDATE SET attempts = EXCLUDED.attempts, window_start = EXCLUDED.window_start`, [globalKey, attempts]);
}

try {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL должен быть задан контейнером приложения.');
  await client.connect();
  connected = true;
  const previous = await client.query('SELECT attempts, window_start::text AS window_start FROM auth_rate_limits WHERE key = $1', [globalKey]);
  previousGlobal = previous.rows[0];
  captured = true;

  await setGlobal(60);
  await client.query("INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, 1, '1970-01-01T00:00:00Z')", [staleKey]);
  for (let index = 0; index < 3; index++) {
    assert.equal(await login(usernames[index], `198.51.100.${index + 1}`), 429, 'Подмена IP-заголовка не должна обходить общий лимит.');
  }
  const rejected = await client.query('SELECT count(*)::integer AS count FROM auth_rate_limits WHERE key = ANY($1::text[])', [userKeys]);
  assert.equal(rejected.rows[0].count, 0, 'Отклонённые общим лимитом логины не должны создавать новые ключи пользователей.');
  const saturated = await client.query('SELECT attempts FROM auth_rate_limits WHERE key = $1', [globalKey]);
  assert.equal(saturated.rows[0].attempts, 61, 'Счётчик общего лимита должен оставаться ограниченным.');
  const stale = await client.query('SELECT key FROM auth_rate_limits WHERE key = $1', [staleKey]);
  assert.equal(stale.rowCount, 0, 'Истёкший ключ должен очищаться при попытке входа.');
  console.log('PASS: подмена заголовка заблокирована; отклонённые логины не увеличивают таблицу; счётчик ограничен; старые ключи очищаются.');

  await setGlobal(0);
  await client.query('INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, 12, now())', [userKeys[0]]);
  for (const forgedIp of ['203.0.113.1', '203.0.113.2']) {
    assert.equal(await login(usernames[0], forgedIp), 429, 'Индивидуальный лимит должен сохраняться независимо от заголовка.');
  }
  const personal = await client.query('SELECT attempts FROM auth_rate_limits WHERE key = $1', [userKeys[0]]);
  assert.equal(personal.rows[0].attempts, 13, 'Счётчик индивидуального лимита должен оставаться ограниченным.');
  assert.equal(await login(usernames[3], '203.0.113.3'), 401, 'Свободный общий лимит должен разрешать проверку нового логина.');
  console.log('PASS: индивидуальный лимит действует; разрешённые запросы доходят до проверки пароля.');
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : 'Проверка лимитов не завершена: ошибка PostgreSQL или локального API.');
  process.exitCode = 1;
} finally {
  if (connected) {
    try {
      await client.query('DELETE FROM auth_rate_limits WHERE key = ANY($1::text[])', [[...userKeys, staleKey]]);
      if (captured) {
        if (previousGlobal) {
          await client.query(`INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, $2, $3::timestamptz)
            ON CONFLICT (key) DO UPDATE SET attempts = EXCLUDED.attempts, window_start = EXCLUDED.window_start`,
          [globalKey, previousGlobal.attempts, previousGlobal.window_start]);
        } else {
          await client.query('DELETE FROM auth_rate_limits WHERE key = $1', [globalKey]);
        }
      }
    } catch {
      console.error('Не удалось восстановить тестовые записи ограничителя. Повторите проверку после восстановления PostgreSQL.');
      process.exitCode = 1;
    } finally {
      await client.end();
    }
  }
}
