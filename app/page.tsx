"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, BookOpen, CalendarDays, Check, CheckCheck, ChevronDown, Circle, Flag, History, LayoutList, Loader2, LogOut, Pencil, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";

type User = { id: string; username: string };
type Priority = "normal" | "high" | "low";
type Task = { id: string; title: string; description: string; priority: Priority; dueDate: string | null; completed: boolean; createdAt: string; updatedAt: string };
type TaskInput = Pick<Task, "title" | "description" | "priority" | "dueDate">;
type AuditEvent = { id: string; action: string; taskId: string | null; taskTitle: string | null; createdAt: string; details: Record<string, unknown> | null };
type AuditResponse = { events: AuditEvent[]; nextCursor: string | null };
type Filter = "all" | "active" | "completed";

class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: "same-origin", cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Не удалось выполнить запрос. Попробуйте ещё раз.";
    throw new ApiError(message, response.status);
  }
  return data as T;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить действие. Попробуйте ещё раз.";
const priorityLabels: Record<Priority, string> = { normal: "Обычный", high: "Высокий", low: "Низкий" };
const formatDate = (value: string, withYear = false) => new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}) });
const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

function Crest({ large = false }: { large?: boolean }) {
  return <span className={`crest${large ? " crest-large" : ""}`} aria-hidden="true"><BookOpen strokeWidth={1.3} /><span>O</span></span>;
}

function Brand({ light = false }: { light?: boolean }) {
  return <div className={`brand${light ? " brand-light" : ""}`}><Crest /><div><span className="brand-name">ORDO</span><span className="brand-subtitle">Дневник дел</span></div></div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: User }>(`/auth/${mode}`, "POST", { username: String(data.get("username") ?? "").trim(), password: data.get("password") });
      onAuthenticated(result.user);
    } catch (failure) { setError(errorMessage(failure)); } finally { setPending(false); }
  }
  return <main className="auth-page">
    <section className="auth-story">
      <Brand light />
      <div className="auth-editorial"><span className="eyebrow">Искусство маленьких шагов</span><h1>Большие планы.<br /><em>Ясные мысли.</em><br />Простые действия.</h1><p>Личное пространство для того, что важно.<br />Соберите задачи, найдите фокус<br />и двигайтесь в своём ритме.</p><div className="editorial-rule" /><div className="auth-principles"><span>Планируйте</span><span>Действуйте</span><span>Достигайте</span></div></div>
      <div className="auth-story-footer"><span>ПОРЯДОК В ДЕЛАХ — СВОБОДА В МЫСЛЯХ</span><span>EST. 2026</span></div>
      <div className="auth-watermark" aria-hidden="true">O</div>
    </section>
    <section className="auth-form-panel">
      <div className="auth-topline"><span>Ваш личный дневник</span><ShieldCheck size={17} strokeWidth={1.5} /></div>
      <div className="auth-form-wrap">
        <span className="section-marker">01 / НАЧАЛО</span>
        <h2>{mode === "login" ? "С возвращением." : "Начнём с чистого листа."}</h2>
        <p className="auth-intro">{mode === "login" ? "Войдите, чтобы продолжить свой день." : "Создайте аккаунт — и дайте планам своё место."}</p>
        <div className="auth-tabs" aria-label="Вход или регистрация"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }} disabled={pending}>Войти</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }} disabled={pending}>Создать аккаунт</button></div>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="username">Логин<input id="username" name="username" placeholder="Ваш логин" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={32} pattern={"[A-Za-z0-9_.\\-]{3,32}"} title="От 3 до 32 латинских букв, цифр, точек, дефисов или знаков подчёркивания" required disabled={pending} /></label>
          {mode === "register" && <p className="field-help">3–32 символа: латинские буквы, цифры и знаки _ . -</p>}
          <label htmlFor="password">Пароль<input id="password" name="password" type="password" placeholder={mode === "register" ? "Не менее 12 символов" : "Ваш пароль"} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 12 : undefined} maxLength={128} required disabled={pending} /></label>
          {error && <div className="error-box" role="alert">{error}</div>}
          <button className="button primary auth-submit" disabled={pending}>{pending ? <><Loader2 className="spin" size={18} />Подождите…</> : <>{mode === "login" ? "Открыть дневник" : "Создать аккаунт"}<ArrowRight size={18} /></>}</button>
        </form>
        <div className="auth-assurance"><ShieldCheck size={18} strokeWidth={1.4} /><p>Задачи и история действий<br />доступны только в вашем аккаунте.</p></div>
      </div>
      <footer className="auth-footer"><span>Меньше шума. Больше смысла.</span><span>ORDO © 2026</span></footer>
    </section>
  </main>;
}

function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="modal-inner"><div className="modal-heading"><span className="eyebrow">Личный дневник</span><button type="button" className="icon-button" aria-label="Закрыть окно" onClick={onClose} disabled={busy}><X size={20} /></button></div><h2 id="modal-title">{title}</h2>{children}</div></dialog>;
}

function TaskEditor({ task, onSave, onClose }: { task: Task | null; onSave: (data: TaskInput) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await onSave({ title: String(form.get("title") ?? "").trim(), description: String(form.get("description") ?? "").trim(), priority: form.get("priority") as Priority, dueDate: String(form.get("dueDate") ?? "") || null });
      onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <Modal title={task ? "Редактировать задачу" : "Новая задача"} onClose={onClose} busy={busy}><form className="task-form" onSubmit={submit}><label htmlFor="task-title">Что нужно сделать?<input id="task-title" name="title" placeholder="Начните с одного небольшого шага" defaultValue={task?.title ?? ""} maxLength={200} required autoFocus disabled={busy} /></label><label htmlFor="task-description">Заметка <span className="optional">необязательно</span><textarea id="task-description" name="description" placeholder="Детали, идеи, важные мелочи…" defaultValue={task?.description ?? ""} maxLength={5000} rows={4} disabled={busy} /></label><div className="form-grid"><label htmlFor="task-date">Срок<input id="task-date" type="date" name="dueDate" defaultValue={task?.dueDate?.slice(0, 10) ?? ""} disabled={busy} /></label><label htmlFor="task-priority">Приоритет<div className="select-wrap"><select id="task-priority" name="priority" defaultValue={task?.priority ?? "normal"} disabled={busy}><option value="normal">Обычный</option><option value="high">Высокий</option><option value="low">Низкий</option></select><ChevronDown size={15} /></div></label></div>{error && <p className="error-box" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Отмена</button><button className="button primary" disabled={busy}>{busy ? <Loader2 size={17} className="spin" /> : <Check size={17} />}{task ? "Сохранить изменения" : "Добавить задачу"}</button></div></form></Modal>;
}

function DeleteDialog({ task, onDelete, onClose }: { task: Task; onDelete: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() { setBusy(true); try { await onDelete(); onClose(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }
  return <Modal title="Удалить задачу?" busy={busy} onClose={onClose}><p className="delete-description">«{task.title}» будет удалена из списка. Это действие останется в истории.</p>{error && <p role="alert" className="error-box">{error}</p>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onClose}>Оставить</button><button className="button primary" disabled={busy} onClick={remove}>{busy ? <Loader2 className="spin" size={17} /> : <Trash2 size={17} />}Удалить</button></div></Modal>;
}

const auditLabels: Record<string, string> = {
  "task.created": "Добавлена задача", "task.updated": "Задача отредактирована", "task.completed": "Задача выполнена", "task.reopened": "Задача возвращена в работу", "task.deleted": "Задача удалена",
  "auth.register": "Создан аккаунт", "auth.login": "Вход в дневник", "auth.logout": "Выход из дневника",
  "user.registered": "Создан аккаунт", "user.logged_in": "Вход в дневник", "user.logged_out": "Выход из дневника",
};
const fieldLabels: Record<string, string> = { title: "Название", description: "Заметка", priority: "Приоритет", dueDate: "Срок", due_date: "Срок", completed: "Статус" };
function displayValue(key: string, value: unknown): string {
  if (value === null || value === "" || value === undefined) return "не задано";
  if (key === "completed") return value ? "выполнена" : "в работе";
  if (key === "priority" && typeof value === "string" && value in priorityLabels) return priorityLabels[value as Priority];
  if ((key === "dueDate" || key === "due_date") && typeof value === "string") return formatDate(value, true);
  return String(value);
}
function AuditDetails({ event }: { event: AuditEvent }) {
  const before = event.details?.before;
  const after = event.details?.after;
  if (!before || typeof before !== "object" || !after || typeof after !== "object") return null;
  const changes = Object.keys(fieldLabels).filter(key => key in before && key in after && (before as Record<string, unknown>)[key] !== (after as Record<string, unknown>)[key]);
  if (!changes.length) return null;
  return <details className="audit-details"><summary>Что изменилось</summary><dl>{changes.map(key => <div key={key}><dt>{fieldLabels[key]}</dt><dd><span>{displayValue(key, (before as Record<string, unknown>)[key])}</span><ArrowRight size={12} /><strong>{displayValue(key, (after as Record<string, unknown>)[key])}</strong></dd></div>)}</dl></details>;
}

function HistoryView({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (cursor?: string) => {
    setLoading(true); setError("");
    try {
      const data = await api<AuditResponse>(`/audit${cursor ? `?before=${encodeURIComponent(cursor)}` : ""}`);
      setEvents(previous => cursor ? [...previous, ...data.events] : data.events); setNextCursor(data.nextCursor);
    } catch (failure) { if (failure instanceof ApiError && failure.status === 401) onUnauthorized(); else setError(errorMessage(failure)); } finally { setLoading(false); }
  }, [onUnauthorized]);
  useEffect(() => { void load(); }, [load]);
  return <section className="history-section" aria-label="История действий"><div className="list-heading"><h2>Хроника вашего дневника</h2><span>Сначала новые</span></div><p className="history-intro">Здесь сохраняется каждый шаг: от первой задачи до последней отметки.</p>{error && <div className="error-box" role="alert">{error}<button className="text-button" onClick={() => void load()}>Повторить</button></div>}{!events.length && !loading && !error && <div className="empty-state"><History size={32} strokeWidth={1} /><h3>История начинается здесь</h3><p>Ваши действия появятся в этом разделе.</p></div>}<ol className="audit-list">{events.map(event => <li key={event.id}><span className={`audit-dot${event.action.includes("completed") ? " audit-dot-success" : ""}`}>{event.action.includes("deleted") ? <Trash2 size={15} /> : event.action.includes("completed") ? <Check size={16} /> : event.action.includes("created") ? <Plus size={16} /> : event.action.includes("updated") ? <Pencil size={14} /> : <History size={15} />}</span><div className="audit-content"><h3>{auditLabels[event.action] ?? "Действие в дневнике"}</h3>{event.taskTitle && <p>{event.taskTitle}</p>}<AuditDetails event={event} /><time dateTime={event.createdAt}>{formatDate(event.createdAt, true)} · {new Date(event.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time></div></li>)}</ol>{loading && <div className="loading-inline"><Loader2 size={18} className="spin" />Загружаем историю…</div>}{nextCursor && !loading && <button className="button secondary load-more" onClick={() => void load(nextCursor)}>Показать ещё<ChevronDown size={16} /></button>}</section>;
}

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [view, setView] = useState<"tasks" | "history">("tasks");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Task | "new" | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const completed = tasks.filter(task => task.completed).length;
  const active = tasks.length - completed;
  const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
  const today = localDate();
  const visible = useMemo(() => tasks.filter(task => (filter === "all" || (filter === "completed" ? task.completed : !task.completed)) && `${task.title} ${task.description}`.toLowerCase().includes(query.toLowerCase().trim())), [tasks, filter, query]);
  const loadTasks = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = await api<{ tasks: Task[] }>("/tasks"); setTasks(data.tasks); }
    catch (failure) { if (failure instanceof ApiError && failure.status === 401) onLogout(); else setError(errorMessage(failure)); }
    finally { setLoading(false); }
  }, [onLogout]);
  useEffect(() => { void loadTasks(); }, [loadTasks]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(timer); }, [notice]);
  async function saveTask(data: TaskInput) {
    try {
      const editing = editor !== "new" && editor !== null;
      const result = await api<{ task: Task }>(editing ? `/tasks/${editor.id}` : "/tasks", editing ? "PATCH" : "POST", data);
      setTasks(previous => editing ? previous.map(task => task.id === result.task.id ? result.task : task) : [result.task, ...previous]);
      setNotice(editing ? "Изменения сохранены" : "Задача добавлена в дневник"); setError("");
    } catch (failure) { if (failure instanceof ApiError && failure.status === 401) onLogout(); throw failure; }
  }
  async function toggleTask(task: Task) {
    setPendingId(task.id); setError("");
    try { const result = await api<{ task: Task }>(`/tasks/${task.id}`, "PATCH", { completed: !task.completed }); setTasks(previous => previous.map(item => item.id === task.id ? result.task : item)); setNotice(result.task.completed ? "Ещё один шаг сделан" : "Задача возвращена в работу"); }
    catch (failure) { if (failure instanceof ApiError && failure.status === 401) onLogout(); else setError(errorMessage(failure)); }
    finally { setPendingId(null); }
  }
  async function deleteTask() {
    if (!deleting) return;
    try { await api(`/tasks/${deleting.id}`, "DELETE"); setTasks(previous => previous.filter(task => task.id !== deleting.id)); setNotice("Задача удалена. Запись сохранена в истории."); }
    catch (failure) { if (failure instanceof ApiError && failure.status === 401) onLogout(); throw failure; }
  }
  async function logout() {
    setLoggingOut(true);
    try { await api("/auth/logout", "POST", {}); onLogout(); } catch (failure) { setError(errorMessage(failure)); setLoggingOut(false); }
  }
  function chooseFilter(next: Filter) { setFilter(next); setView("tasks"); }
  return <div className="workspace">
    <aside className="sidebar">
      <Brand />
      <div className="sidebar-section-label">ЛИЧНОЕ ПРОСТРАНСТВО</div>
      <nav className="main-nav" aria-label="Разделы дневника">
        <button className={view === "tasks" ? "selected" : ""} onClick={() => chooseFilter("all")}><LayoutList size={19} strokeWidth={1.5} /><span>Мои задачи</span><span className="nav-count">{tasks.length}</span></button>
        <button className={view === "history" ? "selected" : ""} onClick={() => setView("history")}><History size={19} strokeWidth={1.5} /><span>История действий</span></button>
      </nav>
      <div className="sidebar-note"><BookOpen size={22} strokeWidth={1.2} /><p>Каждый большой результат<br />начинается с маленького<br /><em>«сделано».</em></p><span>ОДНА ЗАДАЧА ЗА РАЗ</span></div>
      <div className="profile"><span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}</strong><span>Личный аккаунт</span></div><button className="icon-button" title="Выйти из аккаунта" aria-label="Выйти из аккаунта" onClick={logout} disabled={loggingOut}>{loggingOut ? <Loader2 size={17} className="spin" /> : <LogOut size={17} />}</button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div><span className="breadcrumb">Дневник</span><span className="breadcrumb-divider">/</span><span>{view === "tasks" ? "Мои задачи" : "История действий"}</span></div><span className="topbar-date"><CalendarDays size={15} strokeWidth={1.5} />{formatDate(new Date().toISOString(), true)}</span></header>
      <main className="workspace-main">
        <section className="page-heading"><div><span className="eyebrow">{view === "tasks" ? "ПЛАНЫ, КОТОРЫЕ СТАНОВЯТСЯ ДЕЛАМИ" : "КАЖДОЕ ДЕЙСТВИЕ ИМЕЕТ ЗНАЧЕНИЕ"}</span><h1>{view === "tasks" ? "Всё начинается с плана." : "История ваших шагов."}</h1><p>{view === "tasks" ? "Освободите мысли. Сосредоточьтесь на важном." : "Прозрачная хроника изменений — всегда под рукой."}</p></div>{view === "tasks" && <button className="button primary new-task-button" onClick={() => setEditor("new")}><Plus size={18} />Новая задача</button>}</section>
        {error && <div className="error-box workspace-error" role="alert">{error}<button className="text-button" onClick={() => void loadTasks()}>Повторить загрузку</button></div>}
        {view === "tasks" ? <>
          <section className="overview" aria-label="Ваш прогресс"><div className="stat"><span>ВСЕГО ЗАДАЧ</span><strong>{loading ? "—" : String(tasks.length).padStart(2, "0")}</strong><LayoutList size={20} strokeWidth={1.2} /></div><div className="stat"><span>В РАБОТЕ</span><strong>{loading ? "—" : String(active).padStart(2, "0")}</strong><Circle size={20} strokeWidth={1.2} /></div><div className="stat"><span>ВЫПОЛНЕНО</span><strong>{loading ? "—" : String(completed).padStart(2, "0")}</strong><CheckCheck size={22} strokeWidth={1.2} /></div><div className="progress-stat"><div><span>ВАШ ПРОГРЕСС</span><strong>{progress}<small>%</small></strong></div><div className="progress-track" role="progressbar" aria-label="Выполненные задачи" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div><p>{tasks.length === 0 ? "Первый шаг — добавить задачу" : progress === 100 ? "Всё сделано. Время выдохнуть." : "Каждый шаг имеет значение"}</p></div></section>
          <section className="tasks-section" aria-label="Список задач"><div className="task-toolbar"><div className="filter-tabs" aria-label="Фильтр задач">{([["all", "Все задачи", tasks.length], ["active", "В работе", active], ["completed", "Выполнено", completed]] as const).map(([value, label, count]) => <button key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>)}</div><label className="search-box"><Search size={17} strokeWidth={1.5} /><input aria-label="Поиск задач" placeholder="Найти задачу…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="Очистить поиск" onClick={() => setQuery("")}><X size={14} /></button>}</label></div>
          {loading ? <div className="empty-state"><Loader2 size={30} className="spin" strokeWidth={1} /><p>Открываем ваш дневник…</p></div> : !visible.length ? <div className="empty-state"><span className="empty-illustration"><BookOpen size={37} strokeWidth={1} /><span /></span><span className="section-marker">{tasks.length ? "ПРОСТРАНСТВО ДЛЯ НОВОГО" : "ВАША ПЕРВАЯ СТРАНИЦА"}</span><h2>{query ? "Пока ничего не нашлось" : tasks.length ? filter === "completed" ? "Всё ещё впереди" : "Здесь пока тихо" : "Место для ваших планов"}</h2><p>{query ? "Попробуйте другое слово или очистите поиск." : tasks.length ? filter === "completed" ? "Отметьте готовую задачу — и она появится здесь." : "В этом разделе пока нет задач." : "Запишите то, что давно держите в голове.\nДаже большое дело начинается с одной строки."}</p>{!query && !tasks.length && <button className="button primary" onClick={() => setEditor("new")}><Plus size={17} />Добавить первую задачу</button>}{query && <button className="button secondary" onClick={() => setQuery("")}>Очистить поиск</button>}</div> : <div className="task-list">{visible.map(task => <article key={task.id} className={`task-row${task.completed ? " task-completed" : ""}`}><button className="task-checkbox" role="checkbox" aria-checked={task.completed} aria-label={`${task.completed ? "Вернуть в работу" : "Выполнить"}: ${task.title}`} disabled={pendingId !== null} onClick={() => void toggleTask(task)}>{pendingId === task.id ? <Loader2 size={16} className="spin" /> : task.completed ? <Check size={16} strokeWidth={2} /> : null}</button><div className="task-content"><button className="task-title" onClick={() => setEditor(task)} disabled={pendingId !== null}>{task.title}</button>{task.description && <p className="task-description">{task.description}</p>}<div className="task-meta">{task.priority !== "normal" && <span className={`priority priority-${task.priority}`}><Flag size={11} />{priorityLabels[task.priority]} приоритет</span>}{task.dueDate && <span className={`task-date${!task.completed && task.dueDate < today ? " overdue" : ""}`}><CalendarDays size={12} />{formatDate(task.dueDate)}{!task.completed && task.dueDate < today ? " · срок прошёл" : ""}</span>}{task.completed && <span className="completed-tag">Выполнено</span>}</div></div><div className="task-actions"><button className="icon-button" aria-label={`Редактировать: ${task.title}`} title="Редактировать" onClick={() => setEditor(task)} disabled={pendingId !== null}><Pencil size={16} strokeWidth={1.5} /></button><button className="icon-button delete-button" aria-label={`Удалить: ${task.title}`} title="Удалить" onClick={() => setDeleting(task)} disabled={pendingId !== null}><Trash2 size={16} strokeWidth={1.5} /></button></div></article>)}<button className="inline-add" onClick={() => setEditor("new")}><Plus size={17} />Добавить задачу<span>Ещё один шаг к важному</span></button></div>}
          <div className="list-footer"><span><ShieldCheck size={13} />Ваши задачи доступны только вам</span><span>{visible.length > 0 ? `Показано ${visible.length} из ${tasks.length}` : "В вашем собственном ритме"}</span></div></section>
          <div className="bottom-note"><span className="note-line" /><BookOpen size={17} strokeWidth={1.2} /><span>Не всё сразу. Главное — начать.</span><span className="note-line" /></div>
        </> : <HistoryView onUnauthorized={onLogout} />}
      </main>
      <footer className="workspace-footer"><span>ORDO <span className="footer-dot">·</span> Личный дневник дел</span><span>Упорядочивая день, создаём будущее.</span></footer>
    </div>
    {notice && <div className="toast" role="status"><Check size={16} />{notice}<button aria-label="Скрыть уведомление" onClick={() => setNotice("")}><X size={15} /></button></div>}
    {editor !== null && <TaskEditor task={editor === "new" ? null : editor} onSave={saveTask} onClose={() => setEditor(null)} />}
    {deleting && <DeleteDialog task={deleting} onDelete={deleteTask} onClose={() => setDeleting(null)} />}
  </div>;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const logout = useCallback(() => setUser(null), []);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = await api<{ user: User | null }>("/session"); setUser(data.user); } catch (failure) { setError(errorMessage(failure)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <main className="initial-state"><Brand /><Loader2 className="spin" size={22} /><p>Открываем дневник…</p></main>;
  if (error) return <main className="initial-state"><Brand /><h1>Не удалось открыть дневник</h1><p role="alert">{error}</p><button className="button primary" onClick={() => void load()}>Попробовать снова<ArrowRight size={17} /></button></main>;
  return user ? <Workspace user={user} onLogout={logout} /> : <AuthScreen onAuthenticated={setUser} />;
}
