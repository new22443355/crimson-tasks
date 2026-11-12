# Дневник дел

- Русскоязычный список задач: Vinext / React, Sites Worker, PostgreSQL.
- `app/page.tsx` и `app/globals.css`: интерфейс. `lib/server/`: авторизация, SQL и аудит.
- `db/schema.sql`: схема PostgreSQL, применяется владельцем БД, не runtime-ролью.
- Каждый запрос задач и аудита должен ограничиваться пользователем из серверной сессии.
- Изменение задачи и запись аудита выполняются атомарно. Аудит не редактируется через приложение.
- Секреты находятся в игнорируемых `.env.local`, `.dev.vars` или runtime-настройках Sites. Не выводить их и не коммитить.
- Локальная БД `crimson_tasks`, роль приложения `test`. Не изменять другие БД и роли.
- Проверки: `npm run typecheck`, `npm run test:integration` с `TEST_BASE_URL`, `npm run build`.
- HTTP-мост `scripts/dev-database.mjs` предназначен только для loopback-разработки. Публикация использует Neon HTTP.
- Сохранить `.openai/hosting.json` и интеграцию `sites()` в Vite.
