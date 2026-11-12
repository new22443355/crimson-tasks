# Security Review: crimson-tasks

## Scope

Полный Standard security review30 текущих распространяемых файлов crimson-tasks, включая Next.js API/client, PostgreSQL schema/grants, Docker, launch/migration scripts, tests, docs и lockfile.

- Scan mode: repository
- Target kind: git_worktree
- Target ID: target_sha256_0778e285402348718549ebcf115abeb022972989a3b4688656c6eeea668316b9
- Revision: fa86757af2d149a0cf206c2c2e461d839ce5121f
- Snapshot digest: codex-security-snapshot/v1:sha256:b384726395ea01571139cf989e74b086e3b8d16f5103e17c1140ee34e2f01be9
- Inventory strategy: repository
- Included paths: .
- Excluded paths: none
- Artifacts reviewed: app/: client JSX, API route and layout/CSS; lib/server/: api, security, db, db/schema.sql; db/runtime-grants.sql; Dockerfile; compose.yaml, scripts/{setup-local,local,start-local,migrate}.mjs; scripts/docker-db-init.sh; tests/api.integration.mjs, README.md; AGENTS.md; .env.example; .gitignore; .dockerignore; .gitattributes; .npmrc; package.json; package-lock.json; next.config.ts; postcss.config.mjs; tsconfig.json; public/favicon.svg, artifacts/local-redteam.mjs and artifacts/local-redteam-result.json: runtime negative cases and C1 reproduction, artifacts/limiter-storage.mjs and artifacts/limiter-storage-result.json: C2 reproduction
- Scan context: Пользователь запросил отдельную полную red-team проверку проекта, который передается приватным GitHub-репозиторием и работает только локально. Выполнен один Standard scan с независимым baseline и независимой архитектурной проверкой; threat model generated from source, не внешний input. Во время начальной регистрации scan ведущий завершил loopback Origin/Host исправление; итоговый текущий код этого контроля прочитан и протестирован. Добавленный .gitattributes также прочитан. Findings отражают состояние до исправлений C1/C2.

Limitations and exclusions:
- Проверка не доказывает отсутствие всех уязвимостей; динамическая проверка ограничена текущим Docker/localhost и контролируемыми тестовыми аккаунтами.
- Без нагрузочного заполнения диска, подбора чужих паролей, внешней эксплуатации или чтения секретных env-файлов.
- Сторонние npm/framework/PostgreSQL/Node/Docker implementations и внешняя CVE-база не аудировались; lockfile reviewed как manifest. Состояние старого интернет-хостинга и GitHub visibility вне этой проверки.
- XSS data paths проверены по React JSX и literal API roundtrip; отдельного браузерного исполнения XSS payload этим аудитом не выполнялось.
- Windows ACL и альтернативная ручная DATABASE_URL конфигурация не проверялись динамически.
- Excluded node_modules/\*\*, .next/\*\*, dist/\*\*: Third-party and generated framework/build implementation not audited. Active launch uses .next standalone; ignored old dist is inactive.
- Excluded .git/\*\*: History and prior revisions outside current-source scan.
- Excluded .env.local, .env.docker, .dev.vars: Ignored actual credentials are not copied/read for report; generation, consumers, exclusion and permission controls checked instead.
- Excluded .sites-runtime/\*\*, .wrangler/\*\*, local tool state: Ignored prior deployment metadata is not part of the distributed active application; baseline inspected selected files for embedded secret context only.
- Excluded node_modules/\*\*, .next/\*\*, .git/\*\*: Сторонняя реализация, сборочные артефакты и история Git.
- Excluded .env.local, .env.docker: Локальные игнорируемые секреты не копируются в отчет; проверяются пути, правила исключения и права.

### Scan Summary

| Field | Value |
| --- | --- |
| Scan outcome | completed |
| Reportable findings | 2 |
| Severity mix | low: 2 |
| Confidence mix | high: 2 |
| Coverage | complete |
| Validation mode | Offline source audit, independent baseline/architecture review, controlled Docker localhost negative tests |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

Локальный дневник задач: React-клиент вызывает относительные /api-маршруты Next.js, сервер аутентифицирует пользователя по сессии и обращается к PostgreSQL через pg.Pool. Основной запуск npm run local:up собирает приложение, запускает PostgreSQL и публикует веб-порт только на127.0.0.1:3000. Поддерживаются npm run dev с собственной PostgreSQL и npm start для standalone. Источники: app/page.tsx:16-21; app/api/\[...path\]/route.ts:1-9; lib/server/db.ts:5-14; package.json:9-18; compose.yaml:25-35; README.md:73. Модель получена независимым architecture reviewer и проверена по фактическим потребителям; тесты описаны отдельно.

### Assets

- Логины и PBKDF2-SHA256 хеши паролей с100000 итераций и отдельной случайной солью: db/schema.sql:1-6; lib/server/security.ts:2-25.
- Сессионная авторизация: случайный32-байтовый токен в cookie crimson_session; SHA256 токена хранится в sessions с истечением14 суток: lib/server/security.ts:3-12,37-48; lib/server/api.ts:81-86,98-111.
- Задачи, владелец, заголовок, заметки, сроки, приоритет и статус: db/schema.sql:17-28.
- История операций и содержимое удаленных задач: before/after audit snapshots; task_id не FK, удаление задачи не удаляет журнал: db/schema.sql:30-42; lib/server/api.ts:175-183,210-216.
- Административные и runtime credentials: .env.docker POSTGRES_PASSWORD и APP_DB_PASSWORD; оба передаются db, лишь runtime secret внутри DATABASE_URL передается app: scripts/setup-local.mjs:9-29; compose.yaml:7-10,28. Значения не читаются/не публикуются.
- Постоянная БД: volume crimson-tasks-local_postgres_data в /var/lib/postgresql/data; down без удаления volume: compose.yaml:1-16,44-45; scripts/local.mjs:6-10,44.
- Владелец схемы отделен от runtime test в Docker; initialization postgres; test без SUPERUSER/CREATEDB/CREATEROLE; ручная миграция через отдельный MIGRATION_DATABASE_URL: compose.yaml:8; scripts/docker-db-init.sh:5-11; scripts/migrate.mjs:4-10.

### Trust Boundaries

- Браузер → HTTP API: JSON и same-origin cookies. Мутации требуют точный loopback Origin с PORT, совпадение Origin.host с Host и отсутствие cross-site Sec-Fetch-Site; body потоково ограничен24000 байт: app/page.tsx:16-21; lib/server/api.ts:23-55,231-242.
- Посетитель → аккаунт/сессия: свободная регистрация, lowercase username и пароль12–128, limiter в БД. Источник aggregate identity непосредственно CF-Connecting-IP либо local-preview; в Compose нет доверенного прокси: lib/server/api.ts:58-78,95-128; compose.yaml:3-42.
- Сессия → чужие задачи/аудит: user.id из JOIN sessions/users; каждый task query и audit фильтруется им; JSON owner не принимается: lib/server/api.ts:81-93,142-145,178-183,189-216,221-228,250-265.
- API → PostgreSQL: Docker runtime test на db:5432/crimson_tasks, параметры pg. Role общая для всех пользователей; RLS нет, tenant isolation принадлежит API. CRUD users/sessions/tasks/auth_rate_limits, SELECT/INSERT audit_events: compose.yaml:28; lib/server/db.ts:8-14,26-33; db/runtime-grants.sql:2-7; db/schema.sql:1-58.
- Runtime → неизменяемый журнал: task mutation и audit одним statement, edit блокирует предыдущую строку; права и trigger запрещают UPDATE/DELETE/TRUNCATE. DB owner доверен и сохраняет schema privileges: lib/server/api.ts:177-216; db/runtime-grants.sql:5-6; db/schema.sql:44-52; README.md:75.
- Хост → credentials/container data: projectRoot/.env.docker создается wx без перезаписи; wrapper удаляет унаследованные одноименные password vars и передает явный env-file. Unix0600, Windows ACL не устанавливается. Docker/host operator доверен: scripts/setup-local.mjs:7-29; scripts/local.mjs:18-22,32-44.
- Host network → container network: host bind127.0.0.1:3000; контейнер app слушает0.0.0.0:3000; db не публикует ports, доступен через db:5432 в Docker network. Другие участники этой сети — отдельная условная поверхность: compose.yaml:3-35; Dockerfile:15-22.
- Manual dev/start: dev hostname127.0.0.1; start запускает .next/standalone/server.js с HOSTNAME127.0.0.1 и остальным окружением родителя. DATABASE_URL произвольный операторский; локальность/роль не проверяется. db:migrate загружает .env.local, применяет только schema.sql через MIGRATION_DATABASE_URL; grants отдельно: package.json:9-14; scripts/start-local.mjs:6-13; lib/server/db.ts:5-14; scripts/migrate.mjs:5-11; README.md:73.
- DB healthcheck использует runtime password через PGPASSWORD и psql внутри db на127.0.0.1:5432; вывод не содержит данных: compose.yaml:18. app pool max10, connect5s, statement10s; runtime UID/GID1001: lib/server/db.ts:8-14; Dockerfile:16-20.
- Integration test client по умолчанию использует127.0.0.1:3000, TEST_BASE_URL определяется оператором и кодом не ограничен; уникальные случайные test accounts и password, test audit сохраняется: tests/api.integration.mjs:5-20; README.md:71.

### Attacker Capabilities

- Локальный непривилегированный HTTP-клиент может регистрироваться, выбирать JSON/headers и работать со своими задачами; исходно нет чужой сессии, .env, Docker socket или DB credentials. Значимый gain — чужие данные/сессии либо нарушение общей доступности.
- Злоумышленный сайт в браузере может пытаться обращаться к локальному сервису; Origin/Host/Fetch Metadata и cookie controls независимы. Серверный HTTP-клиент способен подделывать Origin: это CSRF control, не authentication: lib/server/api.ts:23-31; lib/server/security.ts:46-48.
- Участник той же Docker-сети условно может обратиться к app:3000 и db:5432, но возможность подключить контейнер не предполагается у обычного пользователя: compose.yaml:3-35; Dockerfile:15.
- Host/Docker operator и PostgreSQL owner уже административные субъекты; доступ ими к credentials/volume не является новым gain: README.md:75; compose.yaml:7-16; scripts/docker-db-init.sh:5-11.
- Интернет-доступ не предполагается пользовательским контекстом; требует отсутствующей в исходниках дополнительной публикации/proxy/tunnel.

### Security Objectives

- Пользовательский контекст: приватная передача репозитория, локальная работа без интернет-публикации; свободная регистрация, личные PostgreSQL-задачи, сохранение и аудит.
- Доступ к задачам/аудиту только по действительной сессии и серверному user.id: lib/server/api.ts:81-93,189-228,250-265.
- Пароли и session tokens в БД в виде хешей: lib/server/security.ts:10-25; lib/server/api.ts:98-111.
- CRUD и audit атомарны, runtime не переписывает старый audit: lib/server/api.ts:177-216; db/runtime-grants.sql:5-6; db/schema.sql:44-52.
- Остановка/повторный запуск не сбрасывают БД/пароли; missing env при существующем volume останавливает wrapper: scripts/setup-local.mjs:13-22; scripts/local.mjs:6-10,32-44.
- Credentials исключены из Git/build context, но существуют в runtime environment доверенного Docker: .gitignore:29-32; .dockerignore:11-14; compose.yaml:7-10,28.
- Общий auth limiter должен ограничивать количество попыток и не создавать неограниченное постоянное состояние для отклоненных запросов: lib/server/api.ts:68-78.

### Assumptions

- Независимая architecture review была статической. Родитель аудита проверил source consumers и затем исполнил изолированные localhost negative cases; runtime role/grants подтверждены. История Git, third-party implementations, ignored secret contents исключены.
- README.md:49 «только в .env.docker» неточно описывает runtime: копии паролей присутствуют в environment db/app и PGPASSWORD healthcheck. Это не доказанное раскрытие непривилегированному субъекту: compose.yaml:9-10,18,28.
- README.md:51 и AGENTS.md:6 описывают host loopback; Docker app слушает0.0.0.0 внутри контейнера. Это не интернет-экспозиция: compose.yaml:32; Dockerfile:15.
- Manual mode зависит от оператора: README.md:73 требует локальную PostgreSQL и grants; lib/server/db.ts:5-14 не проверяет адрес/роль. Конкретный manual DSN не инспектировался.
- Первичный build загружает images/npm dependencies, что описано README.md:7 и Dockerfile:1-11; исходящий network не запрещен. Запрет интернет-публикации не расширяется до офлайн-установки.
- Приватность GitHub невозможно доказать исходниками; provider state не является частью security scan. package.json private не управляет GitHub visibility.
- postgres image entrypoint outside authored scope; source uses initdb directory, README.md:73 отмечает initialization only empty volume. Existing DB может иметь иные grants/schema; конкретная тестовая Docker роль проверена.
- Unix0600 обеспечивает код; Windows ACL и безопасность host Docker storage определяет хост: scripts/setup-local.mjs:18-29. Эти варианты не запускались.
- Generated Next standalone implementation не аудировалась; startup script передает DATABASE_URL через родительское окружение: scripts/start-local.mjs:11-13. Непредусмотренные deployment overrides вне проверенного пути.
- Session cookie Secure включается только для HTTPS, штатный local HTTP использует HttpOnly/SameSite=Lax, expiry и hashed tokens: lib/server/security.ts:37-48; lib/server/api.ts:81-86,243-248. Host/browser администраторы доверены.
- Физический engine-managed путь volume исходниками не определен. Контролируемые локальные тесты не читали реальные пользовательские данные и не создавали external exploitation.

## Findings

| Finding | Severity | Confidence | Detailed write-up |
| --- | --- | --- | --- |
| [Подмена CF-Connecting-IP обходит общий лимит входа и регистрации](#finding-1) | low | high | inline below |
| [Отклонённые попытки входа продолжают увеличивать PostgreSQL](#finding-2) | low | high | inline below |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] Подмена CF-Connecting-IP обходит общий лимит входа и регистрации

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | high |
| Confidence rationale | Прямой source trace подтвержден локальным тестом: один клиент и логин возвращают429 для заполненного bucket и401 после изменения только CF-Connecting-IP. |
| Category | Authentication rate-limit bypass |
| CWE | CWE-807 |
| Affected lines | lib/server/api.ts:68-78, lib/server/api.ts:95-97, compose.yaml:31-32 |

#### Summary

Локальный неаутентифицированный HTTP-клиент может менять заголовок CF-Connecting-IP и получать новый счетчик вместо общего ограничения 60 попыток за15 минут. Это допускает password spraying по нескольким логинам и регистрацию сверх лимита; ограничение12 попыток на отдельный логин сохраняется.

#### Root Cause

throttle принимает недоверенный CF header как доверенную идентичность клиента. На локальном Docker endpoint отсутствует прокси, который очищает и устанавливает этот заголовок. SHA256 ключа не исправляет доверие: новое значение дает новую строку auth_rate_limits.

**Both registration and login use the limiter** — `lib/server/api.ts:95-97`

Both public authentication modes call the same limiter before hashing/verifying credentials.

```typescript
async function authenticate(request: Request, register: boolean): Promise<Response> {
  const { username, password } = credentials(await readBody(request));
  await throttle(request, username);
```

**Caller selects cross-account limiter identity** — `lib/server/api.ts:68-70`

CF-Connecting-IP directly controls the IP bucket despite direct localhost deployment without a trusted Cloudflare proxy.

```typescript
async function throttle(request: Request, username: string): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local-preview";
  for (const [key, limit] of [[`auth-user:${username}`, 12], [`auth-ip:${ip}`, 60]] as const) {
```

**Header-derived key indexes durable counter** — `lib/server/api.ts:71-77`

Hashing the attacker-chosen identity preserves its variability; each new value creates an independent counter.

```typescript
    const rows = await query<{ attempts: number }>(`
      INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END
      RETURNING attempts`, [await digest(key)]);
    if (rows[0].attempts > limit) throw new ApiError(429, "Слишком много попыток. Попробуйте через 15 минут.");
```

#### Validation

Контролируемая строка отдельного тестового bucket установлена на60; POST login вернул429. Повтор с тем же логином и паролем, но новым CF-Connecting-IP, вернул401. Это подтверждает прохождение лимитера к проверке пароля. Обе тестовые IP-строки удалены; глобальный счетчик не сбрасывался.

Validation method: static source trace and controlled localhost runtime reproduction

**Caller selects cross-account limiter identity** — `lib/server/api.ts:68-70`

CF-Connecting-IP directly controls the IP bucket despite direct localhost deployment without a trusted Cloudflare proxy.

```typescript
async function throttle(request: Request, username: string): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local-preview";
  for (const [key, limit] of [[`auth-user:${username}`, 12], [`auth-ip:${ip}`, 60]] as const) {
```

**Header-derived key indexes durable counter** — `lib/server/api.ts:71-77`

Hashing the attacker-chosen identity preserves its variability; each new value creates an independent counter.

```typescript
    const rows = await query<{ attempts: number }>(`
      INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END
      RETURNING attempts`, [await digest(key)]);
    if (rows[0].attempts > limit) throw new ApiError(429, "Слишком много попыток. Попробуйте через 15 минут.");
```

**Both registration and login use the limiter** — `lib/server/api.ts:95-97`

Both public authentication modes call the same limiter before hashing/verifying credentials.

```typescript
async function authenticate(request: Request, register: boolean): Promise<Response> {
  const { username, password } = credentials(await readBody(request));
  await throttle(request, username);
```

Assertions:
- Changing only the untrusted header changes the effective aggregate limiter identity.
- Each normalized username still has an independent12-attempt limit.

Limitations:
- Не выполнялся подбор реальных паролей; доступа к чужому аккаунту не получено.
- Контролируемая подготовка counter fixture заменяет60 лишних запросов.

#### Dataflow

HTTP CF-Connecting-IP -\> auth-ip key -\> SHA256 -\> auth_rate_limits key -\> fresh attempts counter -\> authentication proceeds

- **Source:** untrusted request header

- **Sink:** authentication aggregate throttle identity

- **Outcome:** cross-account attempt limit bypass

**Caller selects cross-account limiter identity** — `lib/server/api.ts:68-70`

CF-Connecting-IP directly controls the IP bucket despite direct localhost deployment without a trusted Cloudflare proxy.

```typescript
async function throttle(request: Request, username: string): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local-preview";
  for (const [key, limit] of [[`auth-user:${username}`, 12], [`auth-ip:${ip}`, 60]] as const) {
```

**Header-derived key indexes durable counter** — `lib/server/api.ts:71-77`

Hashing the attacker-chosen identity preserves its variability; each new value creates an independent counter.

```typescript
    const rows = await query<{ attempts: number }>(`
      INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END
      RETURNING attempts`, [await digest(key)]);
    if (rows[0].attempts > limit) throw new ApiError(429, "Слишком много попыток. Попробуйте через 15 минут.");
```

#### Reachability

Достаточно локального доступа к127.0.0.1:3000 и возможности отправить HTTP headers; аккаунт, БД и Docker права не нужны. Browser cross-site attacks remain constrained by CSRF.

- **Attacker:** unauthenticated local HTTP client

- **Entry point:** POST /api/auth/login and /api/auth/register

- **Outcome:** new aggregate quota for each forged CF header

#### Severity

**Low** — Эксплуатация требует доступа к локальному HTTP-порту. Меняется ограничение количества попыток, но не парольная проверка и не лимит на конкретный логин. Интернет-экспозиция отсутствует по конфигурации.

Публикация сервиса в сети или отмена per-user лимита увеличит риск.

Impact assessment:
- **Level:** low
- **Why:** Больше попыток входа по разным логинам и регистраций; не обход пароля и не прямой доступ к задачам.

Likelihood assessment:
- **Level:** low
- **Why:** Сервис привязан к loopback; требуется локальный недоверенный клиент.

#### Remediation

Для локального режима используйте серверный общий ключ, который не зависит от HTTP proxy headers; сохраните отдельный лимит по нормализованному логину. При будущем proxy deployment разрешайте IP headers только от проверенного proxy.

Tests:
- Заполнить общий локальный bucket, затем менять CF-Connecting-IP, X-Forwarded-For и X-Real-IP; каждый запрос должен оставаться429.
- Проверить, что12-attempt per-user cap сохраняется независимо от заголовков.

Preventive controls:
- Явно связать выбор client identity с доверенной deployment конфигурацией; не наследовать Cloudflare assumptions в Node localhost режиме.

<a id="finding-2"></a>

### [2] Отклонённые попытки входа продолжают увеличивать PostgreSQL

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | high |
| Confidence rationale | Три локальные отклоненные попытки дали429 и увеличили число отдельных username-строк0→3; исходники подтверждают отсутствие cleanup и persistent table. |
| Category | Persistent resource exhaustion |
| CWE | CWE-770 |
| Affected lines | lib/server/api.ts:68-78, lib/server/api.ts:95-97, db/schema.sql:54-58 |

#### Summary

Неаутентифицированный локальный клиент отправляет попытки входа с новыми допустимыми логинами после исчерпания общего лимита. Каждый ответ429 оставляет новую постоянную строку auth_rate_limits, поскольку пользовательский счетчик записывается раньше общей проверки. Устаревшие ключи не удаляются.

#### Root Cause

authenticate вызывает throttle до проверки аккаунта. Цикл сначала сохраняет ключ auth-user:username отдельным pg query, затем проверяет общий бюджет. Поэтому HTTP429 не отменяет первую запись. Новые имена создают новые строки независимо от исчерпанного бюджета; timestamp не удаляет строки.

**Both registration and login use the limiter** — `lib/server/api.ts:95-97`

Both public authentication modes call the same limiter before hashing/verifying credentials.

```typescript
async function authenticate(request: Request, register: boolean): Promise<Response> {
  const { username, password } = credentials(await readBody(request));
  await throttle(request, username);
```

**Per-username writes occur before global rejection** — `lib/server/api.ts:68-70`

The first loop key is attacker-selected normalized username. Its SQL insertion commits before the second cross-account counter is checked.

```typescript
async function throttle(request: Request, username: string): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local-preview";
  for (const [key, limit] of [[`auth-user:${username}`, 12], [`auth-ip:${ip}`, 60]] as const) {
```

**Each standalone INSERT commits before429** — `lib/server/api.ts:71-77`

Each query executes independently and returns before the rejection. Thus the first username row persists even if the subsequent aggregate check throws429.

```typescript
    const rows = await query<{ attempts: number }>(`
      INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END
      RETURNING attempts`, [await digest(key)]);
    if (rows[0].attempts > limit) throw new ApiError(429, "Слишком много попыток. Попробуйте через 15 минут.");
```

**Persistent limiter rows have no automatic expiry** — `db/schema.sql:54-58`

window_start controls reset on reuse of the same key; the authored source contains no deletion/retention limit for unique expired keys.

```sql
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key char(64) PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT clock_timestamp()
);
```

#### Validation

Предварительно заполнен отдельный aggregate bucket. Три POST login с разными несуществующими допустимыми именами вернули429/429/429. Число соответствующих username rows выросло с0 до3. Тестовые4 limiter rows удалены, пользовательские данные и глобальный limiter не затронуты.

Validation method: independent baseline source review, parent source validation and controlled localhost fixture

**Both registration and login use the limiter** — `lib/server/api.ts:95-97`

Both public authentication modes call the same limiter before hashing/verifying credentials.

```typescript
async function authenticate(request: Request, register: boolean): Promise<Response> {
  const { username, password } = credentials(await readBody(request));
  await throttle(request, username);
```

**Per-username writes occur before global rejection** — `lib/server/api.ts:68-70`

The first loop key is attacker-selected normalized username. Its SQL insertion commits before the second cross-account counter is checked.

```typescript
async function throttle(request: Request, username: string): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local-preview";
  for (const [key, limit] of [[`auth-user:${username}`, 12], [`auth-ip:${ip}`, 60]] as const) {
```

**Each standalone INSERT commits before429** — `lib/server/api.ts:71-77`

Each query executes independently and returns before the rejection. Thus the first username row persists even if the subsequent aggregate check throws429.

```typescript
    const rows = await query<{ attempts: number }>(`
      INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END
      RETURNING attempts`, [await digest(key)]);
    if (rows[0].attempts > limit) throw new ApiError(429, "Слишком много попыток. Попробуйте через 15 минут.");
```

**Persistent limiter rows have no automatic expiry** — `db/schema.sql:54-58`

window_start controls reset on reuse of the same key; the authored source contains no deletion/retention limit for unique expired keys.

```sql
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key char(64) PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT clock_timestamp()
);
```

Assertions:
- Rejected login creates durable per-user state before aggregate gate.
- No authored cleanup path deletes expired auth_rate_limits rows.

Limitations:
- Заполнение volume и отказ сервиса не воспроизводились: установлено линейное постоянное накопление, последующий storage exhaustion является следствием при достаточном числе запросов.

#### Dataflow

username JSON -\> normalized credentials -\> first throttle INSERT -\> PostgreSQL commit -\> second throttle check429 -\> username row remains

- **Source:** valid new username supplied by anonymous client

- **Sink:** auth_rate_limits persistent table

- **Outcome:** unbounded accumulation of rows even for rejected authentication attempts

**Both registration and login use the limiter** — `lib/server/api.ts:95-97`

Both public authentication modes call the same limiter before hashing/verifying credentials.

```typescript
async function authenticate(request: Request, register: boolean): Promise<Response> {
  const { username, password } = credentials(await readBody(request));
  await throttle(request, username);
```

**Per-username writes occur before global rejection** — `lib/server/api.ts:68-70`

The first loop key is attacker-selected normalized username. Its SQL insertion commits before the second cross-account counter is checked.

```typescript
async function throttle(request: Request, username: string): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local-preview";
  for (const [key, limit] of [[`auth-user:${username}`, 12], [`auth-ip:${ip}`, 60]] as const) {
```

**Each standalone INSERT commits before429** — `lib/server/api.ts:71-77`

Each query executes independently and returns before the rejection. Thus the first username row persists even if the subsequent aggregate check throws429.

```typescript
    const rows = await query<{ attempts: number }>(`
      INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END
      RETURNING attempts`, [await digest(key)]);
    if (rows[0].attempts > limit) throw new ApiError(429, "Слишком много попыток. Попробуйте через 15 минут.");
```

**Persistent limiter rows have no automatic expiry** — `db/schema.sql:54-58`

window_start controls reset on reuse of the same key; the authored source contains no deletion/retention limit for unique expired keys.

```sql
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key char(64) PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT clock_timestamp()
);
```

#### Reachability

Требуется доступ к локальному API и корректные синтаксически username/password/loopback headers. Учетная запись, знание пароля и права на БД не требуются. Эта причина остается даже если spoofing CF header отдельно устранен.

- **Attacker:** unauthenticated local HTTP client

- **Entry point:** POST /api/auth/login and /api/auth/register

- **Outcome:** persistent resource consumption despite request rejection

#### Severity

**Low** — Долговременная атака расходует PostgreSQL storage и может нарушить доступность всего экземпляра. Требуется локальный HTTP-доступ и большое число запросов; заполнение диска не выполнялось.

Сетевая публикация, небольшой storage quota или доказанный быстрый отказ повысили бы риск; ограниченная очистка и отсутствие записи для отклоненных запросов устраняют его.

Impact assessment:
- **Level:** low
- **Why:** Общий PostgreSQL volume может быть исчерпан длительным потоком; реальные задачи не раскрываются и не изменяются.

Likelihood assessment:
- **Level:** low
- **Why:** Локальная поверхность, фиксированно небольшая строка, требуется длительный объем запросов.

#### Remediation

Проверяйте серверный общий бюджет до записи ключа нового логина; отклоненный общим ограничителем запрос не должен создавать пользовательское состояние. Добавьте ограниченное хранение/очистку устаревших limiter keys без сброса активных ограничений.

Tests:
- С исчерпанным общим budget отправить3 новых имени: все429, число новых username-строк остается0.
- Проверить удаление устаревших ключей и сохранение активного per-user budget при cleanup.

Preventive controls:
- Не создавайте постоянное attacker-controlled состояние до resource admission gate.
- Задайте ограничение жизненного цикла ephemeral auth counters.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Authentication limiter: header identity and persistent rejected-request state | Authentication / resource exhaustion | Reported | C1 and C2 validated independently and on Docker localhost. C1: changing only CF-Connecting-IP changes429→401. C2: three429 responses create3 permanent username rows. Source lib/server/api.ts:68-78,95-97; db/schema.sql:54-58. Separate root controls/remediations; both local-only low. |
| Docker local exposure and credential lifecycle | Deployment / secrets / privileges | No issue found | compose.yaml:31-32 binds only host127.0.0.1, DB has no published port; Dockerfile:16-20 nonroot app; scripts/setup-local.mjs:13-29 wx+Unix0600. .env ignored by Git/build. Runtime role test lacks audit UPDATE/DELETE/TRUNCATE, schema CREATE and superuser. Host/Docker operators trusted; manual DSN, Windows ACL and internal container network boundaries explicit in model. README 'only in env file' omits trusted runtime environment copies, not a lower-privilege disclosure. |
| Independent baseline and complete current-source coverage | Full repository source coverage | Reported | Independent baseline fully audited29 initial distributable files; parent fully read newly added .gitattributes for total30, and independently traced all security-sensitive runtime consumers. Baseline C1 merged with same control; baseline C2 validated. Architecture mapping was not counted as source audit coverage. Build/dependency code explicitly excluded. |
| Passwords, cookies and session lifecycle | Authentication / session hijacking | No issue found | lib/server/security.ts:2-48 salted PBKDF2 and random32byte tokens; token SHA256 and expiry verified lib/server/api.ts:81-86; password/login result excludes hashes. Runtime forged token401 and revoked session401. Cookie HttpOnly/SameSite=Lax; local HTTP Secure condition documented. No account takeover demonstrated. |
| Per-user ownership and SQL values | IDOR / SQL injection | No issue found | lib/server/api.ts:178-228,250-265 restricts CRUD/list/audit by server-session user.id; allowed body fields reject owner mass assignment. lib/server/db.ts:26-33 uses parameterized pg.query. Runtime second user GET/PATCH/DELETE404, list empty; SQL-like title literal, audit cursor injection400. Dynamic SQL fragments only internal constant aliases. |
| Task changes, concurrent snapshots and immutable audit | Integrity / audit | No issue found | lib/server/api.ts:177-216 CTE mutation+audit in same statement; previous row FOR UPDATE makes before snapshot serial. db/runtime-grants.sql:5-6 and db/schema.sql:44-52 deny audit modifications. Runtime grant check confirms denial. Audit GET scoped to user and paged51; task deletion retains history. |
| Origin/Host and JSON/body boundary | CSRF / parsing / mass assignment | No issue found | lib/server/api.ts:23-55 exact two loopback origins, matching Host and cross-site rejection; JSON24000byte streamed limit. Runtime foreign/opaque/mismatched-loopback origins and cross-site403; malformed/array/prototype400, oversize413, plain content415. GET paths have no writes and no permissive CORS response. |
| Client task/audit rendering and static assets | XSS / client secrets | No issue found | app/page.tsx renders title/description/audit through React JSX, not dangerous HTML sinks; fixed API paths and encoded cursor. No external script/URL sink receives task content; favicon static SVG, CSS static. API literal payload persisted without interpretation. DOM execution not tested separately. |
| Local scripts and migrations | Command injection / privilege boundaries / persistence | No issue found | scripts/local.mjs static subcommand map and spawnSync argument arrays no shell; projectRoot anchored to script; explicit compose/env file. setup-local refuses overwrites, wrapper refuses new secret on existing volume; down omits-v. scripts/migrate.mjs uses operator-only MIGRATION_DATABASE_URL and rollback, logs code/name not credentials. Manual role creation/grants remains documented operator step. |
| Embedded credentials and dependency manifests | Secret disclosure / dependency metadata | No issue found | All authored configuration/docs/tests/examples reviewed; no credential literals granting access established. .env.example blank; test secrets random at execution; runtime secrets local excluded. Lockfile124 package entries use registry.npmjs.org with integrity; no active vulnerability-database assurance claimed. Limited ignored old metadata also checked for secrets, not full old framework audit. |
| Uploads, SSRF, filesystem path and code execution endpoints | SSRF / traversal / code injection / unsafe deserialization | Not applicable | Current API only credentials/tasks/audit; no user-supplied URL fetch, file upload/read/write, command execution or unsafe deserializer. JSON.parse outputs constrained task fields; startup filesystem/network configuration controlled by trusted operator. |

## Open Questions And Follow Up

- Для заявлений о Windows ACL или ручной БД нужен отдельный запуск соответствующей конфигурации; текущие Docker-source результаты не доказывают эти deployment assumptions.
- Независимая проверка актуальных dependency advisories/образов не выполнялась; отсутствие известных CVE не утверждается.
