// Converts the database of the old Arc Mode artifact (exported per collection as JSON
// files: <dir>/<collection>/<id>.json) into the Arc Mode 3 import format.
// Usage: node scripts/convert-old.mjs <dir> <today YYYY-MM-DD> > out.json
import fs from "node:fs"; import path from "node:path";
const [dir, today] = process.argv.slice(2);
const read = c => { const p = path.join(dir, c); if (!fs.existsSync(p)) return {}; return Object.fromEntries(fs.readdirSync(p).filter(f => f.endsWith(".json")).map(f => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(p, f), "utf8"))])); };
const old = Object.fromEntries(["subjects", "blocks", "todos", "events", "habits", "habitlog", "timelog", "meta"].map(c => [c, read(c)]));
const VAR = { "var(--c-fl)": "#f4a993", "var(--c-mathe)": "#93c0ee", "var(--c-bilanz)": "#9fd8b4", "var(--c-optik)": "#f0cf74", "var(--c-x)": "#c8bbf1" };
const SHORT = { fl: "FL", mathe: "Mathe", bilanz: "Bilanz", optik: "Optik", akustik: "Akustik", et: "ET", hgr: "HGR", ipsm: "IPSM", makro: "Makro", moser: "Moser", pm: "PM", steuer: "Steuer", tv: "Tech. Vertrieb" };
const tags = Object.entries(old.subjects).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0)).map(([id, s]) => ({ id, name: SHORT[id] || s.name, color: VAR[s.color] || s.color || "#c8bbf1" }));
const extra = [["uni", "Uni", "#b9c8f5"], ["jlk", "JLK", "#f6c1a8"], ["privat", "Privat", "#a9dcc0"], ["gym", "Gym", "#e8b4d8"], ["bibel", "Bibel", "#e9d7a6"]];
extra.forEach(([id, name, color]) => { if (!tags.some(t => t.id === id)) tags.push({ id, name, color }); });
const tasks = {}, events = {};
let skippedPast = 0;
for (const [id, b] of Object.entries(old.blocks)) {
  const done = b.status === "done" || b.done === true;
  if (b.date < today && !done) { skippedPast++; continue; } // missed blocks are not carried over
  if (b.status === "skipped" && b.date < today) { skippedPast++; continue; }
  tasks[id] = { title: b.title, tags: b.subjectId ? [b.subjectId] : [], prio: 2, due: b.date, focusDate: null, status: done ? "done" : "", done, doneAt: done ? (b.doneAt || b.date + "T12:00:00") : null, note: b.note || "", source: "arc2-block", created: b.date + "T00:00:00", plannedTime: b.time || null };
}
for (const [id, t] of Object.entries(old.todos)) {
  const done = t.status === "done" || t.done === true;
  const tg = [t.list].filter(Boolean); if (t.homework) tg.push("uni");
  tasks[id] = { title: t.title.replace(/^\d+\s*·\s*/, ""), tags: [...new Set(tg)], prio: 2, due: t.due || null, focusDate: null, status: done ? "done" : "", done, doneAt: done ? t.doneAt || null : null, note: t.note || "", source: "arc2-todo", created: (t.due || today) + "T00:00:00", plannedTime: t.time || null };
}
for (const [id, e] of Object.entries(old.events)) {
  events[id] = { title: e.title, kind: e.kind || "termin", date: e.date, endDate: e.endDate || null, time: e.time || "", endTime: e.endTime || "", short: e.short || "", countdown: e.countdown ?? (e.kind === "klausur"), status: e.status === "cancelled" ? "cancelled" : e.status === "done" ? "done" : "", source: e.source || "arc2" };
}
const habits = Object.fromEntries(Object.entries(old.habits).map(([id, h]) => [id, { ...h, created: "2026-10-14" }]));
const meta = {};
if (old.meta.verses) meta.verses = old.meta.verses;
meta.settings = { tags, reminders: { planTime: "07:30", eveningTime: "21:30", eventLead: 30 } };
const out = { app: "arc-mode", version: 3, exported: new Date().toISOString(), data: { tasks, events, habits, habitlog: old.habitlog, timelog: old.timelog, meta, state: {} } };
process.stdout.write(JSON.stringify(out));
const open = Object.values(tasks).filter(t => !t.done);
console.error(JSON.stringify({ tasks: Object.keys(tasks).length, open: open.length, done: Object.values(tasks).filter(t => t.done).length, droppedMissedBlocks: skippedPast, events: Object.keys(events).length, habits: Object.keys(habits).length, tags: tags.length }));
