// Pomodoro / free timer. State is a timestamp record in state/timer, so it survives
// app restarts and shows the same on phone and PC. Start modes:
//  flip    – phone face down starts/resumes focus, picking it up pauses
//  visible – runs only while the timer screen is open and visible
//  manual  – start/pause buttons only
import { S, put } from "./store.js";
import { local, uid, today } from "./util.js";
import { buzz, chime, keepAwake, schedule, cancel, watchFlip, isNative } from "./native.js";
import { logSession } from "./model.js";

export const PRESETS = {
  p50: { label: "50 / 10", focus: 50, brk: 10, longBrk: 10, every: 0 },
  p25: { label: "25 / 5", focus: 25, brk: 5, longBrk: 20, every: 4 },
  custom: { label: "Eigene", focus: 40, brk: 8, longBrk: 8, every: 0 },
  free: { label: "Frei", focus: 0, brk: 0, longBrk: 0, every: 0 }
};
export const cfg = {
  get view() { return local.get("tview", "timer"); }, set view(v) { local.set("tview", v); },
  get mode() { return local.get("tmode", isNative ? "flip" : "visible"); }, set mode(v) { local.set("tmode", v); },
  get preset() { return local.get("tpreset", "p50"); }, set preset(v) { local.set("tpreset", v); },
  get custom() { return local.get("tcustom", { focus: 40, brk: 8 }); }, set custom(v) { local.set("tcustom", v); },
  get tag() { return local.get("ttag", "fl"); }, set tag(v) { local.set("ttag", v); },
  get sound() { return local.get("tsound", true); }, set sound(v) { local.set("tsound", v); }
};

export const T = () => S.state.timer?.running ? S.state.timer : null;
const save = t => put("state", "timer", t, false);
const now = () => Date.now();

export function phaseLen(t) {
  if (!t || t.preset === "free") return 0;
  const p = PRESETS[t.preset] || PRESETS.p50;
  if (t.phase === "focus") return t.focus * 60000;
  return ((p.every && (t.round + 1) % p.every === 0) ? p.longBrk : t.brk) * 60000;
}
export const elapsed = t => Math.max(0, (t.pausedAt || now()) - t.phaseStart - (t.pauseAcc || 0));
export const remaining = t => Math.max(0, phaseLen(t) - elapsed(t));
export const focusTotal = t => (t.focusMs || 0) + (t.phase === "focus" ? Math.min(elapsed(t), phaseLen(t) || Infinity) : 0);

const NOTIF = 9001;
async function planNotif(t) {
  await cancel(NOTIF);
  if (!t || t.pausedAt || t.preset === "free") return;
  const at = new Date(now() + remaining(t));
  await schedule(NOTIF, at, t.phase === "focus" ? "Fokus geschafft 🎉" : "Pause vorbei", t.phase === "focus" ? "Zeit für deine Pause." : (cfg.mode === "flip" ? "Handy umdrehen, dann geht's weiter." : "Weiter geht's mit Fokus."), "timer");
}

export function start(opts = {}) {
  const preset = cfg.preset, p = PRESETS[preset], c = cfg.custom;
  const t = {
    running: true, preset, focus: preset === "custom" ? c.focus : p.focus, brk: preset === "custom" ? c.brk : p.brk,
    phase: "focus", phaseStart: now(), pausedAt: null, pauseAcc: 0, focusMs: 0, breakMs: 0, round: 0,
    category: opts.tag || cfg.tag, taskId: opts.taskId || null, startedAt: now(), autoPaused: false
  };
  save(t); planNotif(t); buzz(); return t;
}
export function pause(auto = false) {
  const t = T(); if (!t || t.pausedAt) return;
  save({ ...t, pausedAt: now(), autoPaused: auto }); cancel(NOTIF);
}
export function resume() {
  const t = T(); if (!t || !t.pausedAt) return;
  const n = { ...t, pauseAcc: (t.pauseAcc || 0) + (now() - t.pausedAt), pausedAt: null, autoPaused: false };
  save(n); planNotif(n);
}
export function skipPhase() { const t = T(); if (t) advance(t, true); }
export function stop(discard = false) {
  const t = T(); if (!t) return null;
  const e = elapsed(t), len = phaseLen(t);
  let focusMs = t.focusMs || 0, breakMs = t.breakMs || 0;
  if (t.phase === "focus") focusMs += len ? Math.min(e, len) : e; else breakMs += len ? Math.min(e, len) : e;
  const entry = { id: uid("s"), start: new Date(t.startedAt).toISOString(), end: new Date().toISOString(), category: t.category, taskId: t.taskId, preset: t.preset, rounds: t.round, focusMin: Math.round(focusMs / 60000), breakMin: Math.round(breakMs / 60000) };
  save({ running: false }); cancel(NOTIF); keepAwake(false);
  if (!discard && entry.focusMin >= 1) logSession(entry);
  return entry;
}
function advance(t, manual = false) {
  const len = phaseLen(t), e = Math.min(elapsed(t), len || elapsed(t));
  const n = { ...t, pauseAcc: 0, pausedAt: null, autoPaused: false, phaseStart: now() };
  if (t.phase === "focus") { n.focusMs = (t.focusMs || 0) + e; n.phase = "break"; }
  else { n.breakMs = (t.breakMs || 0) + e; n.phase = "focus"; n.round = (t.round || 0) + 1; if (cfg.mode === "flip" && !flipState.down) { n.pausedAt = now(); n.autoPaused = true; } }
  save(n); planNotif(n);
  if (!manual) { buzz("long"); if (cfg.sound) chime(n.phase === "break" ? "break" : "focus"); }
}
// Called every second by the UI loop.
export function tick() {
  const t = T(); if (!t || t.pausedAt || t.preset === "free") return false;
  if (remaining(t) <= 0) { advance(t); return true; }
  return false;
}

/* ---------- start modes ---------- */
export const flipState = { down: false, active: false };
let unwatch = null;
export function armFlip(on, onChange) {
  if (on && !unwatch) {
    flipState.active = true;
    unwatch = watchFlip(pos => {
      flipState.down = pos === "down";
      const t = T();
      if (pos === "down") {
        if (!t) start(); else if (t.pausedAt) resume();
        buzz();
        onChange?.(); return;
      }
      if (t && !t.pausedAt && (t.phase === "focus" || t.preset === "free")) { const min = Math.floor(focusTotal(t) / 60000); pause(true); onChange?.(`Angehalten · ${min} min Fokus bisher`); return; }
      onChange?.();
    });
    keepAwake(true);
  } else if (!on && unwatch) { unwatch(); unwatch = null; flipState.active = false; flipState.down = false; if (!T()) keepAwake(false); }
}
// visible mode: pause when the timer screen is left or hidden, continue on return
export function visibleGate(visibleNow) {
  const t = T(); if (!t || cfg.mode !== "visible") return;
  if (!visibleNow && !t.pausedAt && (t.phase === "focus" || t.preset === "free")) pause(true);
  if (visibleNow && t.pausedAt && t.autoPaused) resume();
}
export const todayKey = today;
