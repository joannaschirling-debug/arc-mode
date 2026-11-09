export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const pad = n => String(n).padStart(2, "0");
export const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
export const today = () => ymd(new Date());
export const nowHM = () => { const n = new Date(); return pad(n.getHours()) + ":" + pad(n.getMinutes()); };
export const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const WDL = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
export const MON = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const fmtDay = s => { const d = parse(s); return WD[d.getDay()] + " " + pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "."; };
export const daysUntil = s => Math.round((parse(s) - parse(today())) / 86400000);
export const mondayOf = s => { const d = parse(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return ymd(d); };
export const kw = s => { const d = parse(s); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7); const w1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7); };
export const hm = min => { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h ? h + " h" + (m ? " " + m : "") : m + " min"; };
export const mmss = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(s); };
export const uid = p => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const local = {
  get(k, d) { try { const v = localStorage.getItem("arc3:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("arc3:" + k, JSON.stringify(v)); } catch {} }
};
export const ring = (frac, size, stroke, color, track = "var(--sunk)") => `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - stroke}" fill="none" stroke="${track}" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - stroke}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - Math.max(0, Math.min(1, frac)) * 100}" style="transition:stroke-dashoffset .4s,stroke .8s"/></svg>`;
export const CHEV = '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
export const minutesOf = t => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
