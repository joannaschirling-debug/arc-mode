// Thin wrappers around device features. On the web (PC) they fall back to
// browser APIs or do nothing, so the same code runs everywhere.
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { CapacitorCalendar } from "@ebarooni/capacitor-calendar";
import { App } from "@capacitor/app";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

/* ---------- vibration + sound ---------- */
export async function buzz(pattern = "short") {
  try {
    if (isNative) {
      if (pattern === "long") { for (let i = 0; i < 3; i++) { await Haptics.vibrate({ duration: 350 }); await new Promise(r => setTimeout(r, 500)); } }
      else await Haptics.impact({ style: ImpactStyle.Medium });
    } else navigator.vibrate?.(pattern === "long" ? [350, 150, 350, 150, 350] : 30);
  } catch {}
}
let actx;
export function chime(kind = "end") {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const notes = kind === "break" ? [523, 659, 784] : kind === "focus" ? [784, 659, 523] : [659, 784, 1047];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.22;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 1);
    });
  } catch {}
}
export const unlockAudio = () => { try { actx ??= new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch {} };

/* ---------- keep screen on ---------- */
let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (isNative) { on ? await KeepAwake.keepAwake() : await KeepAwake.allowSleep(); return; }
    if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => wakeLock = null); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}

/* ---------- notifications ---------- */
let notifOk = null;
export async function ensureNotifPermission() {
  if (notifOk !== null) return notifOk;
  try {
    if (isNative) {
      let p = await LocalNotifications.checkPermissions();
      if (p.display !== "granted") p = await LocalNotifications.requestPermissions();
      notifOk = p.display === "granted";
      if (notifOk) {
        await LocalNotifications.createChannel({ id: "timer", name: "Timer", importance: 5, vibration: true, sound: undefined, visibility: 1 }).catch(() => {});
        await LocalNotifications.createChannel({ id: "remind", name: "Erinnerungen", importance: 4, vibration: true, visibility: 1 }).catch(() => {});
      }
    } else if ("Notification" in window) {
      notifOk = Notification.permission === "granted" || (await Notification.requestPermission()) === "granted";
    } else notifOk = false;
  } catch { notifOk = false; }
  return notifOk;
}
const webTimers = new Map();
// id: positive int < 2^31. at: Date.
export async function schedule(id, at, title, body, channel = "remind") {
  if (at <= new Date()) return;
  if (!(await ensureNotifPermission())) return;
  if (isNative) {
    await LocalNotifications.schedule({ notifications: [{ id, title, body, channelId: channel, schedule: { at, allowWhileIdle: true } }] }).catch(() => {});
  } else {
    clearTimeout(webTimers.get(id));
    const ms = at - new Date(); if (ms > 2 ** 31 - 1) return;
    webTimers.set(id, setTimeout(() => { try { new Notification(title, { body }); } catch {} }, ms));
  }
}
export async function cancel(ids) {
  ids = [].concat(ids);
  if (isNative) await LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) }).catch(() => {});
  else ids.forEach(id => { clearTimeout(webTimers.get(id)); webTimers.delete(id); });
}
export async function pendingIds() {
  if (!isNative) return [...webTimers.keys()];
  try { return (await LocalNotifications.getPending()).notifications.map(n => n.id); } catch { return []; }
}

/* ---------- device calendar (Samsung / Google calendars on the phone) ---------- */
export const calendarAvailable = isNative;
export async function calendarPermission(request = false) {
  if (!isNative) return false;
  try {
    if (request) return (await CapacitorCalendar.requestFullCalendarAccess()).result === "granted";
    const r = await CapacitorCalendar.checkAllPermissions();
    return r.result?.readCalendar === "granted" || r.result?.READ_CALENDAR === "granted";
  } catch { return false; }
}
export async function listCalendars() {
  if (!isNative) return [];
  try { return (await CapacitorCalendar.listCalendars()).result || []; } catch { return []; }
}
export async function deviceEvents(fromDate, toDate) {
  if (!isNative) return [];
  try {
    const r = await CapacitorCalendar.listEventsInRange({ from: fromDate.getTime(), to: toDate.getTime() });
    // All-day events are stored at UTC midnight; read their calendar date in UTC so they land on the right day.
    const utcDay = ms => { const x = new Date(ms); return new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); };
    return (r.result || []).map(e => ({
      id: "dev:" + e.id, devId: e.id, title: e.title || "(ohne Titel)",
      start: e.isAllDay ? utcDay(e.startDate) : new Date(e.startDate), end: e.isAllDay ? utcDay(e.endDate) : new Date(e.endDate),
      allDay: !!e.isAllDay, calendarId: e.calendarId, color: e.color, location: e.location, device: true
    }));
  } catch { return []; }
}
export async function createDeviceEvent({ title, start, end, allDay, calendarId, location }) {
  if (!isNative) return null;
  try { const r = await CapacitorCalendar.createEvent({ title, startDate: start.getTime(), endDate: end.getTime(), isAllDay: !!allDay, calendarId, location }); return r.id || r.result || null; }
  catch { return null; }
}

export async function deleteDeviceEvent(id) {
  if (!isNative || !id) return false;
  try { await CapacitorCalendar.deleteEvent({ id }); return true; } catch { return false; }
}

/* ---------- app lifecycle ---------- */
export function onResume(fn) {
  if (isNative) App.addListener("appStateChange", s => { if (s.isActive) fn(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) fn(); });
}
export function onBack(fn) { if (isNative) App.addListener("backButton", fn); }

/* ---------- orientation (phone face down / face up) ---------- */
// Calls cb("down") / cb("up") after the position held for `hold` ms.
export function watchFlip(cb, hold = 900) {
  let state = null, cand = null, since = 0;
  const handler = e => {
    const g = e.accelerationIncludingGravity; if (!g || g.z == null) return;
    const z = g.z; // ~ +9.8 face up, ~ -9.8 face down (Android)
    const s = z < -7.5 ? "down" : z > 3 ? "up" : null;
    if (!s) return;
    if (s !== cand) { cand = s; since = performance.now(); return; }
    if (s !== state && performance.now() - since > hold) { state = s; cb(s); }
  };
  const start = async () => {
    try { if (typeof DeviceMotionEvent?.requestPermission === "function") await DeviceMotionEvent.requestPermission(); } catch {}
    addEventListener("devicemotion", handler);
  };
  start();
  return () => removeEventListener("devicemotion", handler);
}
