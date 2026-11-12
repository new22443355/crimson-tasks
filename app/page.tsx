"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Ban, BookOpen, CalendarDays, Check, CheckCheck, ChevronDown, Circle, Flag, History, LayoutList, Loader2, LogOut, Pencil, Plus, RotateCcw, Search, Settings, ShieldCheck, SlidersHorizontal, Trash2, X } from "lucide-react";
import { DatePicker, SelectField } from "./components/controls";
import { capitalizeLines, dateKey, emptyFilters, filterTasks, localDateBoundary, matchesSearch, normalizeSearch, parsePreferences, type Priority, type TaskFilters, type TaskPreferences, type TaskStatus } from "@/lib/client/task-filters";

type User = { id: string; username: string };
type Task = { id: string; title: string; description: string; priority: Priority; dueDate: string | null; completed: boolean; cancelled: boolean; createdAt: string; updatedAt: string };
type TaskInput = Pick<Task, "title" | "description" | "priority" | "dueDate">;
type AuditEvent = { id: string; action: string; taskId: string | null; taskTitle: string | null; createdAt: string; details: Record<string, unknown> | null };
type AuditResponse = { events: AuditEvent[]; nextCursor: string | null };

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
const priorityOptions = Object.entries(priorityLabels).map(([value, label]) => ({ value, label }));
const statusOptions = [{ value: "all", label: "Все статусы" }, { value: "active", label: "В работе" }, { value: "completed", label: "Выполнено" }, { value: "cancelled", label: "Отменено" }];
const formatDate = (value: string, withYear = false) => new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}) });

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
    event.preventDefault(); setError("");
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (!(mode === "register" ? /^[A-Za-z0-9_.-]{4,32}$/ : /^[A-Za-z0-9_.-]{3,32}$/).test(username)) {
      setError(`Логин: от ${mode === "register" ? 4 : 3} до 32 латинских букв, цифр или знаков _ . -`); return;
    }
    if (password.length < 4 || password.length > 128) { setError("Пароль должен содержать от 4 до 128 символов."); return; }
    setPending(true);
    try {
      const result = await api<{ user: User }>(`/auth/${mode}`, "POST", { username, password });
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
        <form onSubmit={submit} className="auth-form" noValidate>
          <label htmlFor="username">Логин<input id="username" name="username" placeholder="Ваш логин" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={mode === "register" ? 4 : 3} maxLength={32} required disabled={pending} /></label>
          {mode === "register" && <p className="field-help">4–32 символа: латинские буквы, цифры и знаки _ . -</p>}
          <label htmlFor="password">Пароль<input id="password" name="password" type="password" placeholder={mode === "register" ? "Не менее 4 символов" : "Ваш пароль"} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={4} maxLength={128} required disabled={pending} /></label>
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
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const frame = requestAnimationFrame(() => dialog?.querySelector<HTMLElement>("[data-initial-focus]")?.focus({ preventScroll: true }));
    return () => { cancelAnimationFrame(frame); dialog?.close(); };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="modal-inner"><div className="modal-heading"><span className="eyebrow">Личный дневник</span><button type="button" className="icon-button modal-close" aria-label="Закрыть окно" onClick={onClose} disabled={busy}><X size={20} /></button></div><h2 id="modal-title">{title}</h2>{children}</div></dialog>;
}

function TaskEditor({ task, onSave, onClose }: { task: Task | null; onSave: (data: TaskInput) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "normal");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const pendingSelection = useRef<{ value: string; start: number; end: number; direction: "forward" | "backward" | "none" } | null>(null);
  const resizeNote = useCallback(() => {
    const input = textarea.current;
    if (!input) return;
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    const maximum = Math.max(96, Math.min(420, viewport * 0.4));
    input.style.height = "auto";
    input.style.maxHeight = `${maximum}px`;
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 108), maximum)}px`;
    input.style.overflowY = input.scrollHeight > maximum ? "auto" : "hidden";
  }, []);
  useLayoutEffect(() => {
    resizeNote();
    const selection = pendingSelection.current;
    pendingSelection.current = null;
    if (selection && textarea.current?.value === selection.value) {
      textarea.current.setSelectionRange(selection.start, selection.end, selection.direction);
    }
  }, [description, resizeNote]);
  useEffect(() => {
    const frame = requestAnimationFrame(resizeNote);
    window.addEventListener("resize", resizeNote);
    window.visualViewport?.addEventListener("resize", resizeNote);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", resizeNote); window.visualViewport?.removeEventListener("resize", resizeNote); };
  }, [resizeNote]);
  function changeNote(input: HTMLTextAreaElement) {
    const raw = input.value;
    pendingSelection.current = null;
    if (composing.current) { setDescription(raw); return; }
    const next = capitalizeLines(raw);
    const start = capitalizeLines(raw.slice(0, input.selectionStart)).length;
    const end = capitalizeLines(raw.slice(0, input.selectionEnd)).length;
    const direction = input.selectionDirection;
    if (next !== raw) {
      if (next === description) {
        input.value = next;
        input.setSelectionRange(start, end, direction);
      } else {
        pendingSelection.current = { value: next, start, end, direction };
      }
    }
    setDescription(next);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const title = String(new FormData(event.currentTarget).get("title") ?? "").trim();
    if (!title || title.length > 200) { setError("Название задачи должно содержать от 1 до 200 символов."); return; }
    if (description.length > 5000) { setError("Заметка должна содержать не более 5000 символов."); return; }
    setBusy(true);
    try { await onSave({ title, description: description.trim(), priority, dueDate: dueDate || null }); onClose(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <Modal title={task ? "Редактировать задачу" : "Новая задача"} onClose={onClose} busy={busy}>
    <form className="task-form" onSubmit={submit} noValidate>
      <label htmlFor="task-title">Что нужно сделать?<input id="task-title" name="title" placeholder="Начните с одного небольшого шага" defaultValue={task?.title ?? ""} maxLength={200} required autoFocus data-initial-focus disabled={busy} /></label>
      <label htmlFor="task-description">Заметка <span className="optional">необязательно</span><textarea ref={textarea} id="task-description" name="description" placeholder="Детали, идеи, важные мелочи…" value={description} onChange={event => changeNote(event.currentTarget)} onCompositionStart={() => { composing.current = true; pendingSelection.current = null; }} onCompositionEnd={event => { composing.current = false; changeNote(event.currentTarget); }} autoCapitalize="sentences" maxLength={5000} rows={3} disabled={busy} /></label>
      <div className="form-grid">
        <div className="filter-field"><label htmlFor="task-date">Срок</label><DatePicker id="task-date" value={dueDate} onChange={setDueDate} disabled={busy} label="Срок задачи" placeholder="Без срока" /></div>
        <div className="filter-field"><label htmlFor="task-priority">Приоритет</label><SelectField id="task-priority" value={priority} onChange={value => setPriority(value as Priority)} options={priorityOptions} disabled={busy} label="Приоритет задачи" /></div>
      </div>
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Отмена</button><button className="button primary" disabled={busy}>{busy ? <Loader2 size={17} className="spin" /> : <Check size={17} />}{task ? "Сохранить изменения" : "Добавить задачу"}</button></div>
    </form>
  </Modal>;
}

function TaskFilterDialog({ filters, onApply, onClose }: { filters: TaskFilters; onApply: (filters: TaskFilters) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(filters);
  const [error, setError] = useState("");
  function apply(event: FormEvent) {
    event.preventDefault();
    if ((draft.createdFrom && draft.createdTo && draft.createdFrom > draft.createdTo) || (draft.dueFrom && draft.dueTo && draft.dueFrom > draft.dueTo)) {
      setError("Начало периода не может быть позже его окончания."); return;
    }
    onApply(draft); onClose();
  }
  return <Modal title="Фильтр задач" onClose={onClose}>
    <form className="task-form" onSubmit={apply} noValidate>
      <div className="filter-grid">
        <div className="filter-field"><label htmlFor="filter-status">Статус</label><SelectField id="filter-status" value={draft.status} onChange={value => setDraft({ ...draft, status: value as TaskStatus })} options={statusOptions} label="Статус задач" /></div>
        <div className="filter-field"><label htmlFor="filter-priority">Приоритет</label><SelectField id="filter-priority" value={draft.priority} onChange={value => setDraft({ ...draft, priority: value as TaskFilters["priority"] })} options={[{ value: "all", label: "Любой приоритет" }, ...priorityOptions]} label="Фильтр по приоритету" /></div>
        <div className="filter-field"><label htmlFor="filter-created-from">Добавлена с</label><DatePicker id="filter-created-from" value={draft.createdFrom} onChange={value => setDraft({ ...draft, createdFrom: value })} label="Добавлена с" /></div>
        <div className="filter-field"><label htmlFor="filter-created-to">Добавлена по</label><DatePicker id="filter-created-to" value={draft.createdTo} onChange={value => setDraft({ ...draft, createdTo: value })} label="Добавлена по" /></div>
        <div className="filter-field"><label htmlFor="filter-due-from">Срок с</label><DatePicker id="filter-due-from" value={draft.dueFrom} onChange={value => setDraft({ ...draft, dueFrom: value })} label="Срок с" /></div>
        <div className="filter-field"><label htmlFor="filter-due-to">Срок по</label><DatePicker id="filter-due-to" value={draft.dueTo} onChange={value => setDraft({ ...draft, dueTo: value })} label="Срок по" /></div>
      </div>
      <p className="field-help">Даты включаются в выбранный период. Задачи без срока не попадают в фильтр по сроку.</p>
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="modal-actions filter-actions"><button type="button" className="button secondary" onClick={() => { setDraft({ ...emptyFilters }); setError(""); }}>Сбросить</button><button className="button primary"><Check size={17} />Применить</button></div>
    </form>
  </Modal>;
}

function DeleteDialog({ task, onDelete, onClose }: { task: Task; onDelete: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() { setBusy(true); try { await onDelete(); onClose(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }
  return <Modal title="Удалить задачу?" busy={busy} onClose={onClose}><p className="delete-description">«{task.title}» будет удалена из списка. Это действие останется в истории.</p>{error && <p role="alert" className="error-box">{error}</p>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onClose}>Оставить</button><button className="button primary" disabled={busy} onClick={remove}>{busy ? <Loader2 className="spin" size={17} /> : <Trash2 size={17} />}Удалить</button></div></Modal>;
}

function AccountSettings({ user, onUserChanged, onSaved, onUnauthorized, onClose }: { user: User; onUserChanged: (user: User) => void; onSaved: () => void; onUnauthorized: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<"username" | "password">("username");
  const [username, setUsername] = useState(user.username);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  function chooseMode(next: typeof mode) {
    setMode(next); setError(""); setSuccess(""); setCurrentPassword(""); setNewPassword(""); setConfirmation("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess("");
    if (currentPassword.length < 4 || currentPassword.length > 128) { setError("Введите текущий пароль: от 4 до 128 символов."); return; }
    const nextUsername = username.trim();
    if (mode === "username" && !/^[A-Za-z0-9_.-]{4,32}$/.test(nextUsername)) { setError("Новый логин: от 4 до 32 латинских букв, цифр или знаков _ . -"); return; }
    if (mode === "password" && (newPassword.length < 4 || newPassword.length > 128)) { setError("Новый пароль должен содержать от 4 до 128 символов."); return; }
    if (mode === "password" && newPassword !== confirmation) { setError("Новый пароль и его повтор не совпадают."); return; }
    setBusy(true);
    try {
      if (mode === "username") {
        const result = await api<{ user: User }>("/account/username", "PATCH", { username: nextUsername, currentPassword });
        onUserChanged(result.user); setUsername(result.user.username); setSuccess("Логин изменён. Ваши задачи и история сохранены.");
      } else {
        await api<{ ok: boolean }>("/account/password", "PATCH", { currentPassword, newPassword });
        setNewPassword(""); setConfirmation(""); setSuccess("Пароль изменён. На остальных устройствах потребуется войти заново.");
      }
      setCurrentPassword("");
      onSaved();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onUnauthorized(); else setError(errorMessage(failure));
    } finally { setBusy(false); }
  }
  return <Modal title="Настройки аккаунта" busy={busy} onClose={onClose}>
    <p className="account-intro">Измените данные для входа. Для подтверждения понадобится текущий пароль.</p>
    <div className="auth-tabs account-tabs" aria-label="Настройки данных для входа">
      <button type="button" className={mode === "username" ? "active" : ""} aria-pressed={mode === "username"} disabled={busy} onClick={() => chooseMode("username")}>Логин</button>
      <button type="button" className={mode === "password" ? "active" : ""} aria-pressed={mode === "password"} disabled={busy} onClick={() => chooseMode("password")}>Пароль</button>
    </div>
    <form className="task-form account-form" noValidate onSubmit={submit}>
      {mode === "username" ? <>
        <label htmlFor="account-username">Новый логин<input id="account-username" name="username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={4} maxLength={32} data-initial-focus disabled={busy} /></label>
        <p className="field-help">4–32 символа: латинские буквы, цифры и знаки _ . -</p>
      </> : <input type="hidden" name="username" value={user.username} autoComplete="username" />}
      <label htmlFor="account-current-password">Текущий пароль<input id="account-current-password" name="currentPassword" type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" minLength={4} maxLength={128} disabled={busy} /></label>
      {mode === "password" && <>
        <label htmlFor="account-new-password">Новый пароль<input id="account-new-password" name="newPassword" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="Не менее 4 символов" autoComplete="new-password" minLength={4} maxLength={128} disabled={busy} /></label>
        <label htmlFor="account-confirm-password">Повторите новый пароль<input id="account-confirm-password" name="confirmPassword" type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" minLength={4} maxLength={128} disabled={busy} /></label>
      </>}
      {error && <p className="error-box" role="alert">{error}</p>}
      {success && <p className="success-box" role="status"><Check size={18} />{success}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Закрыть</button><button className="button primary" disabled={busy}>{busy ? <Loader2 size={18} className="spin" /> : <Check size={18} />}{mode === "username" ? "Сохранить логин" : "Сменить пароль"}</button></div>
    </form>
  </Modal>;
}

const auditLabels: Record<string, string> = {
  "task.created": "Добавлена задача", "task.updated": "Задача отредактирована", "task.completed": "Задача выполнена", "task.cancelled": "Задача отменена", "task.reopened": "Задача возвращена в работу", "task.deleted": "Задача удалена",
  "auth.register": "Создан аккаунт", "auth.login": "Вход в дневник", "auth.logout": "Выход из дневника",
  "user.registered": "Создан аккаунт", "user.logged_in": "Вход в дневник", "user.logged_out": "Выход из дневника",
  "user.username_changed": "Изменён логин", "user.password_changed": "Изменён пароль",
};
const auditOptions = [
  { value: "", label: "Все действия" },
  ...["task.created", "task.updated", "task.completed", "task.cancelled", "task.reopened", "task.deleted", "user.registered", "user.logged_in", "user.logged_out", "user.username_changed", "user.password_changed"].map(value => ({ value, label: auditLabels[value] })),
];
const fieldLabels: Record<string, string> = { title: "Название", description: "Заметка", priority: "Приоритет", dueDate: "Срок", due_date: "Срок", username: "Логин" };
function displayValue(key: string, value: unknown): string {
  if (value === null || value === "" || value === undefined) return "не задано";
  if (key === "priority" && typeof value === "string" && value in priorityLabels) return priorityLabels[value as Priority];
  if ((key === "dueDate" || key === "due_date") && typeof value === "string") return formatDate(value, true);
  return String(value);
}
function snapshotStatus(value: Record<string, unknown>): string {
  return value.cancelled ? "отменена" : value.completed ? "выполнена" : "в работе";
}
function AuditDetails({ event }: { event: AuditEvent }) {
  const before = event.details?.before;
  const after = event.details?.after;
  if (!before || typeof before !== "object" || !after || typeof after !== "object") return null;
  const previous = before as Record<string, unknown>;
  const current = after as Record<string, unknown>;
  const changes = Object.keys(fieldLabels).filter(key => key in previous && key in current && previous[key] !== current[key]).map(key => ({ label: fieldLabels[key], before: displayValue(key, previous[key]), after: displayValue(key, current[key]) }));
  if (snapshotStatus(previous) !== snapshotStatus(current)) changes.push({ label: "Статус", before: snapshotStatus(previous), after: snapshotStatus(current) });
  if (!changes.length) return null;
  return <details className="audit-details"><summary>Что изменилось</summary><dl>{changes.map(change => <div key={change.label}><dt>{change.label}</dt><dd><span>{change.before}</span><ArrowRight size={14} /><strong>{change.after}</strong></dd></div>)}</dl></details>;
}

type HistoryFilters = { action: string; from: string; to: string };
const emptyHistoryFilters: HistoryFilters = { action: "", from: "", to: "" };
function HistoryFilterDialog({ filters, onApply, onClose }: { filters: HistoryFilters; onApply: (filters: HistoryFilters) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(filters);
  const [error, setError] = useState("");
  function apply(event: FormEvent) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) { setError("Начало периода не может быть позже его окончания."); return; }
    onApply(draft); onClose();
  }
  return <Modal title="Фильтр истории" onClose={onClose}>
    <form className="task-form" onSubmit={apply} noValidate>
      <div className="filter-field"><label htmlFor="history-action">Действие</label><SelectField id="history-action" label="Действие в истории" value={draft.action} onChange={value => setDraft({ ...draft, action: value })} options={auditOptions} /></div>
      <div className="filter-grid">
        <div className="filter-field"><label htmlFor="history-from">Дата с</label><DatePicker id="history-from" label="Дата действия с" value={draft.from} onChange={value => setDraft({ ...draft, from: value })} /></div>
        <div className="filter-field"><label htmlFor="history-to">Дата по</label><DatePicker id="history-to" label="Дата действия по" value={draft.to} onChange={value => setDraft({ ...draft, to: value })} /></div>
      </div>
      <p className="field-help">Период включает обе даты в вашем часовом поясе.</p>
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="modal-actions filter-actions"><button type="button" className="button secondary" onClick={() => { setDraft({ ...emptyHistoryFilters }); setError(""); }}>Сбросить</button><button className="button primary"><Check size={17} />Применить</button></div>
    </form>
  </Modal>;
}

function HistoryView({ onUnauthorized, revision }: { onUnauthorized: () => void; revision: number }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<HistoryFilters>({ ...emptyHistoryFilters });
  const [filterOpen, setFilterOpen] = useState(false);
  const requestId = useRef(0);
  const count = Object.values(filters).filter(Boolean).length;
  const load = useCallback(async (cursor?: string) => {
    const currentRequest = ++requestId.current;
    setLoading(true); setError("");
    if (!cursor) { setEvents([]); setNextCursor(null); }
    const params = new URLSearchParams();
    if (cursor) params.set("before", cursor);
    if (filters.action) params.set("action", filters.action);
    if (filters.from) params.set("from", localDateBoundary(filters.from));
    if (filters.to) params.set("to", localDateBoundary(filters.to, true));
    try {
      const data = await api<AuditResponse>(`/audit?${params}`);
      if (currentRequest !== requestId.current) return;
      setEvents(previous => cursor ? [...previous, ...data.events] : data.events); setNextCursor(data.nextCursor);
    } catch (failure) {
      if (currentRequest !== requestId.current) return;
      if (failure instanceof ApiError && failure.status === 401) onUnauthorized(); else setError(errorMessage(failure));
    } finally { if (currentRequest === requestId.current) setLoading(false); }
  }, [filters, onUnauthorized, revision]);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load]);
  return <section className="history-section" aria-label="История действий">
    <div className="list-heading"><h2>Хроника вашего дневника</h2><button className="button secondary filter-trigger" onClick={() => setFilterOpen(true)}><SlidersHorizontal size={18} />Фильтр{count > 0 && <span>{count}</span>}</button></div>
    <p className="history-intro">Здесь сохраняется каждый шаг: от первой задачи до последней отметки.</p>
    {count > 0 && <div className="filter-summary"><span>{[filters.action && auditLabels[filters.action], filters.from && `С ${formatDate(filters.from, true)}`, filters.to && `По ${formatDate(filters.to, true)}`].filter(Boolean).join(" · ")}</span><button className="text-button" onClick={() => setFilters({ ...emptyHistoryFilters })}>Сбросить фильтр</button></div>}
    {error && <div className="error-box" role="alert">{error}<button className="text-button" onClick={() => void load()}>Повторить</button></div>}
    {!events.length && !loading && !error && <div className="empty-state"><History size={32} strokeWidth={1} /><h3>{count ? "Подходящих действий нет" : "История начинается здесь"}</h3><p>{count ? "Измените действие или период в фильтре." : "Ваши действия появятся в этом разделе."}</p></div>}
    <ol className="audit-list">{events.map(event => <li key={event.id}>
      <span className={`audit-dot${event.action === "task.completed" ? " audit-dot-success" : ""}`}>{event.action === "task.deleted" ? <Trash2 size={16} /> : event.action === "task.completed" ? <Check size={18} /> : event.action === "task.cancelled" ? <Ban size={17} /> : event.action === "task.created" ? <Plus size={18} /> : event.action === "task.updated" ? <Pencil size={16} /> : <History size={17} />}</span>
      <div className="audit-content"><h3>{auditLabels[event.action] ?? "Действие в дневнике"}</h3>{event.taskTitle && <p>{event.taskTitle}</p>}<AuditDetails event={event} /><time dateTime={event.createdAt}>{formatDate(event.createdAt, true)} · {new Date(event.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time></div>
    </li>)}</ol>
    {loading && <div className="loading-inline"><Loader2 size={18} className="spin" />Загружаем историю…</div>}
    {nextCursor && !loading && <button className="button secondary load-more" onClick={() => void load(nextCursor)}>Показать ещё<ChevronDown size={18} /></button>}
    {filterOpen && <HistoryFilterDialog filters={filters} onApply={setFilters} onClose={() => setFilterOpen(false)} />}
  </section>;
}

function savedPreferences(userId: string): TaskPreferences {
  try { return parsePreferences(typeof window === "undefined" ? null : localStorage.getItem(`ordo:tasks:${userId}`)); }
  catch { return parsePreferences(null); }
}

function Workspace({ user, onLogout, onUserChanged }: { user: User; onLogout: () => void; onUserChanged: (user: User) => void }) {
  const [view, setView] = useState<"tasks" | "history">("tasks");
  const [preferences, setPreferences] = useState<TaskPreferences>(() => savedPreferences(user.id));
  const { query, filters, pinnedIds } = preferences;
  const searching = Boolean(normalizeSearch(query));
  const [filterOpen, setFilterOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Task | "new" | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const completed = tasks.filter(task => task.completed).length;
  const cancelled = tasks.filter(task => task.cancelled).length;
  const active = tasks.length - completed - cancelled;
  const actionable = tasks.length - cancelled;
  const progress = actionable ? Math.round(completed / actionable * 100) : 0;
  const today = dateKey(new Date());
  const filterCount = Object.entries(filters).filter(([key, value]) => key === "status" || key === "priority" ? value !== "all" : Boolean(value)).length;
  const visible = useMemo(() => filterTasks(tasks, filters, query, pinnedIds), [tasks, filters, query, pinnedIds]);
  const loadTasks = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = await api<{ tasks: Task[] }>("/tasks"); setTasks(data.tasks); }
    catch (failure) { if (failure instanceof ApiError && failure.status === 401) onLogout(); else setError(errorMessage(failure)); }
    finally { setLoading(false); }
  }, [onLogout]);
  useEffect(() => { void loadTasks(); }, [loadTasks]);
  useEffect(() => {
    try { localStorage.setItem(`ordo:tasks:${user.id}`, JSON.stringify(preferences)); } catch { /* Storage can be unavailable in a private browser profile. */ }
  }, [preferences, user.id]);
  useEffect(() => {
    if (loading || !searching) return;
    const matches = tasks.filter(task => matchesSearch(task, query)).map(task => task.id);
    setPreferences(previous => {
      if (previous.query !== query || matches.every(id => previous.pinnedIds.includes(id))) return previous;
      return { ...previous, pinnedIds: [...new Set([...previous.pinnedIds, ...matches])] };
    });
  }, [tasks, loading, searching, query]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(timer); }, [notice]);
  function setQuery(value: string) { setPreferences(previous => ({ ...previous, query: value, pinnedIds: [] })); }
  function setFilters(value: TaskFilters) { setPreferences(previous => ({ ...previous, filters: value })); }
  async function saveTask(data: TaskInput) {
    try {
      const editing = editor !== "new" && editor !== null;
      const result = await api<{ task: Task }>(editing ? `/tasks/${editor.id}` : "/tasks", editing ? "PATCH" : "POST", data);
      setTasks(previous => editing ? previous.map(task => task.id === result.task.id ? result.task : task) : [result.task, ...previous]);
      setNotice(editing ? "Изменения сохранены" : "Задача добавлена в дневник"); setError("");
    } catch (failure) { if (failure instanceof ApiError && failure.status === 401) onLogout(); throw failure; }
  }
  async function changeStatus(task: Task, status: Exclude<TaskStatus, "all">) {
    setPendingId(task.id); setError("");
    try {
      const result = await api<{ task: Task }>(`/tasks/${task.id}`, "PATCH", { completed: status === "completed", cancelled: status === "cancelled" });
      setTasks(previous => previous.map(item => item.id === task.id ? result.task : item));
      setNotice(status === "completed" ? "Ещё один шаг сделан" : status === "cancelled" ? "Задача отменена. Её можно вернуть в работу." : "Задача возвращена в работу");
    } catch (failure) { if (failure instanceof ApiError && failure.status === 401) onLogout(); else setError(errorMessage(failure)); }
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
  const filterSummary = [
    filters.status !== "all" && statusOptions.find(option => option.value === filters.status)?.label,
    filters.priority !== "all" && `${priorityLabels[filters.priority]} приоритет`,
    filters.createdFrom && `Добавлена с ${formatDate(filters.createdFrom)}`,
    filters.createdTo && `Добавлена по ${formatDate(filters.createdTo)}`,
    filters.dueFrom && `Срок с ${formatDate(filters.dueFrom)}`,
    filters.dueTo && `Срок по ${formatDate(filters.dueTo)}`,
  ].filter(Boolean).join(" · ");
  return <div className="workspace">
    <aside className="sidebar">
      <Brand />
      <div className="sidebar-section-label">ЛИЧНОЕ ПРОСТРАНСТВО</div>
      <nav className="main-nav" aria-label="Разделы дневника">
        <button className={view === "tasks" ? "selected" : ""} onClick={() => setView("tasks")}><LayoutList size={20} strokeWidth={1.5} /><span>Мои задачи</span><span className="nav-count">{tasks.length}</span></button>
        <button className={view === "history" ? "selected" : ""} onClick={() => setView("history")}><History size={20} strokeWidth={1.5} /><span>История действий</span></button>
      </nav>
      <div className="sidebar-note"><BookOpen size={22} strokeWidth={1.2} /><p>Каждый большой результат<br />начинается с маленького<br /><em>«сделано».</em></p><span>ОДНА ЗАДАЧА ЗА РАЗ</span></div>
      <div className="profile">
        <div className="profile-identity"><span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span><div className="profile-details"><strong>{user.username}</strong><span>Личный аккаунт</span></div></div>
        <div className="profile-actions">
          <button className="profile-action" aria-label="Настройки аккаунта" onClick={() => setAccountOpen(true)} disabled={loggingOut}><Settings size={18} /><span>Аккаунт</span></button>
          <button className="profile-action profile-logout" aria-label="Выйти из аккаунта" onClick={logout} disabled={loggingOut}>{loggingOut ? <Loader2 size={18} className="spin" /> : <LogOut size={18} />}<span>Выйти</span></button>
        </div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div><span className="breadcrumb">Дневник</span><span className="breadcrumb-divider">/</span><span>{view === "tasks" ? "Мои задачи" : "История действий"}</span></div><span className="topbar-date"><CalendarDays size={17} strokeWidth={1.5} />{formatDate(new Date().toISOString(), true)}</span></header>
      <main className="workspace-main">
        <section className="page-heading"><div><span className="eyebrow">{view === "tasks" ? "ПЛАНЫ, КОТОРЫЕ СТАНОВЯТСЯ ДЕЛАМИ" : "КАЖДОЕ ДЕЙСТВИЕ ИМЕЕТ ЗНАЧЕНИЕ"}</span><h1>{view === "tasks" ? "Всё начинается с плана." : "История ваших шагов."}</h1><p>{view === "tasks" ? "Освободите мысли. Сосредоточьтесь на важном." : "Прозрачная хроника изменений — всегда под рукой."}</p></div>{view === "tasks" && <button className="button primary new-task-button" onClick={() => setEditor("new")}><Plus size={20} />Новая задача</button>}</section>
        {error && <div className="error-box workspace-error" role="alert">{error}<button className="text-button" onClick={() => void loadTasks()}>Повторить загрузку</button></div>}
        {view === "tasks" ? <>
          <section className="overview" aria-label="Ваш прогресс">
            <div className="stat"><span>ВСЕГО ЗАДАЧ</span><strong>{loading ? "—" : String(tasks.length).padStart(2, "0")}</strong><LayoutList size={22} strokeWidth={1.2} /></div>
            <div className="stat"><span>В РАБОТЕ</span><strong>{loading ? "—" : String(active).padStart(2, "0")}</strong><Circle size={22} strokeWidth={1.2} /></div>
            <div className="stat"><span>ВЫПОЛНЕНО</span><strong>{loading ? "—" : String(completed).padStart(2, "0")}</strong><CheckCheck size={24} strokeWidth={1.2} /></div>
            <div className="stat"><span>ОТМЕНЕНО</span><strong>{loading ? "—" : String(cancelled).padStart(2, "0")}</strong><Ban size={22} strokeWidth={1.2} /></div>
            <div className="progress-stat"><div><span>ВАШ ПРОГРЕСС</span><strong>{progress}<small>%</small></strong></div><div className="progress-track" role="progressbar" aria-label="Выполненные задачи без учёта отменённых" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div><p>{tasks.length === 0 ? "Первый шаг — добавить задачу" : progress === 100 ? "Всё сделано. Время выдохнуть." : "Отменённые задачи не учитываются"}</p></div>
          </section>
          <section className="tasks-section" aria-label="Список задач">
            <div className="task-toolbar">
              <div className="filter-tabs" aria-label="Статус задач">{([["all", "Все", tasks.length], ["active", "В работе", active], ["completed", "Выполнено", completed], ["cancelled", "Отменено", cancelled]] as const).map(([value, label, count]) => <button key={value} className={filters.status === value ? "active" : ""} aria-pressed={filters.status === value} onClick={() => setFilters({ ...filters, status: value })}>{label}<span>{count}</span></button>)}</div>
              <button className="button secondary filter-trigger" onClick={() => setFilterOpen(true)}><SlidersHorizontal size={18} />Фильтр{filterCount > 0 && <span>{filterCount}</span>}</button>
              <div className="search-box"><Search size={20} strokeWidth={1.5} /><input aria-label="Поиск задач" placeholder="Найти задачу…" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" />{query && <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")}><X size={18} /></button>}</div>
            </div>
            {filterCount > 0 && <div className="filter-summary"><span>{filterSummary}</span><button className="text-button" onClick={() => setFilters({ ...emptyFilters })}>Сбросить фильтры</button></div>}
            {searching && <p className="search-help" role="status">Найденные задачи остаются здесь до очистки поиска, даже после выполнения или отмены. Поиск сохранится после обновления страницы.</p>}
            {loading ? <div className="empty-state"><Loader2 size={30} className="spin" strokeWidth={1} /><p>Открываем ваш дневник…</p></div> : !visible.length ? <div className="empty-state">
              <span className="empty-illustration"><BookOpen size={37} strokeWidth={1} /><span /></span><span className="section-marker">{tasks.length ? "ПРОСТРАНСТВО ДЛЯ НОВОГО" : "ВАША ПЕРВАЯ СТРАНИЦА"}</span>
              <h2>{searching ? "Пока ничего не нашлось" : filterCount ? "Нет задач по этому фильтру" : "Место для ваших планов"}</h2>
              <p>{searching ? "Проверьте слова в поиске или измените фильтры." : filterCount ? "Измените приоритет, статус или период." : "Запишите то, что давно держите в голове. Даже большое дело начинается с одной строки."}</p>
              {!searching && !tasks.length && <button className="button primary" onClick={() => setEditor("new")}><Plus size={18} />Добавить первую задачу</button>}
              {searching && <button className="button secondary" onClick={() => setQuery("")}>Очистить поиск</button>}
            </div> : <div className="task-list">{visible.map(task => <article key={task.id} className={`task-row${task.completed ? " task-completed" : ""}${task.cancelled ? " task-cancelled" : ""}`}>
              <button className="task-checkbox" role="checkbox" aria-checked={task.completed} aria-label={`${task.completed || task.cancelled ? "Вернуть в работу" : "Выполнить"}: ${task.title}`} disabled={pendingId !== null} onClick={() => void changeStatus(task, task.completed || task.cancelled ? "active" : "completed")}>{pendingId === task.id ? <Loader2 size={18} className="spin" /> : task.completed ? <Check size={18} strokeWidth={2} /> : task.cancelled ? <Ban size={18} /> : null}</button>
              <div className="task-content">
                <button className="task-title" onClick={() => setEditor(task)} disabled={pendingId !== null}>{task.title}</button>
                {task.description && <p className="task-description">{task.description}</p>}
                <div className="task-meta">
                  <span className={`priority priority-${task.priority}`}><Flag size={14} />{priorityLabels[task.priority]} приоритет</span>
                  {task.dueDate && <span className={`task-date${!task.completed && !task.cancelled && task.dueDate < today ? " overdue" : ""}`}><CalendarDays size={14} />{formatDate(task.dueDate)}{!task.completed && !task.cancelled && task.dueDate < today ? " · срок прошёл" : ""}</span>}
                  <span className={task.completed ? "completed-tag" : task.cancelled ? "cancelled-tag" : "status-tag"}>{task.completed ? "Выполнено" : task.cancelled ? "Отменено" : "В работе"}</span>
                  <button className="task-state-action" onClick={() => void changeStatus(task, task.cancelled ? "active" : "cancelled")} disabled={pendingId !== null} aria-label={`${task.cancelled ? "Вернуть в работу" : "Отменить задачу"}: ${task.title}`}>{task.cancelled ? <RotateCcw size={14} /> : <Ban size={14} />}{task.cancelled ? "Вернуть в работу" : "Отменить"}</button>
                </div>
              </div>
              <div className="task-actions"><button className="icon-button" aria-label={`Редактировать: ${task.title}`} onClick={() => setEditor(task)} disabled={pendingId !== null}><Pencil size={19} strokeWidth={1.5} /></button><button className="icon-button delete-button" aria-label={`Удалить: ${task.title}`} onClick={() => setDeleting(task)} disabled={pendingId !== null}><Trash2 size={19} strokeWidth={1.5} /></button></div>
            </article>)}<button className="inline-add" onClick={() => setEditor("new")}><Plus size={20} />Добавить задачу<span>Ещё один шаг к важному</span></button></div>}
            <div className="list-footer"><span><ShieldCheck size={15} />Ваши задачи доступны только вам</span><span>Показано {visible.length} из {tasks.length}</span></div>
          </section>
          <div className="bottom-note"><span className="note-line" /><BookOpen size={19} strokeWidth={1.2} /><span>Не всё сразу. Главное — начать.</span><span className="note-line" /></div>
        </> : <HistoryView onUnauthorized={onLogout} revision={historyRevision} />}
      </main>
      <footer className="workspace-footer"><span>ORDO <span className="footer-dot">·</span> Личный дневник дел</span><span>Упорядочивая день, создаём будущее.</span></footer>
    </div>
    {notice && <div className="toast" role="status"><Check size={18} />{notice}<button aria-label="Скрыть уведомление" onClick={() => setNotice("")}><X size={18} /></button></div>}
    {editor !== null && <TaskEditor task={editor === "new" ? null : editor} onSave={saveTask} onClose={() => setEditor(null)} />}
    {deleting && <DeleteDialog task={deleting} onDelete={deleteTask} onClose={() => setDeleting(null)} />}
    {filterOpen && <TaskFilterDialog filters={filters} onApply={setFilters} onClose={() => setFilterOpen(false)} />}
    {accountOpen && <AccountSettings user={user} onUserChanged={onUserChanged} onSaved={() => setHistoryRevision(previous => previous + 1)} onUnauthorized={onLogout} onClose={() => setAccountOpen(false)} />}
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
  return user ? <Workspace key={user.id} user={user} onLogout={logout} onUserChanged={setUser} /> : <AuthScreen onAuthenticated={setUser} />;
}
