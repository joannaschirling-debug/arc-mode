// Domain logic: tasks (pool + today's focus), events, routines, tags, reminders.
import { S, put, putMany, delMany, all } from "./store.js";
import { ymd, today, addDays, mondayOf, parse, uid, minutesOf, daysUntil } from "./util.js";
import { deviceEvents, schedule, cancel, pendingIds } from "./native.js";

export const DEFAULT_TAGS = [
  { id: "fl", name: "FL", color: "#f4a993" }, { id: "mathe", name: "Mathe", color: "#93c0ee" },
  { id: "bilanz", name: "Bilanz", color: "#9fd8b4" }, { id: "optik", name: "Optik", color: "#f0cf74" },
  { id: "uni", name: "Uni", color: "#b9c8f5" }, { id: "jlk", name: "JLK", color: "#f6c1a8" }, { id: "privat", name: "Privat", color: "#a9dcc0" }
];
export const settings = () => S.meta.settings || {};
export const tags = () => settings().tags || DEFAULT_TAGS;
export const tag = id => tags().find(t => t.id === id) || { id, name: id, color: "var(--c-x)" };
export const saveSettings = patch => put("meta", "settings", { ...settings(), ...patch });

/* ---------- tasks ---------- */
export const isDone = t => t.status === "done";
export const openTasks = () => all("tasks").filter(t => !isDone(t));
export const focusTasks = (d = today()) => all("tasks").filter(t => t.focusDate === d).sort(byPrio);
export const byPrio = (a, b) => (a.prio || 2) - (b.prio || 2) || (a.due || "9999").localeCompare(b.due || "9999") || (a.created || "").localeCompare(b.created || "");
export const overdue = () => openTasks().filter(t => t.due && t.due < today());
export function poolGroups(filterTag = null) {
  const t = today(), ws = mondayOf(t), we = addDays(ws, 6);
  const list = openTasks().filter(x => x.focusDate !== t && (!filterTag || (x.tags || []).includes(filterTag))).sort(byPrio);
  return {
    "Überfällig": list.filter(x => x.due && x.due < t),
    "Diese Woche": list.filter(x => x.due && x.due >= t && x.due <= we),
    "Später": list.filter(x => x.due && x.due > we),
    "Ohne Datum": list.filter(x => !x.due)
  };
}
export function newTask(data) {
  const id = uid("t");
  return put("tasks", id, { title: "", tags: [], prio: 2, due: null, focusDate: null, status: "", note: "", created: new Date().toISOString(), source: "app", ...data });
}
export function toggleTask(id) {
  const t = S.tasks[id]; if (!t) return;
  const done = !isDone(t);
  put("tasks", id, { status: done ? "done" : "", done, doneAt: done ? new Date().toISOString() : null });
  return done;
}
// Unfinished focus items from earlier days quietly go back to the pool.
export function rollOverFocus() {
  const t = today();
  const items = all("tasks").filter(x => x.focusDate && x.focusDate < t && !isDone(x)).map(x => ({ col: "tasks", id: x.id, data: { focusDate: null, bumped: (x.bumped || 0) + 1 } }));
  if (items.length) putMany(items);
  return items.length;
}
export function deleteOverdue() {
  const list = overdue(); const backup = list.map(x => ({ ...x }));
  delMany(list.map(x => ({ col: "tasks", id: x.id })));
  return backup;
}
export function restore(backup) { putMany(backup.map(({ id, ...d }) => ({ col: "tasks", id, data: d, merge: false }))); }

/* ---------- events (own + phone calendar) ---------- */
export const ownEvents = () => all("events");
export const hasCountdown = e => e.countdown ?? (e.kind === "klausur" || e.kind === "pruefung");
export function countdowns() {
  const t = today();
  return ownEvents().filter(e => (e.endDate || e.date) >= t && e.status !== "cancelled" && hasCountdown(e))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "")).slice(0, 10);
}
let devCache = { key: "", list: [] };
export async function refreshDeviceEvents(from, days) {
  if (!settings().calendarOn) { devCache = { key: "", list: [] }; return []; }
  const a = parse(from), b = parse(addDays(from, days));
  const list = await deviceEvents(a, b);
  const hidden = new Set(settings().hiddenCalendars || []);
  devCache = { key: from + ":" + days, list: list.filter(e => !hidden.has(e.calendarId)) };
  return devCache.list;
}
const ymdOf = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hmOf = d => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
// Unified list for one day: {id,title,time,endTime,allDay,kind,device,ref}
export function appointmentsOn(d) {
  const own = ownEvents().filter(e => e.date === d || (e.endDate && e.date <= d && e.endDate >= d)).map(e => ({
    id: e.id, title: e.title, time: e.date === d ? e.time || "" : "", endTime: e.endTime || "", allDay: !e.time || e.date !== d, kind: e.kind || "termin", device: false, ref: e
  }));
  const ownKeys = new Set(own.map(e => (e.title + e.time).toLowerCase()));
  const dev = devCache.list.filter(e => ymdOf(e.start) <= d && ymdOf(new Date(e.end - 1)) >= d).map(e => ({
    id: e.id, title: e.title, time: !e.allDay && ymdOf(e.start) === d ? hmOf(e.start) : "", endTime: !e.allDay ? hmOf(e.end) : "", allDay: e.allDay || ymdOf(e.start) !== d, kind: "termin", device: true, location: e.location, ref: e
  })).filter(e => !ownKeys.has((e.title + e.time).toLowerCase()) && !own.some(o => o.ref.devId && "dev:" + o.ref.devId === e.id));
  return [...own, ...dev].sort((a, b) => (a.allDay ? "00" : a.time || "99").localeCompare(b.allDay ? "00" : b.time || "99"));
}
export function newEvent(data) { const id = uid("e"); return put("events", id, { title: "", date: today(), time: "", kind: "termin", status: "", source: "app", ...data }); }

/* ---------- routines ---------- */
export const habits = () => all("habits").sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const habitsFor = (phase, d) => habits().filter(h => h.phase === phase && (!h.days?.length || h.days.includes(parse(d).getDay())));
export const habitState = (d, id) => S.habitlog[d]?.done?.[id]; // true | "skip" | undefined
export function cycleHabit(d, id) {
  const cur = habitState(d, id), next = cur === true ? "skip" : cur === "skip" ? undefined : true;
  const done = { ...(S.habitlog[d]?.done || {}) };
  if (next === undefined) delete done[id]; else done[id] = next;
  put("habitlog", d, { done });
  return next;
}
export function routineFrac(phase, d) {
  const hs = habitsFor(phase, d); if (!hs.length) return null;
  return hs.filter(h => habitState(d, h.id) === true).length / hs.length;
}
export function routineStreak(phase) {
  let d = today(), n = 0;
  if ((routineFrac(phase, d) ?? 0) < 1) d = addDays(d, -1);
  for (let guard = 0; guard < 400; guard++) { const f = routineFrac(phase, d); if (f !== null) { if (f < 1) break; n++; } d = addDays(d, -1); }
  return n;
}
export function habitRate(id, days = 30) {
  const h = S.habits[id]; if (!h) return { done: 0, total: 0 };
  let done = 0, total = 0;
  for (let i = 0; i < days; i++) { const d = addDays(today(), -i); if (h.days?.length && !h.days.includes(parse(d).getDay())) continue; if (h.created && d < h.created.slice(0, 10)) continue; total++; if (habitState(d, id) === true) done++; }
  return { done, total };
}

/* ---------- time log ---------- */
export const focusOn = d => (S.timelog[d]?.entries || []).reduce((a, e) => a + (e.focusMin || 0), 0);
export function weekFocus(ws = mondayOf(today())) { let m = 0; for (let i = 0; i < 7; i++) m += focusOn(addDays(ws, i)); return m; }
export function logSession(entry) {
  const d = ymd(new Date(entry.start));
  const entries = [...(S.timelog[d]?.entries || []), entry];
  put("timelog", d, { entries });
}
export function dayProgress(d = today()) {
  const r = [...habitsFor("morning", d), ...habitsFor("evening", d)];
  const f = focusTasks(d);
  return { total: r.length + f.length, done: r.filter(h => habitState(d, h.id) === true).length + f.filter(isDone).length };
}

/* ---------- reminders (re-planned on every app start / resume) ---------- */
// ids: 1000-1013 plan reminder, 1100-1113 evening routine, 2000-2999 events, 9001 timer
export async function planReminders() {
  const r = settings().reminders || {};
  const old = (await pendingIds()).filter(id => id >= 1000 && id < 3000);
  if (old.length) await cancel(old);
  if (r.off) return;
  const t = today();
  for (let i = 0; i < 7; i++) {
    const d = addDays(t, i), date = parse(d);
    if (r.planTime) { const [h, m] = r.planTime.split(":").map(Number); const at = new Date(date); at.setHours(h, m, 0, 0); await schedule(1000 + i, at, "Heute-Fokus wählen", "Welche 2–4 Sachen ziehst du heute aus dem Pool?"); }
    if (r.eveningTime && habitsFor("evening", d).length) { const [h, m] = r.eveningTime.split(":").map(Number); const at = new Date(date); at.setHours(h, m, 0, 0); await schedule(1100 + i, at, "Abendroutine", "Zeit für deine Abendroutine."); }
  }
  const lead = r.eventLead ?? 30; let n = 0;
  for (const e of ownEvents()) {
    if (!e.time || e.date < t || daysUntil(e.date) > 7 || e.status === "cancelled" || n > 900) continue;
    const at = new Date(parse(e.date)); at.setHours(0, minutesOf(e.time) - lead, 0, 0);
    await schedule(2000 + n++, at, e.title, `Beginnt um ${e.time}${e.place ? " · " + e.place : ""}`);
  }
}
