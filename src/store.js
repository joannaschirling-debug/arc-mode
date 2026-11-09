// Local-first store. Every document lives in S[col][id] and in localStorage.
// When Supabase is configured and the user is signed in, changes sync to the
// shared table `docs` (one row per document) and arrive live from other devices.
import { createClient } from "@supabase/supabase-js";
import { local } from "./util.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const COLS = ["tasks", "events", "habits", "habitlog", "timelog", "meta", "state"];
export const S = Object.fromEntries(COLS.map(c => [c, {}]));

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
let notifyT;
const notify = () => { clearTimeout(notifyT); notifyT = setTimeout(() => listeners.forEach(f => f()), 16); };

export const sync = { enabled: !!(SUPABASE_URL && SUPABASE_ANON_KEY), user: null, space: null, status: "lokal", lastSync: null, error: null };
export const sb = sync.enabled ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

let queue = local.get("queue", {}); // key "col/id" -> {col,id,data,deleted}

function persist() { local.set("data", S); local.set("queue", queue); }
function loadLocal() {
  const d = local.get("data", null);
  if (d) COLS.forEach(c => { S[c] = d[c] || {}; });
}

export function get(col, id) { return S[col][id]; }
export function all(col) { return Object.values(S[col]); }

export function put(col, id, data, merge = true) {
  const doc = merge ? { ...(S[col][id] || {}), ...data, id } : { ...data, id };
  S[col][id] = doc;
  const { id: _, ...body } = doc;
  queue[col + "/" + id] = { col, id, data: body, deleted: false };
  persist(); notify(); flushSoon();
  return doc;
}
export function del(col, id) {
  delete S[col][id];
  queue[col + "/" + id] = { col, id, data: {}, deleted: true };
  persist(); notify(); flushSoon();
}
export function putMany(items) { // [{col,id,data,merge}]
  items.forEach(({ col, id, data, merge = true }) => {
    const doc = merge ? { ...(S[col][id] || {}), ...data, id } : { ...data, id };
    S[col][id] = doc; const { id: _, ...body } = doc;
    queue[col + "/" + id] = { col, id, data: body, deleted: false };
  });
  persist(); notify(); flushSoon();
}
export function delMany(items) { // [{col,id}]
  items.forEach(({ col, id }) => { delete S[col][id]; queue[col + "/" + id] = { col, id, data: {}, deleted: true }; });
  persist(); notify(); flushSoon();
}

/* ---------- Supabase sync ---------- */
let flushT, flushing = false;
function flushSoon() { clearTimeout(flushT); flushT = setTimeout(flush, 400); }
export async function flush() {
  if (!sb || !sync.space || flushing) return;
  const items = Object.values(queue); if (!items.length) return;
  flushing = true;
  try {
    const rows = items.map(q => ({ space: sync.space, col: q.col, id: q.id, data: q.data, deleted: q.deleted }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from("docs").upsert(rows.slice(i, i + 200), { onConflict: "space,col,id" });
      if (error) throw error;
    }
    items.forEach(q => { const k = q.col + "/" + q.id; if (queue[k] === q) delete queue[k]; });
    persist(); sync.status = "synchron"; sync.error = null;
  } catch (e) { sync.status = "offline"; sync.error = e.message || String(e); }
  flushing = false; notify();
  if (Object.keys(queue).length && sync.status === "synchron") flushSoon();
}

function applyRow(r) {
  if (!COLS.includes(r.col)) return;
  const k = r.col + "/" + r.id;
  if (queue[k]) return; // local change pending wins until it is pushed
  if (r.deleted) delete S[r.col][r.id];
  else S[r.col][r.id] = { ...r.data, id: r.id };
}

export async function pull(full = false) {
  if (!sb || !sync.space) return;
  const since = full ? null : local.get("since", null);
  let from = 0, newest = since;
  try {
    for (;;) {
      let q = sb.from("docs").select("col,id,data,deleted,updated_at").eq("space", sync.space).order("updated_at").range(from, from + 999);
      if (since) q = q.gt("updated_at", since);
      const { data, error } = await q; if (error) throw error;
      data.forEach(r => { applyRow(r); newest = r.updated_at; });
      if (data.length < 1000) break; from += 1000;
    }
    if (newest) local.set("since", newest);
    sync.lastSync = new Date(); sync.status = "synchron"; sync.error = null;
    persist(); notify();
  } catch (e) { sync.status = "offline"; sync.error = e.message || String(e); notify(); }
}

let channel = null;
function subscribe() {
  if (!sb || !sync.space || channel) return;
  channel = sb.channel("docs-" + sync.space)
    .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "space=eq." + sync.space }, p => {
      if (p.new && p.new.col) { applyRow(p.new); if (p.new.updated_at) local.set("since", p.new.updated_at); persist(); notify(); }
    }).subscribe();
}

async function resolveSpace() {
  const { data, error } = await sb.from("space_members").select("space").eq("uid", sync.user.id).limit(1);
  if (error) throw error;
  if (data.length) return data[0].space;
  const r = await sb.rpc("create_space"); if (r.error) throw r.error;
  return r.data;
}

async function afterLogin(user) {
  sync.user = user;
  try {
    sync.space = await resolveSpace();
    const firstTime = local.get("syncedSpace", null) !== sync.space;
    if (firstTime) {
      // First sync on this device: push everything that exists locally, then pull the rest.
      COLS.forEach(c => Object.values(S[c]).forEach(d => { const { id, ...b } = d; queue[c + "/" + id] ??= { col: c, id, data: b, deleted: false }; }));
      local.set("since", null);
    }
    await flush(); await pull(firstTime);
    local.set("syncedSpace", sync.space);
    subscribe();
  } catch (e) { sync.status = "offline"; sync.error = e.message || String(e); }
  notify();
}

export async function initStore() {
  loadLocal();
  if (!sb) { sync.status = "lokal"; return; }
  const { data } = await sb.auth.getSession();
  if (data.session?.user) await afterLogin(data.session.user);
  else sync.status = "abgemeldet";
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === "SIGNED_IN" && session?.user && sync.user?.id !== session.user.id) afterLogin(session.user);
    if (ev === "SIGNED_OUT") { sync.user = null; sync.space = null; sync.status = "abgemeldet"; channel?.unsubscribe(); channel = null; notify(); }
  });
  addEventListener("online", () => { flush(); pull(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { flush(); pull(); } });
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error?.message;
}
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return error.message;
  return data.session ? null : "Bestätigungs-Mail verschickt. Link öffnen, dann hier anmelden.";
}
export async function signOut() { await sb.auth.signOut(); }
export async function inviteCode() {
  const { data, error } = await sb.from("spaces").select("invite_code").eq("id", sync.space).single();
  return error ? null : data.invite_code;
}
export async function joinSpace(code) {
  const { data, error } = await sb.rpc("join_space", { p_code: code.trim() });
  if (error) return error.message;
  sync.space = data; local.set("syncedSpace", null); await afterLogin(sync.user); return null;
}

export function exportJSON() { return JSON.stringify({ app: "arc-mode", version: 3, exported: new Date().toISOString(), data: S }, null, 1); }
export function importJSON(text) {
  const j = JSON.parse(text); const d = j.data || j;
  const items = [];
  COLS.forEach(c => Object.entries(d[c] || {}).forEach(([id, doc]) => { const { id: _, ...b } = doc; items.push({ col: c, id, data: b, merge: false }); }));
  putMany(items); return items.length;
}
