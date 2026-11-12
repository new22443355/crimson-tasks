export type Priority = "normal" | "high" | "low";
export type TaskStatus = "all" | "active" | "completed" | "cancelled";
export type FilterableTask = {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  completed: boolean;
  cancelled: boolean;
  createdAt: string;
  dueDate: string | null;
};
export type TaskFilters = {
  status: TaskStatus;
  priority: "all" | Priority;
  createdFrom: string;
  createdTo: string;
  dueFrom: string;
  dueTo: string;
};
export type TaskPreferences = { query: string; pinnedIds: string[]; filters: TaskFilters };

export const emptyFilters: TaskFilters = {
  status: "all", priority: "all", createdFrom: "", createdTo: "", dueFrom: "", dueTo: "",
};

export function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").normalize("NFD").replace(/\p{M}/gu, "").trim();
}

export function matchesSearch(task: Pick<FilterableTask, "title" | "description">, query: string): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const text = normalizeSearch(`${task.title} ${task.description}`);
  return words.every(word => text.includes(word));
}

export function dateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function filterTasks<T extends FilterableTask>(tasks: T[], filters: TaskFilters, query: string, pinnedIds: readonly string[]): T[] {
  const searching = Boolean(normalizeSearch(query));
  const pinned = new Set(pinnedIds);
  return tasks.filter(task => {
    if (filters.priority !== "all" && task.priority !== filters.priority) return false;
    const created = dateKey(task.createdAt);
    if ((filters.createdFrom && created < filters.createdFrom) || (filters.createdTo && created > filters.createdTo)) return false;
    if ((filters.dueFrom || filters.dueTo) && !task.dueDate) return false;
    if (task.dueDate && ((filters.dueFrom && task.dueDate < filters.dueFrom) || (filters.dueTo && task.dueDate > filters.dueTo))) return false;
    if (searching) return matchesSearch(task, query) || pinned.has(task.id);
    if (filters.status === "active") return !task.completed && !task.cancelled;
    if (filters.status === "completed") return task.completed;
    if (filters.status === "cancelled") return task.cancelled;
    return true;
  });
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function parsePreferences(raw: string | null): TaskPreferences {
  const fallback: TaskPreferences = { query: "", pinnedIds: [], filters: { ...emptyFilters } };
  if (!raw) return fallback;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return fallback;
    const source = saved as Record<string, unknown>;
    const values = source.filters && typeof source.filters === "object" ? source.filters as Record<string, unknown> : {};
    const filters = { ...emptyFilters };
    if (["all", "active", "completed", "cancelled"].includes(String(values.status))) filters.status = values.status as TaskStatus;
    if (["all", "normal", "high", "low"].includes(String(values.priority))) filters.priority = values.priority as TaskFilters["priority"];
    for (const key of ["createdFrom", "createdTo", "dueFrom", "dueTo"] as const) {
      if (validDate(values[key])) filters[key] = values[key];
    }
    if (filters.createdFrom > filters.createdTo && filters.createdTo) { filters.createdFrom = ""; filters.createdTo = ""; }
    if (filters.dueFrom > filters.dueTo && filters.dueTo) { filters.dueFrom = ""; filters.dueTo = ""; }
    return {
      query: typeof source.query === "string" ? source.query.slice(0, 200) : "",
      pinnedIds: Array.isArray(source.pinnedIds) ? source.pinnedIds.filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)).slice(0, 10_000) : [],
      filters,
    };
  } catch { return fallback; }
}

export function localDateBoundary(value: string, followingDay = false): string {
  const date = new Date(`${value}T00:00:00`);
  if (followingDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function capitalizeLines(value: string): string {
  return value.replace(/(^|\n)([^\p{L}\n]*)(\p{Ll})/gu, (_match, start: string, prefix: string, letter: string) => `${start}${prefix}${letter.toLocaleUpperCase("ru-RU")}`);
}
