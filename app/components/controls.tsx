"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

type FieldProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
};

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) closeRef.current();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return ref;
}

export function SelectField({ id, name, value, onChange, options, disabled = false, label }: FieldProps & {
  options: readonly { value: string; label: string }[];
}) {
  const generatedId = useId();
  const controlId = id ?? `select-${generatedId}`;
  const listId = `${controlId}-options`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", time: 0 });
  const root = useOutsideClose(open, () => setOpen(false));
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>(`[data-option="${active}"]`)?.focus();
  }, [open, active]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function show() {
    setActive(Math.max(0, options.findIndex(option => option.value === value)));
    setOpen(true);
  }
  function choose(nextValue: string) { onChange(nextValue); close(); }
  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (!open || !options.length) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); setActive(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typed.current = { text: now - typed.current.time < 700 ? typed.current.text + event.key : event.key, time: now };
      const index = options.findIndex(option => option.label.toLocaleLowerCase("ru-RU").startsWith(typed.current.text.toLocaleLowerCase("ru-RU")));
      if (index >= 0) { event.preventDefault(); setActive(index); }
    }
  }

  return <div ref={root} className={`field-control select-field${open ? " is-open" : ""}`} onKeyDown={move}>
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    <button ref={trigger} id={controlId} type="button" className="field-trigger" aria-label={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} disabled={disabled}
      onClick={() => open ? close() : show()}
      onKeyDown={event => { if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); show(); } }}>
      <span>{selected?.label ?? "Выберите значение"}</span><ChevronDown size={18} aria-hidden="true" />
    </button>
    {open && <div ref={panel} id={listId} role="listbox" aria-label={label} aria-labelledby={label ? undefined : controlId} className="control-panel select-options">
      {options.map((option, index) => <button type="button" role="option" aria-selected={option.value === value}
        className={`select-option${option.value === value ? " is-selected" : ""}`} key={option.value}
        data-option={index} tabIndex={index === active ? 0 : -1} onFocus={() => setActive(index)} onClick={() => choose(option.value)}>
        <span>{option.label}</span>{option.value === value && <Check size={17} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}

function dateAt(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month, day);
  return date;
}
function today(): Date {
  const date = new Date();
  return dateAt(date.getFullYear(), date.getMonth(), date.getDate());
}
function dateKey(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
function parsedDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999) return null;
  const date = dateAt(year, month - 1, day);
  return dateKey(date) === value ? date : null;
}
function shiftedMonth(date: Date, difference: number): Date {
  const first = dateAt(date.getUTCFullYear(), date.getUTCMonth() + difference, 1);
  const lastDay = dateAt(first.getUTCFullYear(), first.getUTCMonth() + 1, 0).getUTCDate();
  return dateAt(first.getUTCFullYear(), first.getUTCMonth(), Math.min(lastDay, date.getUTCDate()));
}
const dateLabel = (date: Date) => date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function DatePicker({ id, name, value, onChange, disabled = false, placeholder = "Выбрать дату", label }: FieldProps & { placeholder?: string }) {
  const generatedId = useId();
  const controlId = id ?? `date-${generatedId}`;
  const panelId = `${controlId}-calendar`;
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(() => dateKey(parsedDate(value) ?? today()));
  const [month, setMonth] = useState(() => parsedDate(value) ?? today());
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const root = useOutsideClose(open, () => setOpen(false));
  const chosen = parsedDate(value);
  const currentDay = dateKey(today());
  const firstDay = dateAt(month.getUTCFullYear(), month.getUTCMonth(), 1);
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => dateAt(month.getUTCFullYear(), month.getUTCMonth(), index - mondayOffset + 1));
  const monthName = month.toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [open, focused]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  function close() { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  function show() {
    const date = parsedDate(value) ?? today();
    setMonth(date); setFocused(dateKey(date)); setOpen(true);
  }
  function choose(nextValue: string) { onChange(nextValue); close(); }
  function navigateMonth(amount: number) {
    const next = shiftedMonth(month, amount);
    if (next.getUTCFullYear() >= 1 && next.getUTCFullYear() <= 9999) { setMonth(next); setFocused(dateKey(next)); }
  }
  function calendarKeys(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    let next: Date | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") {
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
      next = dateAt(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + delta);
    } else if (event.key === "Home" || event.key === "End") {
      const offset = (date.getUTCDay() + 6) % 7;
      next = dateAt(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + (event.key === "Home" ? -offset : 6 - offset));
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      next = shiftedMonth(date, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1));
    }
    if (next) {
      event.preventDefault();
      if (next.getUTCFullYear() >= 1 && next.getUTCFullYear() <= 9999) { setMonth(next); setFocused(dateKey(next)); }
    }
  }

  return <div ref={root} className={`field-control date-field${open ? " is-open" : ""}`} onKeyDown={event => {
    if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    <button ref={trigger} id={controlId} type="button" className={`field-trigger${!chosen ? " is-placeholder" : ""}`}
      aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} disabled={disabled}
      onClick={() => open ? close() : show()} onKeyDown={event => {
        if (!open && event.key === "ArrowDown") { event.preventDefault(); show(); }
      }}>
      <CalendarDays size={18} aria-hidden="true" /><span>{chosen ? dateLabel(chosen) : placeholder}</span><ChevronDown size={18} aria-hidden="true" />
    </button>
    {open && <div ref={panel} id={panelId} role="dialog" aria-label={label ? `Календарь: ${label}` : "Выбор даты"} className="control-panel calendar-panel">
      <div className="calendar-heading">
        <button type="button" className="calendar-nav" aria-label="Предыдущий месяц" disabled={month.getUTCFullYear() === 1 && month.getUTCMonth() === 0} onClick={() => navigateMonth(-1)}><ChevronLeft size={19} /></button>
        <span aria-live="polite">{monthName}</span>
        <button type="button" className="calendar-nav" aria-label="Следующий месяц" disabled={month.getUTCFullYear() === 9999 && month.getUTCMonth() === 11} onClick={() => navigateMonth(1)}><ChevronRight size={19} /></button>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
      <div className="calendar-days" role="group" aria-label={monthName}>
        {days.map(date => {
          const key = dateKey(date);
          const outside = date.getUTCMonth() !== month.getUTCMonth();
          const unavailable = date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999;
          return <button key={key} data-day={key} type="button" disabled={unavailable}
            className={`calendar-day${outside ? " outside-month" : ""}${key === value ? " is-selected" : ""}${key === currentDay ? " is-today" : ""}`}
            aria-label={dateLabel(date)} aria-pressed={key === value} aria-current={key === currentDay ? "date" : undefined}
            tabIndex={key === focused ? 0 : -1} onFocus={() => setFocused(key)} onKeyDown={event => calendarKeys(event, date)} onClick={() => choose(key)}>
            {date.getUTCDate()}
          </button>;
        })}
      </div>
      <div className="calendar-footer"><button type="button" onClick={() => choose(currentDay)}>Сегодня</button><button type="button" onClick={() => choose("")}>Очистить</button></div>
    </div>}
  </div>;
}
