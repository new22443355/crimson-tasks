import { DatabaseError, query, transaction } from "./db";
import { digest, hashPassword, randomToken, sessionCookie, sessionToken, SESSION_AGE, verifyPassword } from "./security";

type User = { id: string; username: string };
type UserCredentials = User & { password_hash: string };
type Task = {
  id: string; title: string; description: string; priority: "low" | "normal" | "high";
  dueDate: string | null; completed: boolean; cancelled: boolean; createdAt: string; updatedAt: string;
};
type TaskInput = Pick<Task, "title" | "description" | "priority" | "dueDate" | "completed" | "cancelled">;
type AuditEvent = { id: string; action: string; taskId: string | null; taskTitle: string | null; createdAt: string; details: unknown };

class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const response = Response.json(data, { status, headers });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const port = process.env.PORT ?? "3000";
  const localOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  if (!origin || !localOrigins.includes(origin)
    || new URL(origin).host !== request.headers.get("host")
    || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "Запрос с другого сайта запрещён.");
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new ApiError(415, "Ожидается запрос в формате JSON.");
  }
  if (Number(request.headers.get("content-length")) > 24_000) throw new ApiError(413, "Запрос слишком большой.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Пустой запрос.");
  const decoder = new TextDecoder();
  let text = "";
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 24_000) { await reader.cancel(); throw new ApiError(413, "Запрос слишком большой."); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new ApiError(400, "Некорректный JSON."); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(400, "Некорректный запрос.");
  return data as Record<string, unknown>;
}

function credentials(body: Record<string, unknown>, register: boolean): { username: string; password: string } {
  const usernamePattern = register ? /^[a-zA-Z0-9_.-]{4,32}$/ : /^[a-zA-Z0-9_.-]{3,32}$/;
  if (typeof body.username !== "string" || !usernamePattern.test(body.username)) {
    throw new ApiError(400, `Логин: ${register ? 4 : 3}–32 символа, латинские буквы, цифры, точка, дефис или подчёркивание.`);
  }
  if (typeof body.password !== "string" || body.password.length < 4 || body.password.length > 128) {
    throw new ApiError(400, "Пароль должен содержать от 4 до 128 символов.");
  }
  return { username: body.username.toLowerCase(), password: body.password };
}

async function throttle(username: string): Promise<void> {
  await query(`DELETE FROM auth_rate_limits WHERE key IN (
    SELECT key FROM auth_rate_limits WHERE window_start < now() - interval '15 minutes'
    ORDER BY window_start LIMIT 100
  ) AND window_start < now() - interval '15 minutes'`);
  for (const [key, limit] of [["auth-instance:local", 60], [`auth-user:${username}`, 12]] as const) {
    const rows = await query<{ attempts: number }>(`
      INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE LEAST(auth_rate_limits.attempts, $2) + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END
      RETURNING attempts`, [await digest(key), limit]);
    if (rows[0].attempts > limit) throw new ApiError(429, "Слишком много попыток. Попробуйте через 15 минут.");
  }
}

async function currentUser(request: Request): Promise<User | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const rows = await query<User>(`SELECT u.id::text, u.username FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()`, [await digest(token)]);
  return rows[0] ?? null;
}

async function requireUser(request: Request): Promise<User> {
  const user = await currentUser(request);
  if (!user) throw new ApiError(401, "Войдите в аккаунт.");
  return user;
}

async function authenticate(request: Request, register: boolean): Promise<Response> {
  const { username, password } = credentials(await readBody(request), register);
  await throttle(username);
  const token = randomToken();
  const tokenHash = await digest(token);
  const expires = new Date(Date.now() + SESSION_AGE * 1000).toISOString();
  let user: User;
  if (register) {
    const id = crypto.randomUUID();
    try {
      const rows = await query<User>(`WITH created AS (
        INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) RETURNING id, username
      ), session AS (
        INSERT INTO sessions (token_hash, user_id, expires_at) SELECT $4, id, $5::timestamptz FROM created
      ), event AS (
        INSERT INTO audit_events (user_id, action) SELECT id, 'user.registered' FROM created
      ) SELECT id::text, username FROM created`, [id, username, await hashPassword(password), tokenHash, expires]);
      user = rows[0];
    } catch (error) {
      if (error instanceof DatabaseError && error.code === "23505") throw new ApiError(409, "Этот логин уже занят.");
      throw error;
    }
  } else {
    const rows = await query<UserCredentials>("SELECT id::text, username, password_hash FROM users WHERE username = $1", [username]);
    const found = rows[0];
    const dummy = `pbkdf2_sha256$100000$00000000000000000000000000000000$${"0".repeat(64)}`;
    const valid = await verifyPassword(password, found?.password_hash ?? dummy);
    if (!found || !valid) throw new ApiError(401, "Неверный логин или пароль.");
    user = await transaction(async tx => {
      const [locked] = await tx<UserCredentials>("SELECT id::text, username, password_hash FROM users WHERE id = $1 FOR UPDATE", [found.id]);
      if (!locked || locked.password_hash !== found.password_hash || locked.username !== username) throw new ApiError(401, "Неверный логин или пароль.");
      await tx("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3::timestamptz)", [tokenHash, locked.id, expires]);
      await tx("INSERT INTO audit_events (user_id, action) VALUES ($1, 'user.logged_in')", [locked.id]);
      return { id: locked.id, username: locked.username };
    });
  }
  return json({ user }, register ? 201 : 200, { "Set-Cookie": sessionCookie(request, token) });
}

function accountPassword(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length < 4 || value.length > 128) {
    throw new ApiError(400, `${field === "currentPassword" ? "Текущий" : "Новый"} пароль должен содержать от 4 до 128 символов.`);
  }
  return value;
}

async function accountCredentials(user: User, password: string): Promise<UserCredentials> {
  await throttle(`account:${user.id}`);
  const [found] = await query<UserCredentials>("SELECT id::text, username, password_hash FROM users WHERE id = $1", [user.id]);
  if (!found) throw new ApiError(401, "Войдите в аккаунт.");
  if (!await verifyPassword(password, found.password_hash)) throw new ApiError(400, "Текущий пароль неверен.");
  return found;
}

async function lockedAccount(tx: typeof query, verified: UserCredentials, tokenHash: string): Promise<UserCredentials> {
  const [locked] = await tx<UserCredentials>("SELECT id::text, username, password_hash FROM users WHERE id = $1 FOR UPDATE", [verified.id]);
  const sessions = await tx<{ token_hash: string }>("SELECT token_hash FROM sessions WHERE token_hash = $1 AND user_id = $2 AND expires_at > clock_timestamp()", [tokenHash, verified.id]);
  if (!locked || !sessions.length) throw new ApiError(401, "Войдите в аккаунт.");
  if (locked.password_hash !== verified.password_hash) throw new ApiError(409, "Данные аккаунта уже изменились. Повторите действие с текущим паролем.");
  return locked;
}

async function updateAccount(request: Request, user: User, change: "username" | "password"): Promise<Response> {
  const body = await readBody(request);
  const allowed = new Set(["currentPassword", change === "username" ? "username" : "newPassword"]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new ApiError(400, "Запрос содержит неизвестные поля.");
  const currentPassword = accountPassword(body, "currentPassword");
  const username = change === "username" ? body.username : null;
  if (change === "username" && (typeof username !== "string" || !/^[a-zA-Z0-9_.-]{4,32}$/.test(username))) {
    throw new ApiError(400, "Логин: 4–32 символа, латинские буквы, цифры, точка, дефис или подчёркивание.");
  }
  const newPassword = change === "password" ? accountPassword(body, "newPassword") : null;
  const verified = await accountCredentials(user, currentPassword);
  const token = sessionToken(request);
  if (!token) throw new ApiError(401, "Войдите в аккаунт.");
  const tokenHash = await digest(token);
  const newHash = newPassword === null ? null : await hashPassword(newPassword);
  try {
    const updated = await transaction(async tx => {
      const locked = await lockedAccount(tx, verified, tokenHash);
      if (change === "username") {
        const normalized = (username as string).toLowerCase();
        if (locked.username === normalized) return { id: locked.id, username: locked.username };
        const [changed] = await tx<User>("UPDATE users SET username = $2 WHERE id = $1 AND password_hash = $3 RETURNING id::text, username", [locked.id, normalized, verified.password_hash]);
        if (!changed) throw new ApiError(409, "Данные аккаунта уже изменились. Повторите действие.");
        await tx(`INSERT INTO audit_events (user_id, action, details) VALUES ($1, 'user.username_changed',
          jsonb_build_object('before', jsonb_build_object('username', $2::text), 'after', jsonb_build_object('username', $3::text)))`, [locked.id, locked.username, normalized]);
        return changed;
      }
      const changed = await tx<{ id: string }>("UPDATE users SET password_hash = $2 WHERE id = $1 AND password_hash = $3 RETURNING id::text", [locked.id, newHash, verified.password_hash]);
      if (!changed.length) throw new ApiError(409, "Данные аккаунта уже изменились. Повторите действие.");
      await tx("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [locked.id, tokenHash]);
      await tx("INSERT INTO audit_events (user_id, action) VALUES ($1, 'user.password_changed')", [locked.id]);
      return null;
    });
    return json(change === "username" ? { user: updated } : { ok: true });
  } catch (error) {
    if (error instanceof DatabaseError && error.code === "23505") throw new ApiError(409, "Этот логин уже занят.");
    throw error;
  }
}

function taskColumns(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `${p}id::text, ${p}title, ${p}description, ${p}priority, to_char(${p}due_date, 'YYYY-MM-DD') AS "dueDate", ${p}completed, ${p}cancelled,
    ${p}created_at AS "createdAt", ${p}updated_at AS "updatedAt"`;
}

function snapshot(alias: string): string {
  return `jsonb_build_object('title', ${alias}.title, 'description', ${alias}.description, 'priority', ${alias}.priority,
    'dueDate', to_char(${alias}.due_date, 'YYYY-MM-DD'), 'completed', ${alias}.completed, 'cancelled', ${alias}.cancelled)`;
}

function taskInput(body: Record<string, unknown>, partial = false): Partial<TaskInput> {
  const allowed = new Set(["title", "description", "priority", "dueDate", ...(partial ? ["completed", "cancelled"] : [])]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new ApiError(400, "Запрос содержит неизвестные поля.");
  if (!partial && !("title" in body)) throw new ApiError(400, "Введите название задачи.");
  if (partial && !Object.keys(body).length) throw new ApiError(400, "Нет изменений для сохранения.");
  const result: Partial<TaskInput> = {};
  if ("title" in body) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 200) throw new ApiError(400, "Название: от 1 до 200 символов.");
    result.title = body.title.trim();
  }
  if ("description" in body) {
    if (typeof body.description !== "string" || body.description.length > 5000) throw new ApiError(400, "Описание: не более 5000 символов.");
    result.description = body.description.trim();
  }
  if ("priority" in body) {
    if (body.priority !== "low" && body.priority !== "normal" && body.priority !== "high") throw new ApiError(400, "Некорректный приоритет.");
    result.priority = body.priority;
  }
  if ("dueDate" in body) {
    if (body.dueDate !== null) {
      if (typeof body.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) throw new ApiError(400, "Некорректная дата.");
      const date = new Date(`${body.dueDate}T12:00:00Z`);
      if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== body.dueDate || body.dueDate < "0001-01-01") throw new ApiError(400, "Некорректная дата.");
    }
    result.dueDate = body.dueDate as string | null;
  }
  if ("completed" in body) {
    if (typeof body.completed !== "boolean") throw new ApiError(400, "Некорректный статус задачи.");
    result.completed = body.completed;
  }
  if ("cancelled" in body) {
    if (typeof body.cancelled !== "boolean") throw new ApiError(400, "Некорректный статус задачи.");
    result.cancelled = body.cancelled;
  }
  if (result.completed && result.cancelled) throw new ApiError(400, "Задача не может быть одновременно выполнена и отменена.");
  if (result.completed) result.cancelled = false;
  if (result.cancelled) result.completed = false;
  return result;
}

async function createTask(request: Request, user: User): Promise<Response> {
  const input = taskInput(await readBody(request));
  const rows = await query<Task>(`WITH created AS (
    INSERT INTO tasks (id, user_id, title, description, priority, due_date)
    VALUES ($1, $2, $3, $4, $5, $6::date) RETURNING *
  ), event AS (
    INSERT INTO audit_events (user_id, action, task_id, task_title, details)
    SELECT user_id, 'task.created', id, title, jsonb_build_object('after', ${snapshot("created")}) FROM created
  ) SELECT ${taskColumns()} FROM created`, [crypto.randomUUID(), user.id, input.title, input.description ?? "", input.priority ?? "normal", input.dueDate ?? null]);
  return json({ task: rows[0] }, 201);
}

async function updateTask(request: Request, user: User, id: string): Promise<Response> {
  const input = taskInput(await readBody(request), true);
  const rows = await query<Task>(`WITH previous AS MATERIALIZED (
    SELECT * FROM tasks WHERE id = $1 AND user_id = $2 FOR UPDATE
  ), changed AS (
    UPDATE tasks t SET title = COALESCE($3, p.title), description = COALESCE($4, p.description),
      priority = COALESCE($5, p.priority), due_date = CASE WHEN $6::boolean THEN $7::date ELSE p.due_date END,
      completed = COALESCE($8::boolean, p.completed), cancelled = COALESCE($9::boolean, p.cancelled), updated_at = clock_timestamp()
    FROM previous p WHERE t.id = p.id AND (
      ($3::text IS NOT NULL AND $3 IS DISTINCT FROM p.title) OR ($4::text IS NOT NULL AND $4 IS DISTINCT FROM p.description) OR
      ($5::text IS NOT NULL AND $5 IS DISTINCT FROM p.priority) OR ($6::boolean AND $7::date IS DISTINCT FROM p.due_date) OR
      ($8::boolean IS NOT NULL AND $8 IS DISTINCT FROM p.completed) OR ($9::boolean IS NOT NULL AND $9 IS DISTINCT FROM p.cancelled)
    ) RETURNING t.*, ${snapshot("p")} AS before, p.completed AS was_completed, p.cancelled AS was_cancelled
  ), event AS (
    INSERT INTO audit_events (user_id, action, task_id, task_title, details)
    SELECT user_id, CASE WHEN completed IS DISTINCT FROM was_completed OR cancelled IS DISTINCT FROM was_cancelled
      THEN CASE WHEN cancelled THEN 'task.cancelled' WHEN completed THEN 'task.completed' ELSE 'task.reopened' END ELSE 'task.updated' END,
      id, title, jsonb_build_object('before', before, 'after', ${snapshot("changed")}) FROM changed
  ) SELECT ${taskColumns()} FROM changed`, [id, user.id, input.title ?? null, input.description ?? null, input.priority ?? null, "dueDate" in input, input.dueDate ?? null, input.completed ?? null, input.cancelled ?? null]);
  const task = rows[0] ?? (await query<Task>(`SELECT ${taskColumns()} FROM tasks WHERE id = $1 AND user_id = $2`, [id, user.id]))[0];
  if (!task) throw new ApiError(404, "Задача не найдена.");
  return json({ task });
}

async function deleteTask(user: User, id: string): Promise<Response> {
  const rows = await query<{ id: string }>(`WITH removed AS (
    DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING *
  ), event AS (
    INSERT INTO audit_events (user_id, action, task_id, task_title, details)
    SELECT user_id, 'task.deleted', id, title, jsonb_build_object('before', ${snapshot("removed")}) FROM removed
  ) SELECT id::text FROM removed`, [id, user.id]);
  if (!rows.length) throw new ApiError(404, "Задача не найдена.");
  return json({ ok: true });
}

const auditActions = new Set([
  "user.registered", "user.logged_in", "user.logged_out",
  "user.username_changed", "user.password_changed",
  "task.created", "task.updated", "task.completed", "task.cancelled", "task.reopened", "task.deleted",
]);

function auditDateBound(value: string | null): string | null {
  if (value === null) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/);
  const date = new Date(value);
  const normalized = match ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z` : "";
  if (!match || value.startsWith("0000") || Number.isNaN(date.valueOf()) || date.toISOString() !== normalized) {
    throw new ApiError(400, "Некорректная дата фильтра истории.");
  }
  return normalized;
}

async function audit(user: User, url: URL): Promise<Response> {
  const before = url.searchParams.get("before");
  if (before && (!/^\d{1,18}$/.test(before) || BigInt(before) <= BigInt(0))) throw new ApiError(400, "Некорректный указатель истории.");
  const action = url.searchParams.get("action");
  if (action !== null && !auditActions.has(action)) throw new ApiError(400, "Некорректное действие в фильтре истории.");
  const from = auditDateBound(url.searchParams.get("from"));
  const to = auditDateBound(url.searchParams.get("to"));
  if (from && to && from >= to) throw new ApiError(400, "Начало периода должно быть раньше его окончания.");
  const rows = await query<AuditEvent>(`SELECT id::text, action, task_id::text AS "taskId", task_title AS "taskTitle",
    created_at AS "createdAt", details FROM audit_events WHERE user_id = $1 AND ($2::bigint IS NULL OR id < $2::bigint)
      AND ($3::text IS NULL OR action = $3)
      AND ($4::timestamptz IS NULL OR created_at >= $4::timestamptz)
      AND ($5::timestamptz IS NULL OR created_at < $5::timestamptz)
    ORDER BY audit_events.id DESC LIMIT 51`, [user.id, before ?? null, action, from, to]);
  const events = rows.slice(0, 50);
  return json({ events, nextCursor: rows.length > 50 ? events[49].id : null });
}

export async function handleApi(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    if (!["GET", "HEAD"].includes(request.method)) assertSameOrigin(request);
    if (path === "/api/health" && request.method === "GET") {
      await query("SELECT 1 AS ready");
      return json({ ok: true, database: "postgresql" });
    }
    if (path === "/api/session" && request.method === "GET") return json({ user: await currentUser(request) });
    if (path === "/api/auth/register" && request.method === "POST") return await authenticate(request, true);
    if (path === "/api/auth/login" && request.method === "POST") return await authenticate(request, false);
    if (path === "/api/auth/logout" && request.method === "POST") {
      const token = sessionToken(request);
      if (token) await query(`WITH removed AS (
        DELETE FROM sessions WHERE token_hash = $1 RETURNING user_id, expires_at
      ) INSERT INTO audit_events (user_id, action) SELECT user_id, 'user.logged_out' FROM removed WHERE expires_at > now()`, [await digest(token)]);
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, "", true) });
    }
    const user = await requireUser(request);
    if (path === "/api/account/username" && request.method === "PATCH") return await updateAccount(request, user, "username");
    if (path === "/api/account/password" && request.method === "PATCH") return await updateAccount(request, user, "password");
    if (path === "/api/tasks" && request.method === "GET") {
      return json({ tasks: await query<Task>(`SELECT ${taskColumns()} FROM tasks WHERE user_id = $1 ORDER BY created_at DESC, id DESC`, [user.id]) });
    }
    if (path === "/api/tasks" && request.method === "POST") return await createTask(request, user);
    if (path === "/api/audit" && request.method === "GET") return await audit(user, url);
    const match = path.match(/^\/api\/tasks\/([a-f0-9-]{36})$/i);
    if (match) {
      const id = match[1];
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new ApiError(404, "Задача не найдена.");
      if (request.method === "PATCH") return await updateTask(request, user, id);
      if (request.method === "DELETE") return await deleteTask(user, id);
      if (request.method === "GET") {
        const task = (await query<Task>(`SELECT ${taskColumns()} FROM tasks WHERE id = $1 AND user_id = $2`, [id, user.id]))[0];
        if (!task) throw new ApiError(404, "Задача не найдена.");
        return json({ task });
      }
    }
    throw new ApiError(404, "Страница не найдена.");
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    if (error instanceof DatabaseError && error.code === "NOT_CONFIGURED") return json({ error: "База данных ещё не подключена. Попробуйте позднее." }, 503);
    console.error("API request failed", { type: error instanceof Error ? error.name : "UnknownError", code: error instanceof DatabaseError ? error.code : undefined });
    return json({ error: "Не удалось выполнить запрос. Повторите попытку." }, 500);
  }
}
