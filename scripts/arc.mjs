#!/usr/bin/env node
// Claude's command line access to Arc Mode (used from project threads).
// Credentials: JSON file {url, key, email, password, space} given via ARC_CRED (default
// /mnt/project-files/arc-mode/.claude-zugang.json). Never print the password.
//
//   node scripts/arc.mjs list <col> [--open]          list documents of a collection
//   node scripts/arc.mjs get <col> <id>
//   node scripts/arc.mjs put <col> <id> '<json>'      merge fields into a document
//   node scripts/arc.mjs del <col> <id>               delete a document
//   node scripts/arc.mjs done <taskId>                tick off a task
//   node scripts/arc.mjs add-task '<json>'            new pool task {title, tags, due, prio}
//   node scripts/arc.mjs add-event '<json>'           new event {title, date, time, kind, short, countdown}
//   node scripts/arc.mjs find <text>                  search open tasks by title
//   node scripts/arc.mjs import <file.json>           import an Arc Mode export (version 3)
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const credPath = process.env.ARC_CRED || "/mnt/project-files/arc-mode/.claude-zugang.json";
const cred = JSON.parse(fs.readFileSync(credPath, "utf8"));
const sb = createClient(cred.url, cred.key, { auth: { persistSession: false } });
const { error: loginErr } = await sb.auth.signInWithPassword({ email: cred.email, password: cred.password });
if (loginErr) { console.error("Login fehlgeschlagen:", loginErr.message); process.exit(1); }
const space = cred.space;
const uid = p => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function getDoc(col, id) {
  const { data, error } = await sb.from("docs").select("data,deleted,updated_at").eq("space", space).eq("col", col).eq("id", id).maybeSingle();
  if (error) throw error; return data && !data.deleted ? data.data : null;
}
async function putDoc(col, id, patch, merge = true) {
  const cur = merge ? (await getDoc(col, id)) || {} : {};
  const data = { ...cur, ...patch };
  const { error } = await sb.from("docs").upsert({ space, col, id, data, deleted: false }, { onConflict: "space,col,id" });
  if (error) throw error; return data;
}
async function listCol(col) {
  const out = []; let from = 0;
  for (;;) {
    const { data, error } = await sb.from("docs").select("id,data,updated_at").eq("space", space).eq("col", col).eq("deleted", false).range(from, from + 999);
    if (error) throw error; out.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return out;
}

const [cmd, a, b, c] = process.argv.slice(2);
const print = x => console.log(JSON.stringify(x, null, 1));
switch (cmd) {
  case "list": { let l = await listCol(a); if (b === "--open") l = l.filter(r => r.data.status !== "done"); print(l.map(r => ({ id: r.id, ...r.data }))); break; }
  case "del": { const { error } = await sb.from("docs").upsert({ space, col: a, id: b, data: {}, deleted: true }, { onConflict: "space,col,id" }); if (error) throw error; console.log("gelöscht", a, b); break; }
  case "get": print(await getDoc(a, b)); break;
  case "put": print(await putDoc(a, b, JSON.parse(c))); break;
  case "done": print(await putDoc("tasks", a, { status: "done", done: true, doneAt: new Date().toISOString() })); break;
  case "add-task": { const id = uid("t"); print({ id, ...(await putDoc("tasks", id, { tags: [], prio: 2, due: null, focusDate: null, status: "", note: "", created: new Date().toISOString(), source: "claude", ...JSON.parse(a) }, false)) }); break; }
  case "add-event": { const id = uid("e"); print({ id, ...(await putDoc("events", id, { kind: "termin", time: "", status: "", source: "claude", ...JSON.parse(a) }, false)) }); break; }
  case "find": { const q = a.toLowerCase(); print((await listCol("tasks")).filter(r => r.data.status !== "done" && (r.data.title || "").toLowerCase().includes(q)).map(r => ({ id: r.id, title: r.data.title, due: r.data.due, tags: r.data.tags }))); break; }
  case "import": {
    const j = JSON.parse(fs.readFileSync(a, "utf8")), d = j.data || j, rows = [];
    for (const [col, docs] of Object.entries(d)) for (const [id, doc] of Object.entries(docs || {})) { const { id: _, ...body } = doc; rows.push({ space, col, id, data: body, deleted: false }); }
    for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from("docs").upsert(rows.slice(i, i + 200), { onConflict: "space,col,id" }); if (error) throw error; }
    console.log(rows.length + " Dokumente importiert"); break;
  }
  default: console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter(l => l.startsWith("//")).join("\n"));
}
process.exit(0);
