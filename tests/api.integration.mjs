import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

const base = (process.env.TEST_BASE_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const origin = new URL(base).origin;
const suffix = randomBytes(5).toString("hex");
const username = `qa_a_${suffix}`;
const otherUsername = `qa_b_${suffix}`;
const password = randomBytes(24).toString("base64url");

async function request(path, { method = "GET", body, cookie, customOrigin = origin } = {}) {
  const headers = { Origin: customOrigin };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: response.status, data, cookie: response.headers.get("set-cookie"), headers: response.headers };
}

test("PostgreSQL API: accounts, task lifecycle, ownership, persistence and audit", async (t) => {
  let cookie;
  let otherCookie;
  let taskId;
  const originalTitle = '<script>alert("task")</script>';

  await t.test("database ready and anonymous access denied", async () => {
    const health = await request("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.data.database, "postgresql");
    assert.deepEqual((await request("/api/session")).data, { user: null });
    assert.equal((await request("/api/tasks")).status, 401);
    assert.equal((await request("/api/audit")).status, 401);
    assert.equal((await request("/api/tasks", { method: "POST", body: { title: "Forbidden" } })).status, 401);
  });

  await t.test("registration validates credentials and establishes protected session", async () => {
    assert.equal((await request("/api/auth/register", { method: "POST", body: { username: "bad user", password } })).status, 400);
    assert.equal((await request("/api/auth/register", { method: "POST", body: { username, password: "short" } })).status, 400);
    const registration = await request("/api/auth/register", { method: "POST", body: { username: username.toUpperCase(), password } });
    assert.equal(registration.status, 201, registration.data.error);
    assert.equal(registration.data.user.username, username);
    assert.match(registration.cookie, /HttpOnly/);
    assert.match(registration.cookie, /SameSite=Lax/);
    if (base.startsWith("https:")) assert.match(registration.cookie, /Secure/);
    cookie = registration.cookie.split(";")[0];
    const second = await request("/api/auth/register", { method: "POST", body: { username: otherUsername, password } });
    assert.equal(second.status, 201, second.data.error);
    otherCookie = second.cookie.split(";")[0];
    assert.equal((await request("/api/auth/register", { method: "POST", body: { username, password } })).status, 409);
    const session = await request("/api/session", { cookie });
    assert.equal(session.data.user.username, username);
    assert.deepEqual(Object.keys(session.data.user).sort(), ["id", "username"]);
  });

  await t.test("CSRF and input validation reject invalid writes", async () => {
    assert.equal((await request("/api/tasks", { method: "POST", cookie, body: { title: "Forbidden" }, customOrigin: "https://attacker.invalid" })).status, 403);
    for (const body of [{ title: " " }, { title: "x".repeat(201) }, { title: "x", priority: "urgent" }, { title: "x", dueDate: "2026-02-30" }, { title: "x", user_id: "someone" }, { title: "x", description: "x".repeat(5001) }]) {
      assert.equal((await request("/api/tasks", { method: "POST", cookie, body })).status, 400);
    }
  });

  await t.test("task creation persists all fields and literal text safely", async () => {
    const result = await request("/api/tasks", { method: "POST", cookie, body: { title: originalTitle, description: "Моя первая задача", priority: "high", dueDate: "2028-02-29" } });
    assert.equal(result.status, 201, result.data.error);
    taskId = result.data.task.id;
    assert.equal(result.data.task.title, originalTitle);
    assert.equal(result.data.task.completed, false);
    assert.equal(result.data.task.priority, "high");
    assert.equal(result.data.task.dueDate, "2028-02-29");
    const persisted = await request("/api/tasks", { cookie });
    assert.equal(persisted.data.tasks.length, 1);
    assert.equal(persisted.data.tasks[0].id, taskId);
    assert.equal(persisted.headers.get("cache-control"), "no-store");
  });

  await t.test("second user cannot list/read/edit/delete first user's data", async () => {
    assert.deepEqual((await request("/api/tasks", { cookie: otherCookie })).data.tasks, []);
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const result = await request(`/api/tasks/${taskId}`, { method, cookie: otherCookie, body: method === "PATCH" ? { title: "Stolen" } : undefined });
      assert.equal(result.status, 404);
    }
    const audit = await request("/api/audit", { cookie: otherCookie });
    assert.equal(audit.data.events.length, 1);
    assert.equal(audit.data.events[0].action, "user.registered");
    assert.equal((await request(`/api/tasks/${taskId}`, { cookie })).data.task.title, originalTitle);
  });

  await t.test("editing, completion and reopening produce precise audit snapshots", async () => {
    const edit = await request(`/api/tasks/${taskId}`, { method: "PATCH", cookie, body: { title: "Обновлённая задача", description: "Новое описание", priority: "low", dueDate: null } });
    assert.equal(edit.status, 200, edit.data.error);
    assert.equal(edit.data.task.dueDate, null);
    assert.equal(edit.data.task.description, "Новое описание");
    assert.equal((await request(`/api/tasks/${taskId}`, { method: "PATCH", cookie, body: { completed: true } })).data.task.completed, true);
    assert.equal((await request(`/api/tasks/${taskId}`, { method: "PATCH", cookie, body: { completed: false } })).data.task.completed, false);
    const beforeNoop = (await request("/api/audit", { cookie })).data.events;
    assert.equal((await request(`/api/tasks/${taskId}`, { method: "PATCH", cookie, body: { completed: false } })).status, 200);
    const events = (await request("/api/audit", { cookie })).data.events;
    assert.equal(events.length, beforeNoop.length);
    assert.deepEqual(events.slice(0, 4).map((event) => event.action), ["task.reopened", "task.completed", "task.updated", "task.created"]);
    assert.equal(events[2].details.before.title, originalTitle);
    assert.equal(events[2].details.after.title, "Обновлённая задача");
    assert.equal(events[1].details.before.completed, false);
    assert.equal(events[1].details.after.completed, true);
    assert.equal((await request("/api/audit?before=invalid", { cookie })).status, 400);
    const older = (await request(`/api/audit?before=${events[1].id}`, { cookie })).data.events;
    assert.ok(older.every((event) => BigInt(event.id) < BigInt(events[1].id)));
  });

  await t.test("concurrent edits keep an auditable before/after chain", async () => {
    const results = await Promise.all(["Параллельная A", "Параллельная B"].map((title) => request(`/api/tasks/${taskId}`, { method: "PATCH", cookie, body: { title } })));
    results.forEach((result) => assert.equal(result.status, 200, result.data.error));
    const events = (await request("/api/audit", { cookie })).data.events.slice(0, 2);
    assert.equal(events[0].details.before.title, events[1].details.after.title);
    assert.equal(events[1].details.before.title, "Обновлённая задача");
    const task = (await request(`/api/tasks/${taskId}`, { cookie })).data.task;
    assert.equal(task.title, events[0].details.after.title);
  });

  await t.test("logout revokes session; login restores persisted tasks", async () => {
    const oldCookie = cookie;
    const logout = await request("/api/auth/logout", { method: "POST", cookie });
    assert.equal(logout.status, 200);
    assert.match(logout.cookie, /Max-Age=0/);
    assert.equal((await request("/api/tasks", { cookie: oldCookie })).status, 401);
    assert.equal((await request("/api/auth/login", { method: "POST", body: { username, password: "incorrect-password" } })).status, 401);
    const login = await request("/api/auth/login", { method: "POST", body: { username, password } });
    assert.equal(login.status, 200, login.data.error);
    cookie = login.cookie.split(";")[0];
    assert.equal((await request("/api/tasks", { cookie })).data.tasks[0].id, taskId);
    const actions = (await request("/api/audit", { cookie })).data.events.map((event) => event.action);
    assert.ok(actions.includes("user.logged_out"));
    assert.equal(actions[0], "user.logged_in");
  });

  await t.test("deletion removes task but retains complete audit", async () => {
    const remove = await request(`/api/tasks/${taskId}`, { method: "DELETE", cookie });
    assert.equal(remove.status, 200, remove.data.error);
    assert.deepEqual((await request("/api/tasks", { cookie })).data.tasks, []);
    assert.equal((await request(`/api/tasks/${taskId}`, { cookie })).status, 404);
    assert.equal((await request(`/api/tasks/${taskId}`, { method: "DELETE", cookie })).status, 404);
    const event = (await request("/api/audit", { cookie })).data.events[0];
    assert.equal(event.action, "task.deleted");
    assert.equal(event.taskId, taskId);
    assert.equal(event.details.before.title, event.taskTitle);
    assert.equal((await request(`/api/audit/${event.id}`, { method: "DELETE", cookie })).status, 404);
    await request("/api/auth/logout", { method: "POST", cookie });
    await request("/api/auth/logout", { method: "POST", cookie: otherCookie });
  });

  await t.test("repeated authentication attempts are rate limited", async () => {
    const unknown = `qa_missing_${suffix}`;
    for (let attempt = 0; attempt < 12; attempt++) {
      assert.equal((await request("/api/auth/login", { method: "POST", body: { username: unknown, password } })).status, 401);
    }
    assert.equal((await request("/api/auth/login", { method: "POST", body: { username: unknown, password } })).status, 429);
  });
});
