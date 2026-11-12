import { DatabaseError, query } from "./db";
import { digest, hashPassword, randomToken, sessionCookie, sessionToken, SESSION_AGE, verifyPassword } from "./security";

type User = { id: string; username: string };
type Task = {
  id: string; title: string; description: string; priority: "low" | "normal" | "high";
  dueDate: string | null; completed: boolean; createdAt: string; updatedAt: string;
};
type TaskInput = Pick<Task, "title" | "description" | "priority" | "dueDate" | "completed">;
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
  if (origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
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

function credentials(body: Record<string, unknown>): { username: string; password: string } {
  if (typeof body.username !== "string" || !/^[a-zA-Z0-9_.-]{3,32}$/.test(body.username)) {
    throw new ApiError(400, "Логин: 3–32 символа, латинские буквы, цифры, точка, дефис или подчёркивание.");
  }
  if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) {
    throw new ApiError(400, "Пароль должен содержать от 12 до 128 символов.");
  }
  return { username: body.username.toLowerCase(), password: body.password };
}

async function throttle(request: Request, username: string): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local-preview";
  for (const [key, limit] of [[`auth-user:${username}`, 12], [`auth-ip:${ip}`, 60]] as const) {
    const rows = await query<{ attempts: number }>(`
      INSERT INTO auth_rate_limits (key, attempts, window_start) VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start < now() - interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END
      RETURNING attempts`, [await digest(key)]);
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
  const { username, password } = credentials(await readBody(request));
  await throttle(request, username);
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
    const rows = await query<User & { password_hash: string }>("SELECT id::text, username, password_hash FROM users WHERE username = $1", [username]);
    const found = rows[0];
    const dummy = `pbkdf2_sha256$100000$00000000000000000000000000000000$${"0".repeat(64)}`;
    const valid = await verifyPassword(password, found?.password_hash ?? dummy);
    if (!found || !valid) throw new ApiError(401, "Неверный логин или пароль.");
    user = { id: found.id, username: found.username };
    await query(`WITH created AS (
      INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3::timestamptz) RETURNING user_id
    ) INSERT INTO audit_events (user_id, action) SELECT user_id, 'user.logged_in' FROM created`, [tokenHash, user.id, expires]);
  }
  return json({ user }, register ? 201 : 200, { "Set-Cookie": sessionCookie(request, token) });
}

function taskColumns(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `${p}id::text, ${p}title, ${p}description, ${p}priority, to_char(${p}due_date, 'YYYY-MM-DD') AS "dueDate", ${p}completed,
    ${p}created_at AS "createdAt", ${p}updated_at AS "updatedAt"`;
}

function snapshot(alias: string): string {
  return `jsonb_build_object('title', ${alias}.title, 'description', ${alias}.description, 'priority', ${alias}.priority,
    'dueDate', to_char(${alias}.due_date, 'YYYY-MM-DD'), 'completed', ${alias}.completed)`;
}

function taskInput(body: Record<string, unknown>, partial = false): Partial<TaskInput> {
  const allowed = new Set(["title", "description", "priority", "dueDate", ...(partial ? ["completed"] : [])]);
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
      completed = COALESCE($8::boolean, p.completed), updated_at = clock_timestamp()
    FROM previous p WHERE t.id = p.id AND (
      ($3::text IS NOT NULL AND $3 IS DISTINCT FROM p.title) OR ($4::text IS NOT NULL AND $4 IS DISTINCT FROM p.description) OR
      ($5::text IS NOT NULL AND $5 IS DISTINCT FROM p.priority) OR ($6::boolean AND $7::date IS DISTINCT FROM p.due_date) OR
      ($8::boolean IS NOT NULL AND $8 IS DISTINCT FROM p.completed)
    ) RETURNING t.*, ${snapshot("p")} AS before, p.completed AS was_completed
  ), event AS (
    INSERT INTO audit_events (user_id, action, task_id, task_title, details)
    SELECT user_id, CASE WHEN completed IS DISTINCT FROM was_completed THEN CASE WHEN completed THEN 'task.completed' ELSE 'task.reopened' END ELSE 'task.updated' END,
      id, title, jsonb_build_object('before', before, 'after', ${snapshot("changed")}) FROM changed
  ) SELECT ${taskColumns()} FROM changed`, [id, user.id, input.title ?? null, input.description ?? null, input.priority ?? null, "dueDate" in input, input.dueDate ?? null, input.completed ?? null]);
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

async function audit(user: User, url: URL): Promise<Response> {
  const before = url.searchParams.get("before");
  if (before && (!/^\d{1,18}$/.test(before) || BigInt(before) <= BigInt(0))) throw new ApiError(400, "Некорректный указатель истории.");
  const rows = await query<AuditEvent>(`SELECT id::text, action, task_id::text AS "taskId", task_title AS "taskTitle",
    created_at AS "createdAt", details FROM audit_events WHERE user_id = $1 AND ($2::bigint IS NULL OR id < $2::bigint)
    ORDER BY audit_events.id DESC LIMIT 51`, [user.id, before ?? null]);
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
