import "./base.css";
import "./app.css";
import { S, put, del, onChange, initStore, sync, signIn, signUp, signOut, inviteCode, exportJSON, importJSON, flush, pull } from "./store.js";
import { $, $$, esc, pad, today, addDays, parse, fmtDay, daysUntil, mondayOf, kw, hm, mmss, WD, WDL, MON, local, ring, CHEV, nowHM, minutesOf, uid } from "./util.js";
import * as M from "./model.js";
import * as TM from "./timer.js";
import { isNative, calendarAvailable, calendarPermission, listCalendars, createDeviceEvent, onResume, onBack, ensureNotifPermission, unlockAudio, keepAwake } from "./native.js";

/* ---------- ui state ---------- */
const TABS = [["heute", "Heute"], ["plan", "Plan"], ["timer", "Timer"], ["routine", "Routine"], ["mehr", "Mehr"]];
const UI = {
  tab: local.get("tab", "heute"), planTab: local.get("planTab", "pool"), filter: null, weekStart: mondayOf(today()), day: today(),
  open: local.get("open", {}), fs: false, heatWeeks: 12
};
const go = t => { UI.tab = t; local.set("tab", t); if (UI.fs && t !== "timer") UI.fs = false; render(); scrollTo(0, 0); };

/* ---------- toast with optional undo ---------- */
let toastT;
function toast(msg, undo) {
  let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.innerHTML = esc(msg) + (undo ? ' <button class="btn small" style="margin-left:8px;color:var(--fg)" id="undo">Rückgängig</button>' : "");
  t.hidden = false; clearTimeout(toastT);
  if (undo) $("#undo").onclick = () => { undo(); t.hidden = true; };
  toastT = setTimeout(() => t.hidden = true, undo ? 6000 : 2400);
}

/* ---------- shared bits ---------- */
const ICON = {
  heute: '<svg viewBox="0 0 24 24"><path d="M4 14a8 8 0 0 1 16 0"/><path d="M12 6V3M5.6 8.6 3.5 6.5M18.4 8.6l2.1-2.1M2 18h20"/></svg>',
  plan: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  timer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
  routine: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><path d="m14 17 2 2 4-4"/></svg>',
  mehr: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>'
};
const brand = () => `<div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 18a8 8 0 0 1 16 0"/></svg>Arc Mode</div>`;
const syncBadge = () => sync.enabled ? `<button class="pill" data-go="mehr" title="Sync"><span class="syncdot ${sync.status === "synchron" ? "ok" : sync.status === "offline" ? "off" : ""}"></span>${esc(sync.status)}</button>` : "";
const tagPills = ids => (ids || []).map(id => { const t = M.tag(id); return `<span class="pill"><i style="background:${esc(t.color)}"></i>${esc(t.name)}</span>`; }).join("");
const KIND = { klausur: "Klausur", pruefung: "Prüfung", abgabe: "Abgabe", termin: "Termin" };

function taskRow(t, o = {}) {
  const done = M.isDone(t), late = !done && t.due && t.due < today();
  return `<div class="item ${done ? "on" : ""} ${!done && t.prio === 1 ? "prio1" : ""}">
    <button class="check ${done ? "on" : ""}" data-act="toggleTask" data-id="${t.id}" aria-label="${esc(t.title)}: ${done ? "erledigt" : "offen"}"></button>
    <div class="tx"><span>${esc(t.title)}</span>
      <small class="num" ${late ? 'style="color:var(--bad)"' : ""}>${t.due ? (late ? "überfällig · " : "bis ") + fmtDay(t.due) : "ohne Datum"}${t.est ? " · ~" + hm(t.est) : ""}${t.bumped ? ` · ${t.bumped}× verschoben` : ""}</small>
      ${t.tags?.length ? `<div class="tags">${tagPills(t.tags)}</div>` : ""}${t.note ? `<span class="note">${esc(t.note)}</span>` : ""}</div>
    ${o.pool ? `<button class="btn small" data-act="toFocus" data-id="${t.id}" aria-label="In Heute-Fokus">+ Heute</button>` : ""}
    ${o.focus && !done ? `<button class="btn small" data-act="timerFor" data-id="${t.id}" aria-label="Timer starten">▶</button><button class="btn ghost small" data-act="unFocus" data-id="${t.id}" aria-label="Zurück in den Pool">↩</button>` : ""}
    <button class="btn ghost small" data-act="editTask" data-id="${t.id}" aria-label="Bearbeiten">⋯</button></div>`;
}

function timeline(d, items) {
  const allDay = items.filter(a => a.allDay), timed = items.filter(a => !a.allDay);
  const isToday = d === today(), nowM = minutesOf(nowHM());
  let nowShown = !isToday;
  const rows = timed.map(a => {
    let s = "";
    if (!nowShown && minutesOf(a.time) > nowM) { s += `<div class="tl-now"><span>${nowHM()}</span></div>`; nowShown = true; }
    const past = isToday && minutesOf(a.endTime || a.time) < nowM;
    s += `<div class="tl-row ${a.device ? "dev" : ""} ${past ? "past" : ""}"><span class="tl-time">${esc(a.time)}</span><span class="tl-dot" ${a.ref?.color ? `style="background:${esc(a.ref.color)}"` : ""}></span>
      <b>${esc(a.title)}</b><small>${a.endTime ? "bis " + esc(a.endTime) + " · " : ""}${a.device ? "Handy-Kalender" : KIND[a.kind] || "Termin"}${a.location ? " · " + esc(a.location) : ""}</small>
      ${!a.device ? `<button class="btn ghost small" style="position:absolute;right:0;top:6px" data-act="editEvent" data-id="${a.id}" aria-label="Termin bearbeiten">⋯</button>` : ""}</div>`;
    return s;
  }).join("");
  const tail = !nowShown && timed.length ? `<div class="tl-now"><span>${nowHM()}</span></div>` : "";
  return `${allDay.length ? `<div class="allday">${allDay.map(a => `<button class="pill" ${a.device ? "" : `data-act="editEvent" data-id="${a.id}"`}>${a.kind === "klausur" ? "📝 " : ""}${esc(a.title)}</button>`).join("")}</div>` : ""}
    ${timed.length ? `<div class="tl">${rows}${tail}</div>` : allDay.length ? "" : `<div class="empty">Keine festen Termine.</div>`}`;
}

function routineCard(phase, d = today()) {
  const cls = phase === "morning" ? "m" : "e";
  const hs = M.habitsFor(phase, d), done = hs.filter(h => M.habitState(d, h.id) === true).length;
  const h = new Date().getHours(), auto = phase === "morning" ? h < 12 : h >= 17;
  const isOpen = UI.open["r-" + phase] ?? auto;
  return `<div class="routine ${cls} ${isOpen ? "open" : ""}">
    <button class="routine-h" data-act="toggleOpen" data-id="r-${phase}" aria-expanded="${isOpen}"><span class="mini">${ring(hs.length ? done / hs.length : 0, 42, 4, phase === "morning" ? "var(--morning-ink)" : "var(--accent)")}<span class="mi">${phase === "morning" ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>'}</span></span><span class="t">${phase === "morning" ? "Morgenroutine" : "Abendroutine"}<small class="num">${done} von ${hs.length} · Serie ${M.routineStreak(phase)} Tage</small></span>${CHEV}</button>
    ${isOpen ? `<div class="items">${hs.map(x => { const st = M.habitState(d, x.id); return `<div class="item ${st === true ? "on" : st === "skip" ? "skip" : ""}"><button class="check ${st === true ? "on" : st === "skip" ? "skip" : ""}" data-act="cycleHabit" data-id="${x.id}" data-date="${d}" aria-label="${esc(x.name)}"></button><div class="tx"><span>${esc(x.name)}</span>${st === "skip" ? '<span class="stl">nicht geschafft</span>' : ""}</div></div>`; }).join("") || `<div class="empty">Heute nichts in dieser Routine.</div>`}</div>
    <div class="r-foot"><button class="btn ghost small" data-act="editRoutine" data-id="${phase}">Routine bearbeiten</button></div>` : ""}</div>`;
}

/* ---------- Heute ---------- */
function viewHeute() {
  const t = today(), d = parse(t), pr = M.dayProgress(t), focus = M.focusTasks(t);
  const appts = M.appointmentsOn(t), cds = M.countdowns(), timer = TM.T();
  const nextAppt = appts.find(a => !a.allDay && minutesOf(a.time) >= minutesOf(nowHM()));
  const nextTask = focus.find(x => !M.isDone(x));
  const h = d.getHours ? new Date().getHours() : 12, phaseCls = h < 11 ? "ph-morgen" : h < 17 ? "" : "ph-abend";
  const verses = S.meta.verses?.list || [], doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000), v = verses.length ? verses[doy % verses.length] : null;
  const ws = M.weekFocus(), mr = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(mondayOf(t), i)).filter(x => x <= t);
  const rq = mr.length ? Math.round(100 * mr.reduce((a, x) => a + ((M.routineFrac("morning", x) ?? 0) + (M.routineFrac("evening", x) ?? 0)) / 2, 0) / mr.length) : 0;
  const routines = h < 12 ? [routineCard("morning")] : h >= 17 ? [routineCard("evening")] : [];
  return `
  <div class="topbar">${brand()}${syncBadge()}</div>
  <div class="hero ${phaseCls}"><svg class="hero-deco" viewBox="0 0 300 300" aria-hidden="true"><circle cx="150" cy="150" r="60"/><circle cx="150" cy="150" r="95"/><circle cx="150" cy="150" r="130"/></svg>
    <div class="hero-top"><div><div class="eyebrow">${WDL[d.getDay()]} · KW ${kw(t)}</div><h1>${d.getDate()}. ${MON[d.getMonth()]}</h1>
      <div class="next">${nextAppt ? `<span class="muted">Nächster Termin · ${esc(nextAppt.time)}</span><b>${esc(nextAppt.title)}</b>` : nextTask ? `<span class="muted">Als Nächstes</span><b>${esc(nextTask.title)}</b>` : `<span class="muted">Keine festen Termine mehr heute.</span>`}</div></div>
      <div class="ring">${ring(pr.total ? pr.done / pr.total : 0, 100, 10, "var(--accent)")}<div class="v"><div><b class="num">${pr.done}/${pr.total}</b><small>heute erledigt</small></div></div></div></div>
    ${v ? `<div class="verse">${esc(v.text)}<cite>${esc(v.ref)}</cite></div>` : ""}
  </div>
  ${timer ? `<div class="banner"><div class="tx"><b>${timer.pausedAt ? "Timer pausiert" : timer.phase === "break" ? "Pause läuft" : "Fokus läuft"}</b> · ${esc(M.tag(timer.category).name)}</div><button class="btn primary small" data-go="timer">Öffnen</button></div>` : ""}
  ${cds.length ? `<div class="widgets" aria-label="Countdowns">${cds.map(e => { const n = Math.max(0, daysUntil(e.date)); return `<button class="w ${e.kind === "klausur" || e.kind === "pruefung" ? "exam" : ""} ${n <= 3 ? "soon" : ""}" style="border:0;text-align:left;color:inherit" data-act="editEvent" data-id="${e.id}"><span class="kind">${KIND[e.kind] || "Termin"}</span><span class="cd"><span class="big">${n === 0 ? "Heute" : n}</span><span class="unit">${n === 0 ? "" : n === 1 ? "Tag" : "Tage"}</span></span><span class="lbl">${esc(e.short || e.title)}</span></button>`; }).join("")}</div>` : ""}
  <section class="sec"><div class="sec-h"><h2>Termine heute</h2><button class="btn ghost small" data-act="newEvent" data-date="${t}">+ Termin</button></div>
    <div class="card">${timeline(t, appts)}</div></section>
  <section class="sec"><div class="sec-h"><h2>Heute-Fokus</h2><button class="btn ghost small" data-act="pickFocus">+ Aus Pool</button></div>
    <div class="card">${focus.map(x => taskRow(x, { focus: true })).join("") || `<div class="empty">Noch nichts gewählt. Zieh dir 2–4 Sachen aus dem Pool. Was du nicht schaffst, wandert morgen still zurück.</div>`}</div>
    ${focus.length && focus.length < 4 ? `<button class="add" data-act="pickFocus">+ Noch etwas aus dem Pool holen</button>` : ""}</section>
  ${routines.join("")}
  <div class="stats"><div class="stat"><span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg></span><div><b>${hm(ws)}</b><span>Lernzeit diese Woche</span></div></div>
    <div class="stat"><span class="ic fire"><svg viewBox="0 0 24 24"><path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1.5 1 3 2 3 4"/></svg></span><div><b>${rq} %</b><span>Routinen diese Woche</span></div></div></div>`;
}

/* ---------- Plan ---------- */
function viewPlan() {
  const seg = `<div class="seg" role="group">${[["pool", "Pool"], ["termine", "Termine"], ["woche", "Woche"]].map(([k, l]) => `<button data-act="planTab" data-id="${k}" aria-pressed="${UI.planTab === k}">${l}</button>`).join("")}</div>`;
  let body = "";
  if (UI.planTab === "pool") {
    const g = M.poolGroups(UI.filter), od = M.overdue().length;
    body = `<div class="chips"><button data-act="filter" data-id="" aria-pressed="${!UI.filter}">Alle</button>${M.tags().map(t => `<button data-act="filter" data-id="${t.id}" aria-pressed="${UI.filter === t.id}"><i style="width:8px;height:8px;border-radius:50%;background:${esc(t.color)}"></i>${esc(t.name)}</button>`).join("")}</div>
      <button class="add" data-act="newTask">+ Aufgabe in den Pool</button>
      ${od ? `<div class="banner" style="background:var(--bad-soft)"><div class="tx"><b>${od} überfällig</b> · alte Sachen, die nicht mehr dran sind?</div><button class="btn small danger" data-act="clearOverdue">Alle löschen</button></div>` : ""}
      ${Object.entries(g).map(([name, list]) => list.length ? `<div class="grp ${name === "Überfällig" ? "red" : ""}">${name} · ${list.length}</div><div class="card">${list.map(x => taskRow(x, { pool: true })).join("")}</div>` : "").join("")}
      ${Object.values(g).every(l => !l.length) ? `<div class="empty">Der Pool ist leer.</div>` : ""}
      ${doneRecently()}`;
  } else if (UI.planTab === "termine") {
    const t = today(), list = M.ownEvents().filter(e => (e.endDate || e.date) >= t).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    const past = M.ownEvents().filter(e => (e.endDate || e.date) < t);
    body = `<button class="add" data-act="newEvent" data-date="${t}">+ Termin, Klausur oder Abgabe</button>
      ${!settings().calendarOn && calendarAvailable ? `<div class="banner"><div class="tx">Handy-Kalender verbinden, dann erscheinen deine Termine automatisch.</div><button class="btn small primary" data-act="connectCal">Verbinden</button></div>` : ""}
      <div class="card">${list.map(e => `<div class="item"><div class="tx"><span>${esc(e.title)}</span><small class="num">${fmtDay(e.date)}${e.time ? " · " + esc(e.time) : " · ganztägig"}${e.endDate ? " bis " + fmtDay(e.endDate) : ""}${M.hasCountdown(e) ? " · Countdown" : ""}</small></div><span class="tag ${e.kind === "klausur" || e.kind === "pruefung" ? "klausur" : ""}">${KIND[e.kind] || "Termin"}</span><button class="btn ghost small" data-act="editEvent" data-id="${e.id}" aria-label="Bearbeiten">⋯</button></div>`).join("") || `<div class="empty">Keine eigenen Termine. Termine aus dem Handy-Kalender siehst du unter Heute und Woche.</div>`}</div>
      ${past.length ? `<button class="btn ghost small" data-act="clearPastEvents">${past.length} vergangene Termine aufräumen</button>` : ""}`;
  } else {
    const ws = UI.weekStart, d = UI.day;
    const days = [...Array(7)].map((_, i) => addDays(ws, i));
    const appts = M.appointmentsOn(d), due = M.openTasks().filter(x => x.due === d), doneOn = Object.values(S.tasks).filter(x => M.isDone(x) && x.doneAt?.slice(0, 10) === d);
    body = `<div class="weekhead"><button class="nav" data-act="week" data-id="-7" aria-label="Vorige Woche">‹</button><b>KW ${kw(ws)} · ${fmtDay(ws)} – ${fmtDay(addDays(ws, 6))}</b><button class="nav" data-act="week" data-id="7" aria-label="Nächste Woche">›</button></div>
      <div class="days">${days.map(x => { const n = M.appointmentsOn(x).length; return `<button class="d ${x === today() ? "today" : ""}" data-act="day" data-id="${x}" aria-pressed="${x === d}"><small>${WD[parse(x).getDay()]}</small><b>${parse(x).getDate()}</b><i>${"<u></u>".repeat(Math.min(n, 3))}</i></button>`; }).join("")}</div>
      <div class="sec-h"><h2>${WDL[parse(d).getDay()]}, ${fmtDay(d).slice(3)}</h2><button class="btn ghost small" data-act="newEvent" data-date="${d}">+ Termin</button></div>
      <div class="card">${timeline(d, appts)}</div>
      ${due.length ? `<div class="grp">Fällig an diesem Tag</div><div class="card">${due.map(x => taskRow(x, { pool: d === today() })).join("")}</div>` : ""}
      ${doneOn.length ? `<div class="grp">Erledigt</div><div class="card">${doneOn.map(x => taskRow(x)).join("")}</div>` : ""}
      ${M.focusOn(d) ? `<p class="muted" style="padding-left:4px">Gelernt: ${hm(M.focusOn(d))}</p>` : ""}`;
  }
  return `<div class="topbar">${brand()}${syncBadge()}</div><h1 class="page-title">Plan</h1>${seg}${body}`;
}
function doneRecently() {
  const d7 = addDays(today(), -7), list = Object.values(S.tasks).filter(x => M.isDone(x) && (x.doneAt || "") >= d7).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
  if (!list.length) return "";
  const open = UI.open.doneList;
  return `<button class="btn ghost small" data-act="toggleOpen" data-id="doneList">${open ? "▾" : "▸"} Erledigt in den letzten 7 Tagen (${list.length})</button>${open ? `<div class="card">${list.map(x => taskRow(x)).join("")}</div>` : ""}`;
}
const settings = M.settings;

/* ---------- Timer ---------- */
function timerFace(t, big = false) {
  const view = TM.cfg.view, n = new Date();
  const free = t ? t.preset === "free" : TM.cfg.preset === "free";
  const len = t ? TM.phaseLen(t) : 0, rem = t ? TM.remaining(t) : 0, el = t ? TM.elapsed(t) : 0;
  const color = !t ? "var(--accent)" : t.phase === "break" ? "var(--break)" : "var(--focus)";
  const track = big ? "rgb(255 255 255 / .12)" : "var(--sunk)";
  const frac = !t ? 0 : free ? (el / 60000 % 60) / 60 : len ? 1 - rem / len : 0;
  const startTxt = free ? "00:00" : pad(TM.cfg.preset === "custom" ? TM.cfg.custom.focus : TM.PRESETS[TM.cfg.preset].focus) + ":00";
  let main, sub;
  if (view === "clock") { main = pad(n.getHours()) + ":" + pad(n.getMinutes()); sub = !t ? "Bereit" : free ? mmss(el / 1000) + " gelernt" : "noch " + mmss(rem / 1000); }
  else if (view === "watch") { main = t ? mmss((t.phase === "focus" ? TM.focusTotal(t) : el) / 1000) : "00:00"; sub = !t ? "Stoppuhr" : t.phase === "focus" ? "Fokus gesamt" : "Pause"; }
  else { main = !t ? startTxt : free ? mmss(el / 1000) : mmss(rem / 1000); sub = !t ? "Bereit" : t.pausedAt ? (t.autoPaused && TM.cfg.mode === "flip" ? "Handy umdrehen" : "Pausiert") : t.phase === "focus" ? "Fokus" : "Pause"; }
  return `<div class="face ${view === "clock" ? "clock" : ""}">${ring(view === "clock" && t && !free ? 1 - rem / (len || 1) : frac, 200, 7, color, track)}<div><div class="big num" id="tmain">${main}</div><div class="sub" id="tsub">${esc(sub)}</div></div></div>`;
}
function timerDots(t) {
  if (!t || t.preset === "free") return "";
  const p = TM.PRESETS[t.preset] || TM.PRESETS.p50, total = p.every || 4;
  return `<div class="dots">${[...Array(total)].map((_, i) => `<i class="${i < (t.round % total) + (t.phase === "break" ? 1 : 0) ? "on" : ""}"></i>`).join("")}</div>`;
}
function timerControls(t) {
  if (!t) return `<button class="btn primary" data-act="tStart">Start</button>`;
  return `${t.pausedAt ? `<button class="btn primary" data-act="tResume">Weiter</button>` : `<button class="btn" data-act="tPause">Pause</button>`}
    ${t.preset !== "free" ? `<button class="btn" data-act="tSkip">${t.phase === "focus" ? "Pause starten" : "Pause beenden"}</button>` : ""}
    <button class="btn" data-act="tStop">Beenden</button>`;
}
function viewTimer() {
  const t = TM.T(), mode = TM.cfg.mode, view = TM.cfg.view;
  const phaseCls = !t ? "idle" : t.phase === "break" ? "break" : "";
  const task = t?.taskId ? S.tasks[t.taskId] : null;
  const todayLog = (S.timelog[today()]?.entries || []).slice().reverse();
  const hint = mode === "flip" ? (t ? (t.pausedAt ? "Handy mit dem Display nach unten hinlegen, dann geht es weiter." : t.phase === "focus" ? "Hochnehmen pausiert den Fokus." : "Pause: Handy darfst du jetzt nehmen.") : "Leg das Handy mit dem Display nach unten hin, dann startet der Fokus.")
    : mode === "visible" ? "Läuft nur, solange diese Ansicht offen ist. Verlässt du die App, pausiert der Fokus." : "";
  return `<div class="topbar">${brand()}<button class="btn small" data-act="fullscreen">⛶ Vollbild</button></div>
  <div class="tstage ${phaseCls}">
    <div class="phase-l">${!t ? "Bereit" : t.phase === "break" ? "Pause" : "Fokus"}${t && t.preset !== "free" ? " · Runde " + ((t.round || 0) + 1) : ""}${t ? " · " + esc(M.tag(t.category).name) : ""}</div>
    ${timerFace(t)}${timerDots(t)}
    ${task ? `<div class="pill">${esc(task.title)}</div>` : ""}
    <div class="ctrl" id="tctrl">${timerControls(t)}</div>
    ${hint ? `<p class="hint">${hint}</p>` : ""}
  </div>
  <div class="tcfg">
    <span class="lbl">Ansicht</span>
    <div class="seg small">${[["clock", "Uhr"], ["timer", "Timer"], ["watch", "Stoppuhr"]].map(([k, l]) => `<button data-act="tView" data-id="${k}" aria-pressed="${view === k}">${l}</button>`).join("")}</div>
    <span class="lbl">Start</span>
    <div class="seg small">${[["flip", "Umdrehen"], ["visible", "Nur sichtbar"], ["manual", "Knopf"]].map(([k, l]) => `<button data-act="tMode" data-id="${k}" aria-pressed="${mode === k}" ${k === "flip" && !isNative ? "disabled" : ""}>${l}</button>`).join("")}</div>
    <span class="lbl">Rhythmus</span>
    <div class="seg small">${Object.entries(TM.PRESETS).map(([k, p]) => `<button data-act="tPreset" data-id="${k}" aria-pressed="${TM.cfg.preset === k}" ${t ? "disabled" : ""}>${p.label}</button>`).join("")}</div>
    ${TM.cfg.preset === "custom" && !t ? `<div class="row"><label class="muted">Fokus (min)<input type="number" min="5" max="180" value="${TM.cfg.custom.focus}" data-custom="focus"></label><label class="muted">Pause (min)<input type="number" min="1" max="60" value="${TM.cfg.custom.brk}" data-custom="brk"></label></div>` : ""}
    <span class="lbl">Wofür</span>
    <div class="chips wrapchips">${M.tags().map(x => `<button data-act="tTag" data-id="${x.id}" aria-pressed="${(t ? t.category : TM.cfg.tag) === x.id}" ${t ? "disabled" : ""}><i style="width:8px;height:8px;border-radius:50%;background:${esc(x.color)}"></i>${esc(x.name)}</button>`).join("")}</div>
    <label class="flex muted" style="font-size:.85rem"><input type="checkbox" data-act="tSound" ${TM.cfg.sound ? "checked" : ""}> Ton beim Phasenwechsel</label>
  </div>
  <section class="sec"><div class="sec-h"><h2>Heute erfasst · ${hm(M.focusOn(today()))}</h2><button class="btn ghost small" data-act="addLog">+ Nachtragen</button></div>
    <div class="card">${todayLog.map(e => `<div class="item"><div class="tx"><span>${esc(M.tag(e.category).name)}${e.taskId && S.tasks[e.taskId] ? " · " + esc(S.tasks[e.taskId].title) : ""}</span><small class="num">${e.start.slice(11, 16)}–${e.end.slice(11, 16)} · ${e.focusMin} min Fokus${e.breakMin ? " · " + e.breakMin + " min Pause" : ""}</small></div><button class="btn ghost small" data-act="delLog" data-id="${e.id}" aria-label="Löschen">✕</button></div>`).join("") || `<div class="empty">Heute noch nichts erfasst.</div>`}</div></section>`;
}
function renderFS() {
  let fs = $("#fs");
  if (!UI.fs) { if (fs) fs.classList.remove("on"); return; }
  if (!fs) { fs = document.createElement("div"); fs.id = "fs"; document.body.append(fs); }
  const t = TM.T();
  fs.className = "on " + (t?.phase === "break" ? "break" : "");
  fs.innerHTML = `<div class="phase-l">${!t ? "Bereit" : t.phase === "break" ? "Pause" : "Fokus"}${t ? " · " + esc(M.tag(t.category).name) : ""}</div>${timerFace(t, true)}${timerDots(t)}<div class="ctrl">${timerControls(t)}<button class="btn" data-act="fullscreen">Schließen</button></div>`;
}
function updateTimerLive() {
  const t = TM.T();
  if (TM.tick()) { render(); return; }
  if (UI.tab === "timer" || UI.fs) {
    $$("#fs #tmain, main #tmain").forEach(() => {});
    if (UI.fs) renderFS();
    if (UI.tab === "timer") { const f = $("main .face"); if (f) f.outerHTML = timerFace(t); }
  }
  const black = $("#black"); if (black) black.classList.toggle("on", TM.flipState.active && TM.flipState.down && !!t && t.phase === "focus" && !t.pausedAt);
}

/* ---------- Routine ---------- */
function viewRoutine() {
  const t = today(), weeks = UI.heatWeeks, start = addDays(mondayOf(t), -(weeks - 1) * 7);
  const cell = (d) => {
    if (d > t) return `<span class="hc future"></span>`;
    const m = M.routineFrac("morning", d), e = M.routineFrac("evening", d);
    const col = (f, base) => f === null ? "transparent" : f === 0 ? "var(--sunk)" : `color-mix(in srgb,${base} ${Math.round(25 + 75 * f)}%,var(--sunk))`;
    return `<button class="hc ${d === t ? "today" : ""}" data-act="heatDay" data-id="${d}" aria-label="${fmtDay(d)}: Morgen ${m === null ? "–" : Math.round(m * 100) + " %"}, Abend ${e === null ? "–" : Math.round(e * 100) + " %"}"><i style="background:${col(m, "var(--morning-ink)")}"></i><i style="background:${col(e, "var(--accent)")}"></i></button>`;
  };
  let grid = `<span></span>${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map(x => `<span class="hd">${x}</span>`).join("")}`;
  for (let w = 0; w < weeks; w++) { const ws = addDays(start, w * 7); grid += `<span class="wl">KW ${kw(ws)}</span>` + [...Array(7)].map((_, i) => cell(addDays(ws, i))).join(""); }
  const sel = UI.heatDay || t;
  const stats = ph => M.habits().filter(h => h.phase === ph).map(h => { const r = M.habitRate(h.id, 30); return `<div class="hstat"><span>${esc(h.name)}</span><b>${r.done}/${r.total}</b><span class="muted num" style="min-width:3.2em;text-align:right">${r.total ? Math.round(100 * r.done / r.total) : 0} %</span></div>`; }).join("");
  return `<div class="topbar">${brand()}${syncBadge()}</div><h1 class="page-title">Routine</h1>
  <div class="stats"><div class="stat"><span class="ic" style="background:var(--morning);color:var(--morning-ink)">☀</span><div><b>${M.routineStreak("morning")} Tage</b><span>Serie Morgen</span></div></div><div class="stat"><span class="ic">☾</span><div><b>${M.routineStreak("evening")} Tage</b><span>Serie Abend</span></div></div></div>
  <section class="sec"><div class="sec-h"><h2>Verlauf</h2><div class="seg small">${[[4, "4 W"], [12, "12 W"], [26, "6 M"]].map(([k, l]) => `<button data-act="heatWeeks" data-id="${k}" aria-pressed="${weeks === k}">${l}</button>`).join("")}</div></div>
    <div class="card"><div class="heat">${grid}</div><div class="legend"><span><i style="background:var(--morning-ink)"></i>oben Morgen</span><span><i style="background:var(--accent)"></i>unten Abend</span><span>kräftiger = mehr geschafft</span></div></div></section>
  <section class="sec"><div class="sec-h"><h2>${sel === t ? "Heute" : WDL[parse(sel).getDay()] + ", " + fmtDay(sel).slice(3)}</h2>${sel !== t ? `<button class="btn ghost small" data-act="heatDay" data-id="${t}">Heute</button>` : ""}</div>
    ${routineCardFor("morning", sel)}${routineCardFor("evening", sel)}</section>
  <section class="sec"><div class="sec-h"><h2>Letzte 30 Tage</h2></div><div class="card"><div class="grp" style="padding:10px 14px 0">Morgen</div>${stats("morning")}<div class="grp" style="padding:10px 14px 0">Abend</div>${stats("evening")}</div></section>`;
}
function routineCardFor(phase, d) { UI.open["r-" + phase] ??= true; return routineCard(phase, d); }

/* ---------- Mehr ---------- */
function viewMehr() {
  const s = settings(), r = s.reminders || {};
  const acct = !sync.enabled ? `<div class="empty">Sync ist in dieser Version nicht eingerichtet. Deine Daten liegen nur auf diesem Gerät.</div>`
    : sync.user ? `<div class="item"><div class="tx"><span>${esc(sync.user.email)}</span><small>Status: ${esc(sync.status)}${sync.lastSync ? " · zuletzt " + sync.lastSync.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : ""}${sync.error ? " · " + esc(sync.error) : ""}</small></div><button class="btn small" data-act="syncNow">Jetzt syncen</button></div>
      <div class="item"><div class="tx"><span>Einladungscode</span><small>Damit kann Claude auf deine Arc-Mode-Daten zugreifen.</small></div><button class="btn small" data-act="showCode">Anzeigen</button></div>
      <div class="item"><div class="tx"><span>Abmelden</span></div><button class="btn small danger" data-act="signOut">Abmelden</button></div>`
    : `<form class="login" id="login" style="padding:14px"><p class="muted" style="margin:0">Melde dich an, damit Handy, PC und Claude dieselben Daten sehen.</p><input name="email" type="email" placeholder="E-Mail" autocomplete="email" required><input name="pw" type="password" placeholder="Passwort (mind. 8 Zeichen)" autocomplete="current-password" minlength="8" required><div class="flex"><button class="btn primary" data-act="signIn">Anmelden</button><button class="btn" data-act="signUp">Konto erstellen</button></div></form>`;
  return `<div class="topbar">${brand()}${syncBadge()}</div><h1 class="page-title">Mehr</h1>
  <section class="sec"><div class="sec-h"><h2>Konto & Sync</h2></div><div class="card">${acct}</div></section>
  <section class="sec"><div class="sec-h"><h2>Handy-Kalender</h2></div><div class="card">
    ${calendarAvailable ? `<div class="item"><div class="tx"><span>Kalender anzeigen</span><small>Termine aus Samsung- und Google-Kalender erscheinen unter Heute und Woche.</small></div><button class="btn small ${s.calendarOn ? "" : "primary"}" data-act="${s.calendarOn ? "disconnectCal" : "connectCal"}">${s.calendarOn ? "Trennen" : "Verbinden"}</button></div>
      ${s.calendarOn ? `<div class="item"><div class="tx"><span>Welche Kalender?</span></div><button class="btn small" data-act="pickCalendars">Auswählen</button></div>` : ""}`
      : `<div class="empty">Der Handy-Kalender geht nur in der Android-App. Am PC siehst du deine eigenen Arc-Mode-Termine.</div>`}</div></section>
  <section class="sec"><div class="sec-h"><h2>Erinnerungen</h2></div><div class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:10px">
    <label class="flex"><input type="checkbox" data-set="rem.off" ${r.off ? "" : "checked"}> Erinnerungen an</label>
    <label class="row"><span>Heute-Fokus wählen</span><input type="time" data-set="rem.planTime" value="${esc(r.planTime || "07:30")}"></label>
    <label class="row"><span>Abendroutine</span><input type="time" data-set="rem.eveningTime" value="${esc(r.eveningTime || "21:30")}"></label>
    <label class="row"><span>Vor eigenen Terminen (min)</span><input type="number" min="0" max="240" data-set="rem.eventLead" value="${r.eventLead ?? 30}"></label>
    <button class="btn small" style="align-self:flex-start" data-act="testNotif">Test-Benachrichtigung</button></div></section>
  <section class="sec"><div class="sec-h"><h2>Tags</h2><button class="btn ghost small" data-act="newTag">+ Tag</button></div><div class="card">${M.tags().map(t => `<div class="item"><span class="dot" style="background:${esc(t.color)};width:14px;height:14px"></span><div class="tx"><span>${esc(t.name)}</span></div><button class="btn ghost small" data-act="editTag" data-id="${t.id}">⋯</button></div>`).join("")}</div></section>
  <section class="sec"><div class="sec-h"><h2>Daten</h2></div><div class="card"><div class="item"><div class="tx"><span>Sicherung herunterladen</span><small>Alle Daten als JSON-Datei.</small></div><button class="btn small" data-act="export">Export</button></div><div class="item"><div class="tx"><span>Sicherung einspielen</span><small>Überschreibt gleiche Einträge.</small></div><label class="btn small">Import<input type="file" accept=".json,application/json" data-act="import" hidden></label></div></div></section>
  <p class="muted" style="text-align:center;font-size:.8rem">Arc Mode ${__APP_VERSION__} · ${isNative ? "Android" : "Web"}</p>`;
}

/* ---------- dialogs ---------- */
const dlg = () => $("#dlg");
function openDlg(html, onSubmit) {
  const d = dlg(); d.innerHTML = html; d.showModal();
  const f = d.querySelector("form");
  if (f) f.onsubmit = e => { e.preventDefault(); const act = e.submitter?.value || "save"; if (act === "cancel") return d.close(); onSubmit?.(new FormData(f), act); d.close(); };
}
const tagChecks = sel => `<div class="chips wrapchips">${M.tags().map(t => `<label class="chip"><input type="checkbox" name="tags" value="${t.id}" ${(sel || []).includes(t.id) ? "checked" : ""}><i style="width:8px;height:8px;border-radius:50%;background:${esc(t.color)}"></i>${esc(t.name)}</label>`).join("")}</div>`;
function editTask(id) {
  const t = id ? S.tasks[id] : null;
  openDlg(`<form><h2>${t ? "Aufgabe bearbeiten" : "Neue Aufgabe"}</h2>
    <label>Was?<input name="title" required value="${esc(t?.title || "")}" placeholder="z. B. Knickung Altklausur 2024 rechnen"></label>
    <label>Tags</label>${tagChecks(t?.tags || (UI.filter ? [UI.filter] : []))}
    <div class="row2"><label>Bis wann (optional)<input type="date" name="due" value="${esc(t?.due || "")}"></label><label>Priorität<select name="prio">${[[1, "Hoch"], [2, "Normal"], [3, "Niedrig"]].map(([v, l]) => `<option value="${v}" ${(t?.prio || 2) == v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    <div class="row2"><label>Dauer ca. (min)<input type="number" name="est" min="0" step="5" value="${t?.est || ""}"></label><label class="cb" style="margin-top:20px"><input type="checkbox" name="focus" ${t?.focusDate === today() ? "checked" : ""}> Heute-Fokus</label></div>
    <label>Notiz<textarea name="note">${esc(t?.note || "")}</textarea></label>
    <div class="drow">${t ? `<button class="btn danger grow" value="delete">Löschen</button>` : ""}<button class="btn" value="cancel" formnovalidate>Abbrechen</button><button class="btn primary" value="save">Speichern</button></div></form>`, (f, act) => {
    if (act === "delete") { const b = { ...t }; del("tasks", id); toast("Aufgabe gelöscht", () => put("tasks", id, b, false)); return; }
    const data = { title: f.get("title").trim(), tags: f.getAll("tags"), due: f.get("due") || null, prio: Number(f.get("prio")), est: Number(f.get("est")) || null, note: f.get("note").trim(), focusDate: f.get("focus") ? today() : (t?.focusDate === today() ? null : t?.focusDate || null) };
    if (t) put("tasks", id, data); else M.newTask(data);
  });
}
function editEvent(id, date) {
  const e = id ? S.events[id] : null;
  openDlg(`<form><h2>${e ? "Termin bearbeiten" : "Neuer Termin"}</h2>
    <label>Titel<input name="title" required value="${esc(e?.title || "")}"></label>
    <label>Art<select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${(e?.kind || "termin") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <div class="row2"><label>Datum<input type="date" name="date" required value="${esc(e?.date || date || today())}"></label><label>Bis (mehrtägig)<input type="date" name="endDate" value="${esc(e?.endDate || "")}"></label></div>
    <div class="row2"><label>Von<input type="time" name="time" value="${esc(e?.time || "")}"></label><label>Bis<input type="time" name="endTime" value="${esc(e?.endTime || "")}"></label></div>
    <label>Kurzname für Countdown<input name="short" value="${esc(e?.short || "")}" placeholder="z. B. FL mündlich"></label>
    <label class="cb"><input type="checkbox" name="countdown" ${e ? (M.hasCountdown(e) ? "checked" : "") : ""}> Countdown auf Heute zeigen</label>
    ${!e && calendarAvailable && settings().calendarOn ? `<label class="cb"><input type="checkbox" name="toDevice" checked> Auch in den Handy-Kalender eintragen</label>` : ""}
    <div class="drow">${e ? `<button class="btn danger grow" value="delete">Löschen</button>` : ""}<button class="btn" value="cancel" formnovalidate>Abbrechen</button><button class="btn primary" value="save">Speichern</button></div></form>`, async (f, act) => {
    if (act === "delete") { const b = { ...e }; del("events", id); toast("Termin gelöscht", () => put("events", id, b, false)); return; }
    const kind = f.get("kind");
    const data = { title: f.get("title").trim(), kind, date: f.get("date"), endDate: f.get("endDate") || null, time: f.get("time") || "", endTime: f.get("endTime") || "", short: f.get("short").trim(), countdown: !!f.get("countdown") };
    const saved = e ? put("events", id, data) : M.newEvent(data);
    if (!e && f.get("toDevice")) {
      const [y, m, d] = data.date.split("-").map(Number), st = new Date(y, m - 1, d), en = new Date(y, m - 1, d);
      if (data.time) { const [h, mi] = data.time.split(":").map(Number); st.setHours(h, mi); const [h2, m2] = (data.endTime || "").split(":").map(Number); if (data.endTime) en.setHours(h2, m2); else en.setHours(h + 1, mi); } else en.setDate(en.getDate() + 1);
      const devId = await createDeviceEvent({ title: data.title, start: st, end: en, allDay: !data.time, calendarId: settings().writeCalendar });
      if (devId) put("events", saved.id, { devId });
    }
    M.planReminders();
  });
}
function pickFocus() {
  const list = M.openTasks().filter(x => x.focusDate !== today()).sort(M.byPrio);
  openDlg(`<form><h2>Heute-Fokus</h2><p class="muted" style="margin:0">Wähl 2–4 Sachen, die du heute wirklich machen willst.</p>
    <div class="pick">${list.map(x => `<label class="item" style="cursor:pointer"><input type="checkbox" name="ids" value="${x.id}"><div class="tx"><span>${esc(x.title)}</span><small>${x.due ? (x.due < today() ? "überfällig · " : "bis ") + fmtDay(x.due) : "ohne Datum"}${x.prio === 1 ? " · hoch" : ""}</small><div class="tags">${tagPills(x.tags)}</div></div></label>`).join("") || `<div class="empty">Pool ist leer.</div>`}</div>
    <div class="drow"><button class="btn grow" value="new" formnovalidate>+ Neue Aufgabe</button><button class="btn" value="cancel" formnovalidate>Abbrechen</button><button class="btn primary" value="save">Übernehmen</button></div></form>`, (f, act) => {
    if (act === "new") { setTimeout(() => editTask(null), 50); return; }
    f.getAll("ids").forEach(id => put("tasks", id, { focusDate: today() }));
  });
}
function editRoutine(phase) {
  const hs = M.habits().filter(h => h.phase === phase);
  const row = h => `<div class="ritem" data-hid="${h.id}"><input type="text" value="${esc(h.name)}" aria-label="Name"><button type="button" class="btn ghost small" data-rm>✕</button><div class="wd">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label><input type="checkbox" value="${d}" ${(h.days || []).includes(d) ? "checked" : ""}><span>${WD[d]}</span></label>`).join("")}</div></div>`;
  openDlg(`<form><h2>${phase === "morning" ? "Morgenroutine" : "Abendroutine"}</h2><p class="muted" style="margin:0;font-size:.85rem">Keine Tage markiert = täglich.</p><div id="rlist">${hs.map(row).join("")}</div><button type="button" class="btn small" id="radd">+ Punkt</button>
    <div class="drow"><button class="btn" value="cancel" formnovalidate>Abbrechen</button><button class="btn primary" value="save">Speichern</button></div></form>`, () => {
    const seen = new Set();
    $$("#rlist .ritem").forEach((el, i) => {
      const id = el.dataset.hid, name = el.querySelector("input[type=text]").value.trim(); if (!name) return;
      seen.add(id); put("habits", id, { name, phase, order: i, days: $$(".wd input:checked", el).map(x => Number(x.value)), created: S.habits[id]?.created || today() });
    });
    hs.filter(h => !seen.has(h.id)).forEach(h => del("habits", h.id));
    M.planReminders();
  });
  $("#radd").onclick = () => $("#rlist").insertAdjacentHTML("beforeend", row({ id: uid("h"), name: "", days: [] }));
  $("#rlist").onclick = e => { if (e.target.closest("[data-rm]")) e.target.closest(".ritem").remove(); };
}
function editTag(id) {
  const t = id ? M.tags().find(x => x.id === id) : null;
  openDlg(`<form><h2>${t ? "Tag bearbeiten" : "Neuer Tag"}</h2><label>Name<input name="name" required value="${esc(t?.name || "")}"></label><label>Farbe<input type="color" name="color" value="${esc(t?.color?.startsWith("#") ? t.color : "#c8bbf1")}"></label>
    <div class="drow">${t ? `<button class="btn danger grow" value="delete">Löschen</button>` : ""}<button class="btn" value="cancel" formnovalidate>Abbrechen</button><button class="btn primary" value="save">Speichern</button></div></form>`, (f, act) => {
    let list = [...M.tags()];
    if (act === "delete") list = list.filter(x => x.id !== id);
    else if (t) list = list.map(x => x.id === id ? { ...x, name: f.get("name").trim(), color: f.get("color") } : x);
    else list.push({ id: f.get("name").trim().toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-") || uid("tag"), name: f.get("name").trim(), color: f.get("color") });
    M.saveSettings({ tags: list });
  });
}
function addLog() {
  openDlg(`<form><h2>Lernzeit nachtragen</h2><div class="row2"><label>Datum<input type="date" name="date" value="${today()}" required></label><label>Wofür<select name="cat">${M.tags().map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label></div>
    <div class="row2"><label>Von<input type="time" name="from" required></label><label>Bis<input type="time" name="to" required></label></div>
    <div class="drow"><button class="btn" value="cancel" formnovalidate>Abbrechen</button><button class="btn primary" value="save">Speichern</button></div></form>`, f => {
    const d = f.get("date"), a = minutesOf(f.get("from")), b = minutesOf(f.get("to")); if (b <= a) return toast("Ende muss nach dem Start liegen.");
    M.logSession({ id: uid("s"), start: d + "T" + f.get("from") + ":00", end: d + "T" + f.get("to") + ":00", category: f.get("cat"), preset: "manual", focusMin: b - a, breakMin: 0, rounds: 0 });
  });
}
async function pickCalendars() {
  const cals = await listCalendars(), s = settings(), hidden = new Set(s.hiddenCalendars || []);
  openDlg(`<form><h2>Kalender auswählen</h2><div class="pick">${cals.map(c => `<label class="item"><input type="checkbox" name="show" value="${esc(c.id)}" ${hidden.has(c.id) ? "" : "checked"}><span class="dot" style="background:${esc(c.color || "var(--c-x)")}"></span><div class="tx"><span>${esc(c.title || c.name || c.id)}</span><small>${esc(c.accountName || c.source?.title || "")}</small></div></label>`).join("") || `<div class="empty">Keine Kalender gefunden.</div>`}</div>
    <label>Neue Termine eintragen in<select name="write">${cals.filter(c => c.allowsContentModifications !== false).map(c => `<option value="${esc(c.id)}" ${s.writeCalendar === c.id ? "selected" : ""}>${esc(c.title || c.id)}</option>`).join("")}</select></label>
    <div class="drow"><button class="btn" value="cancel" formnovalidate>Abbrechen</button><button class="btn primary" value="save">Speichern</button></div></form>`, async f => {
    const show = new Set(f.getAll("show"));
    M.saveSettings({ hiddenCalendars: cals.map(c => c.id).filter(id => !show.has(id)), writeCalendar: f.get("write") || null });
    await refreshCal(); render();
  });
}

/* ---------- render ---------- */
function renderTabs() { $("#tabs").innerHTML = TABS.map(([k, l]) => `<button class="tab" role="tab" data-go="${k}" aria-selected="${UI.tab === k}">${ICON[k]}<span>${l}</span></button>`).join(""); }
let rendering = false;
function render() {
  if (rendering) return; rendering = true;
  if (document.activeElement?.closest?.("main") && document.activeElement.matches("input,textarea,select")) { rendering = false; return; }
  const v = { heute: viewHeute, plan: viewPlan, timer: viewTimer, routine: viewRoutine, mehr: viewMehr }[UI.tab] || viewHeute;
  $("#app").innerHTML = v(); renderTabs(); renderFS();
  TM.visibleGate(UI.tab === "timer" || UI.fs ? !document.hidden : false);
  TM.armFlip(TM.cfg.mode === "flip" && (UI.tab === "timer" || UI.fs), render);
  keepAwake(!!TM.T() && (UI.tab === "timer" || UI.fs));
  rendering = false;
}

/* ---------- actions ---------- */
async function refreshCal() { if (settings().calendarOn) { await M.refreshDeviceEvents(addDays(mondayOf(today()), -7), 49); render(); } }
const A = {
  toggleTask: id => { const done = M.toggleTask(id); if (done) { buzzLite(); } },
  toFocus: id => { put("tasks", id, { focusDate: today() }); toast("In Heute-Fokus übernommen"); },
  unFocus: id => { put("tasks", id, { focusDate: null }); toast("Zurück im Pool"); },
  editTask: id => editTask(id), newTask: () => editTask(null), pickFocus,
  timerFor: id => { const t = S.tasks[id]; if (TM.T()) TM.stop(); TM.cfg.tag = t.tags?.[0] || TM.cfg.tag; if (TM.cfg.mode !== "flip") TM.start({ taskId: id, tag: t.tags?.[0] }); else local.set("pendingTask", id); go("timer"); },
  editEvent: id => editEvent(id), newEvent: (_, el) => editEvent(null, el.dataset.date),
  planTab: id => { UI.planTab = id; local.set("planTab", id); render(); },
  filter: id => { UI.filter = id || null; render(); },
  week: n => { UI.weekStart = addDays(UI.weekStart, Number(n)); UI.day = UI.weekStart; render(); },
  day: id => { UI.day = id; render(); },
  clearOverdue: () => { const list = M.overdue(); openDlg(`<form><h2>${list.length} überfällige löschen?</h2><div class="pick">${list.map(x => `<div class="item"><div class="tx"><span>${esc(x.title)}</span><small>${fmtDay(x.due)}</small></div></div>`).join("")}</div><div class="drow"><button class="btn" value="cancel" formnovalidate>Abbrechen</button><button class="btn primary" value="save" style="background:var(--bad)">Alle löschen</button></div></form>`, () => { const b = M.deleteOverdue(); toast(`${b.length} gelöscht`, () => M.restore(b)); }); },
  clearPastEvents: () => { const t = today(), list = M.ownEvents().filter(e => (e.endDate || e.date) < t); const b = list.map(x => ({ ...x })); list.forEach(e => del("events", e.id)); toast(`${list.length} alte Termine entfernt`, () => b.forEach(({ id, ...d }) => put("events", id, d, false))); },
  toggleOpen: id => { UI.open[id] = !(UI.open[id] ?? $(`[data-id="${id}"]`)?.getAttribute("aria-expanded") === "true"); local.set("open", UI.open); render(); },
  cycleHabit: (id, el) => { const n = M.cycleHabit(el.dataset.date || today(), id); if (n === true) buzzLite(); },
  editRoutine: id => editRoutine(id),
  heatDay: id => { UI.heatDay = id; render(); }, heatWeeks: id => { UI.heatWeeks = Number(id); render(); },
  tStart: () => { unlockAudio(); ensureNotifPermission(); const pt = local.get("pendingTask", null); local.set("pendingTask", null); TM.start({ taskId: pt }); },
  tPause: () => TM.pause(false), tResume: () => { unlockAudio(); TM.resume(); }, tSkip: () => TM.skipPhase(),
  tStop: () => { const e = TM.stop(); if (e) toast(e.focusMin ? `${e.focusMin} min Fokus gespeichert` : "Timer beendet"); if (UI.fs) { UI.fs = false; } },
  tView: id => { TM.cfg.view = id; render(); }, tMode: id => { TM.cfg.mode = id; if (id === "flip") ensureNotifPermission(); render(); },
  tPreset: id => { TM.cfg.preset = id; render(); }, tTag: id => { TM.cfg.tag = id; render(); },
  fullscreen: () => { UI.fs = !UI.fs; if (UI.fs) { document.documentElement.requestFullscreen?.().catch(() => {}); } else document.exitFullscreen?.().catch(() => {}); render(); },
  addLog, delLog: id => { const d = today(), entries = (S.timelog[d]?.entries || []); const e = entries.find(x => x.id === id); put("timelog", d, { entries: entries.filter(x => x.id !== id) }); toast("Eintrag gelöscht", () => put("timelog", d, { entries: [...(S.timelog[d]?.entries || []), e] })); },
  connectCal: async () => { const ok = await calendarPermission(true); if (!ok) return toast("Kalender-Zugriff wurde nicht erlaubt."); M.saveSettings({ calendarOn: true }); await refreshCal(); toast("Kalender verbunden"); },
  disconnectCal: () => { M.saveSettings({ calendarOn: false }); M.refreshDeviceEvents(today(), 1); render(); },
  pickCalendars,
  syncNow: async () => { await flush(); await pull(); toast("Synchronisiert"); },
  showCode: async () => { const c = await inviteCode(); openDlg(`<form><h2>Einladungscode</h2><p>Gib diesen Code nur Claude im Arc-Mode-Thread:</p><input readonly value="${esc(c || "nicht verfügbar")}" onclick="this.select()"><div class="drow"><button class="btn primary" value="cancel">OK</button></div></form>`); },
  signOut: () => signOut(),
  signIn: async (_, el, ev) => { ev.preventDefault(); const f = new FormData($("#login")); const err = await signIn(f.get("email"), f.get("pw")); toast(err || "Angemeldet"); },
  signUp: async (_, el, ev) => { ev.preventDefault(); const f = new FormData($("#login")); const err = await signUp(f.get("email"), f.get("pw")); toast(err || "Konto erstellt"); },
  testNotif: async () => { const ok = await ensureNotifPermission(); if (!ok) return toast("Benachrichtigungen sind nicht erlaubt."); const { schedule } = await import("./native.js"); await schedule(999, new Date(Date.now() + 5000), "Arc Mode", "So sehen Erinnerungen aus. 👋"); toast("Kommt in 5 Sekunden"); },
  newTag: () => editTag(null), editTag: id => editTag(id),
  export: () => { const b = new Blob([exportJSON()], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "arc-mode-" + today() + ".json"; a.click(); }
};
function buzzLite() { import("./native.js").then(n => n.buzz()); }

document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); go(g.dataset.go); return; }
  const el = e.target.closest("[data-act]"); if (!el || el.tagName === "INPUT") return;
  const fn = A[el.dataset.act]; if (!fn) return;
  if (el.closest("dialog form") && el.type !== "button") return;
  e.preventDefault(); fn(el.dataset.id, el, e);
});
document.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.act === "tSound") { TM.cfg.sound = el.checked; return; }
  if (el.dataset.act === "import" && el.files[0]) { el.files[0].text().then(t => { try { toast(importJSON(t) + " Einträge eingespielt"); } catch { toast("Datei konnte nicht gelesen werden."); } }); return; }
  if (el.dataset.custom) { const c = TM.cfg.custom; c[el.dataset.custom] = Math.max(1, Number(el.value) || 1); TM.cfg.custom = c; return; }
  if (el.dataset.set?.startsWith("rem.")) {
    const k = el.dataset.set.slice(4), r = { ...(settings().reminders || {}) };
    r[k] = k === "off" ? !el.checked : k === "eventLead" ? Number(el.value) : el.value;
    M.saveSettings({ reminders: r }); M.planReminders(); if (k === "off" && el.checked) ensureNotifPermission();
  }
});
document.addEventListener("focusout", () => setTimeout(() => { if (!document.activeElement?.matches?.("input,textarea,select")) render(); }, 50));
document.addEventListener("visibilitychange", () => { TM.visibleGate(!document.hidden && (UI.tab === "timer" || UI.fs)); });
onBack(() => { if (dlg().open) dlg().close(); else if (UI.fs) { UI.fs = false; render(); } else if (UI.tab !== "heute") go("heute"); });

/* ---------- boot ---------- */
async function boot() {
  document.body.insertAdjacentHTML("beforeend", '<div id="black" aria-hidden="true"></div>');
  await initStore();
  seedIfEmpty();
  M.rollOverFocus();
  onChange(render);
  render();
  refreshCal();
  M.planReminders();
  onResume(() => { M.rollOverFocus(); refreshCal(); M.planReminders(); render(); });
  setInterval(updateTimerLive, 1000);
  let lastDay = today(); setInterval(() => { if (today() !== lastDay) { lastDay = today(); M.rollOverFocus(); render(); } }, 60000);
}
function seedIfEmpty() {
  if (Object.keys(S.habits).length || Object.keys(S.tasks).length || local.get("seeded", false)) return;
  local.set("seeded", true);
  [["Aufstehen ohne Snooze", "morning"], ["Bibel lesen", "morning"], ["Heute-Fokus wählen", "morning"], ["Handy weg, Bildschirm aus", "evening"], ["Morgen kurz vorplanen", "evening"], ["22:30 im Bett", "evening"]]
    .forEach(([name, phase], i) => put("habits", "h" + i, { name, phase, order: i, days: [], created: today() }));
}
boot();
