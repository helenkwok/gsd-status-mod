// Pure: what the GSD pane draws, as data. No $ access, so it is testable under plain Node.
// A segment is [text, color, flags]: color is a Claude Code theme token or null, flags "b" for bold, "d" for dim.
import { typical, phaseTotals, dailyBuckets, spark, dur } from "./history.mjs";
import { frontmatter, summarize, items } from "./state-line.mjs";

// Theme tokens, so the pane follows the person's theme (light, dark, colour-blind) the way the engine's own UI does.
export const C = { main: "claude", agent: "suggestion", ok: "success", arch: "merged", amber: "warning", warn: "error", dim: "inactive", faint: "subtle" };

export const kTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
export const fmtUsd = (x) => `$${x >= 100 ? Math.round(x) : x.toFixed(2)}`;
export const limitLabel = (kind) => String(kind).replace(/five[_ -]?hours?/i, "5h").replace(/seven[_ -]?days?/i, "7d").replace(/[_-]+/g, " ").trim();
export const gauge = (pct, width) => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return { on: "▰".repeat(full), off: "▱".repeat(width - full) };
};
export const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
export const cut = (s, w) => (s.length <= w ? s : s.slice(0, Math.max(1, w - 1)) + "…");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const listLen = (v) => (v == null || v === "" ? 0 : Array.isArray(v) ? v.length : 1);

// Commits in the reflog text (.git/logs/HEAD), and the newest ones first: { hash, msg }.
const COMMIT = /^commit(?: \([^)]*\))?: (.*)$/;
export function commitCount(reflogText) {
  return String(reflogText ?? "").split(/\r?\n/).filter((l) => COMMIT.test(l.split("\t")[1] ?? "")).length;
}
export function commitFeed(reflogText, n = 5) {
  const out = [];
  const lines = String(reflogText ?? "").split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    const [head, msg = ""] = lines[i].split("\t");
    const m = COMMIT.exec(msg);
    if (m) out.push({ hash: (head.split(" ")[1] ?? "").slice(0, 7), msg: m[1] });
  }
  return out;
}

// A directory of the project's work (spikes/, threads/, quick/, ...) -> how many items it holds and the newest one.
// Sub-directories count when there are any (a spike is a folder), else files. The newest is the latest by modified
// time when the entries have one, else the last by name with numbers in order (247 after 99).
export function streamInfo(entries) {
  const live = (entries ?? []).filter((e) => !e.name.startsWith("."));
  const dirs = live.filter((e) => e.kind === "dir" || (e.isLink && e.kind !== "file"));
  const kept = dirs.length ? dirs : live.filter((e) => e.kind === "file" && !/^[A-Z][A-Z0-9_-]*\.md$/.test(e.name));
  if (!kept.length) return null;
  const timed = kept.filter((e) => e.mtimeMs > 0);
  const byNewest = timed.length
    ? [...kept].sort((a, b) => b.mtimeMs - a.mtimeMs)
    : [...kept].sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  const names = byNewest.map((e) => e.name.replace(/\.md$/, ""));
  return { count: kept.length, newest: names[0], recent: names.slice(0, 5), ...(kept.some((e) => e.from) ? { paths: byNewest.slice(0, 5).map((e) => `${e.from}/${e.name}`) } : {}) };
}

// A file path for the log: from ".planning/" on when it is under it, else the last two parts.
export function shortPath(p) {
  const s = String(p ?? "");
  const i = s.indexOf(".planning/");
  if (i >= 0) return s.slice(i);
  const parts = s.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

// A line is segments, or a segment list that is also a control: { segs, toggle: { key, open, hotkey } } draws a
// ▸/▾ button before its segments; { button: { key, label, color, hotkey } } is one whole-line button.
export const segsOf = (line) => (Array.isArray(line) ? line : line.segs ?? [[line.button?.label ?? "", line.button?.color ?? null]]);

const hms = (ms) => new Date(ms).toTimeString().slice(0, 8);
const shortType = (t) => String(t ?? "agent").replace(/^gsd-/, "");

// The log's rows: time, a short kind word, the text.
const KIND = { prompt: ["you", C.dim], spawn: ["spawn", C.agent], done: ["done", C.ok], fail: ["failed", C.warn], commit: ["commit", C.arch], write: ["wrote", C.main], error: ["error", C.warn], turn: ["turn", C.dim] };

// Agents in tree order: each agent's children (forks, sub-agents) follow it, one level deeper. An agent whose parent is
// not in the list (the main loop, or a parent that has gone) is a root. Roots show running first, then the latest to
// finish; children in the order they started.
export function agentTree(agents) {
  const list = agents ?? [];
  const ids = new Set(list.map((a) => a.id));
  const kids = new Map();
  const roots = [];
  for (const a of list) {
    if (a.parentId && ids.has(a.parentId) && a.parentId !== a.id) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a]);
    else roots.push(a);
  }
  const rank = (a) => (a.status === "running" ? 0 : 1);
  roots.sort((a, b) => rank(a) - rank(b) || (b.endedAt ?? b.since ?? 0) - (a.endedAt ?? a.since ?? 0));
  const out = [];
  const seen = new Set();
  const walk = (a, depth) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    out.push({ ...a, depth });
    for (const k of [...(kids.get(a.id) ?? [])].sort((x, y) => (x.since ?? 0) - (y.since ?? 0))) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const a of list) walk(a, 0); // anything a parent cycle left out
  return out;
}

// Which of the tree's agents to draw. Running and failed agents always show, with the agents that started them, so
// the tree stays readable; finished ones are collapsed: the latest `keep` while something runs (a wave should not push
// the live agents off the box), up to `budget` lines when nothing does. Returns { shown (tree order), hidden }.
export function visibleAgents(tree, { budget = 8, keep = 2, cap = 12 } = {}) {
  const byId = new Map(tree.map((a) => [a.id, a]));
  const need = new Set();
  for (const a of tree) {
    if (a.status !== "running" && a.status !== "failed" && a.status !== "killed") continue;
    for (let n = a, hops = 0; n && !need.has(n.id) && hops < 20; n = byId.get(n.parentId), hops++) need.add(n.id);
  }
  const anyLive = tree.some((a) => a.status === "running");
  const spare = Math.max(0, Math.min(anyLive ? keep : budget, budget - need.size));
  const finished = tree.filter((a) => !need.has(a.id)).sort((x, y) => (y.endedAt ?? y.since ?? 0) - (x.endedAt ?? x.since ?? 0));
  for (const a of finished.slice(0, spare)) need.add(a.id);
  const shown = tree.filter((a) => need.has(a.id)).slice(0, cap);
  return { shown, hidden: tree.length - shown.length };
}

// The phase checklist of a ROADMAP.md: "- [x] **Phase 2.1: name** - blurb". Only that one line shape is read, so a
// hand-edited roadmap yields fewer rows rather than wrong ones. -> [{ id, name, done }]
export function roadmapPhases(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/^\s*[-*]\s*\[( |x|X)\]\s*\*\*Phase\s+([\w.]+?):?\s+(.+?)\*\*/gm)) out.push({ id: m[2], name: m[3].trim(), done: m[1] !== " " });
  return out;
}

// Which roadmap phase STATE.md says is current: by number, else by the label that leads the phase name. Never a guess.
function currentIndex(phases, fm) {
  const num = String(fm.current_phase ?? "").trim();
  if (num) { const i = phases.findIndex((p) => p.id === num || p.id.replace(/^0+(?=\d)/, "") === num.replace(/^0+(?=\d)/, "")); if (i >= 0) return i; }
  const lead = String(fm.current_phase_name ?? "").split(/\s/)[0].toLowerCase();
  if (lead.length > 1) { const hits = phases.map((p, i) => (p.name.toLowerCase().split(/\s/)[0] === lead ? i : -1)).filter((i) => i >= 0); if (hits.length === 1) return hits[0]; }
  return -1;
}

// --- pace: where a GSD run's time goes

// Plans of the current phase -> how they are laid out to run. A wave is a set of plans that may run together, so plans
// left to run in single-plan waves go one after another. plans: [{ id, wave, done }]
export function planShape(plans) {
  const byWave = new Map();
  for (const p of plans ?? []) (byWave.get(p.wave) ?? byWave.set(p.wave, []).get(p.wave)).push(p);
  const open = (plans ?? []).filter((p) => !p.done);
  const openWaves = new Map();
  for (const p of open) openWaves.set(p.wave, (openWaves.get(p.wave) ?? 0) + 1);
  return {
    total: (plans ?? []).length, open: open.length, waves: openWaves.size, widest: Math.max(0, ...openWaves.values()),
    byWave: [...byWave].sort((a, b) => a[0] - b[0]),
  };
}

// This session's agents -> share of agent time by type, and how parallel they ran (agent time / wall time, 1.0 = one
// at a time). agents: [{ type, since, endedAt }]; a running agent counts up to `now`.
export function agentPace(agents, now) {
  const iv = (agents ?? []).filter((a) => a.since).map((a) => ({ type: shortType(a.type), a: a.since, b: Math.max(a.since, a.endedAt ?? now) }));
  const spanOf = (list) => { // wall time covered by the intervals, overlaps counted once
    let wall = 0, cur = null;
    for (const x of [...list].sort((p, q) => p.a - q.a)) {
      if (!cur || x.a > cur.b) { if (cur) wall += cur.b - cur.a; cur = { a: x.a, b: x.b }; } else cur.b = Math.max(cur.b, x.b);
    }
    return wall + (cur ? cur.b - cur.a : 0);
  };
  const sums = new Map();
  for (const x of iv) sums.set(x.type, (sums.get(x.type) ?? 0) + (x.b - x.a));
  const total = [...sums.values()].reduce((m, v) => m + v, 0);
  const ex = iv.filter((x) => x.type === "executor");
  const exSum = ex.reduce((m, x) => m + x.b - x.a, 0);
  const exWall = ex.length ? spanOf(ex) : 0;
  return {
    total, byType: [...sums].sort((a, b) => b[1] - a[1]), count: iv.length,
    executors: ex.length, executorParallel: exWall > 0 ? exSum / exWall : null,
  };
}

// --- the markdown reader's pure parts

// The YAML block at the top of a GSD file: the dashboard already shows STATE's fields, so the reader hides it.
export const stripFrontmatter = (t) => String(t ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

// Pages of at most `max` characters (the Markdown element draws at most 10000), cut at a line, never inside a code fence.
// ponytail: a single fenced block over 9500 characters is cut mid-fence, so show it raw if that ever matters.
export function pages(text, max = 8000) {
  const out = [];
  let cur = "", fence = false;
  for (const line of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    if (cur.length + line.length + 1 > max && cur.trim() && (!fence || cur.length > 9500)) { out.push(cur.trimEnd()); cur = ""; }
    cur += line + "\n";
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out.length ? out : [""];
}

// GSD files are full of task lists; the renderer draws "[x]" literally, so give them glyphs.
const tick = (t) => t.replace(/^(\s*[-*] )\[( |x|X)\] /gm, (_, lead, c) => `${lead}${c === " " ? "○" : "✓"} `);

// One folder of .planning for the browser: sub-folders first, then the .md files, numbers in order (phase 2 before 10).
export function browseList(entries) {
  const isDir = (e) => e.kind === "dir" || (e.isLink && e.kind !== "file");
  return (entries ?? [])
    .filter((e) => !e.name.startsWith(".") && (isDir(e) || /\.md$/i.test(e.name)))
    .map((e) => ({ name: e.name, dir: isDir(e) }))
    .sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// The reader view: replaces the dashboard. rd: { path, isFile, entries?, text? }. A line is a button or { md }.
function readerModel(rd, header, inner) {
  const crumb = String(rd.path).replace(/^\.planning\/?/, "") || ".planning";
  const lines = [{ button: { key: "reader:up", label: rd.path === ".planning" ? "‹ back to the dashboard" : "‹ back", color: C.dim, hotkey: "b" } }];
  if (rd.path !== ".planning") lines.push({ button: { key: "reader:close", label: "⌂ dashboard", color: C.dim, hotkey: "d" } });
  let right = null;
  if (rd.isFile) {
    // The engine refuses the WHOLE pane if one Markdown block passes 10000 characters, so a block is cut at 9900 as a last resort.
    for (const chunk of pages(tick(stripFrontmatter(rd.text)))) lines.push({ md: chunk.slice(0, 9900) });
    lines.push({ button: { key: "reader:top", label: "↑ back to top", color: C.dim, hotkey: "t" } });
  } else {
    const list = browseList(rd.entries);
    if (!list.length) lines.push([["no markdown here", C.dim]]);
    for (const e of list.slice(0, 40)) lines.push({ button: { key: `reader:open:${e.name}`, label: `${e.dir ? "▸" : " "} ${e.name}${e.dir ? "/" : ""}`, color: e.dir ? C.arch : null } });
    if (list.length > 40) lines.push([[`+${list.length - 40} more`, C.dim]]);
    right = [[`${list.length}`, C.dim]];
  }
  return { header, panels: [{ id: "reader", color: C.arch, title: [[cut(crumb, inner - 8), C.arch, "b"]], right, lines }] };
}

// The trends view: replaces the dashboard. Three charts from the recorded runs, each labelled with its numbers.
function trendsModel(inp, header, inner, now) {
  const runs = inp.history ?? [];
  const lines = [{ button: { key: "trends", label: "‹ back", color: C.dim, hotkey: "b" } }];
  const ex = runs.filter((r) => shortType(r[1]) === "executor").slice(-30).map((r) => r[3]);
  lines.push([["executor time per run", null, "b"], [`  last ${ex.length}`, C.dim]]);
  if (ex.length < 3) lines.push([["not enough executor runs yet (3 needed)", C.dim]]);
  else {
    const o = [...ex].sort((a, b) => a - b);
    lines.push([[spark(ex), C.main]]);
    lines.push([[`min ${dur(o[0])} · median ${dur(o[(o.length - 1) >> 1])} · max ${dur(o[o.length - 1])} · last ${dur(ex[ex.length - 1])}`, C.dim]]);
  }
  lines.push([[" ", null]]);
  const ph = phaseTotals(runs);
  lines.push([["time by phase and stage", null, "b"]]);
  lines.push([["█ ", C.agent], ["planning  ", C.dim], ["█ ", C.main], ["executing  ", C.dim], ["█ ", C.ok], ["checking  ", C.dim], ["█ ", C.faint], ["other", C.dim]]);
  if (!ph.length) lines.push([["no runs recorded yet", C.dim]]);
  const top = Math.max(1, ...ph.map((x) => x.total)), width = Math.max(8, inner - 14);
  for (const x of ph) {
    const bar = [["planning", C.agent], ["executing", C.main], ["checking", C.ok], ["other", C.faint]].filter(([k]) => x[k] > 0).map(([k, c]) => ["█".repeat(Math.max(1, Math.round((x[k] / top) * width))), c]);
    lines.push([[`ph ${x.phase}`.padEnd(6), C.dim], ...bar, [` ${dur(x.total)}`, null]]);
  }
  lines.push([[" ", null]]);
  const days = dailyBuckets(runs, now, 14);
  const day = (ms) => new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric" });
  const peak = days.reduce((m, d) => (d.ms > m.ms ? d : m), days[0]);
  lines.push([["agent time per day", null, "b"], ["  last 14 days", C.dim]]);
  lines.push([[spark(days.map((d) => d.ms)), C.agent]]);
  lines.push([[`${day(days[0].start)} to today` + (peak.ms > 0 ? ` · peak ${dur(peak.ms)} on ${day(peak.start)}` : ""), C.dim]]);
  lines.push([[" ", null]]);
  lines.push([[cut("phase = STATE.md's current_phase when the agent started", inner), C.dim]]);
  return { header, panels: [{ id: "trends", color: C.amber, title: [["trends", C.amber, "b"]], right: [[`${runs.length} agents recorded`, C.dim]], lines }] };
}

// in: {
//   history: [[endedAt, type, phase, durMs, turns, inTok, outTok, model]],   // finished agents of this project
//   plans: [{ id, wave, done }],   // the current phase's plans
//   reader: { path, isFile, entries, text } | null,   // the markdown reader, when open
//   roadmap: ROADMAP.md text | null,
//   state: STATE.md text | null,
//   usage: { pct, tokens, window, costUsd, limits: [{kind, pct}] } | null,
//   isRunning: boolean,            // a turn is running now
//   turn: { startedAt, edits, errors } | null,        // the running turn
//   receipt: { durationMs, edits, errors, commits, costDelta } | null,   // the last finished turn
//   agents: [{ id, type, description, status, since, endedAt }],
//   streams: [{ name, count, newest }],
//   handoff: object | null,
//   log: [{ at, kind, text }],
//   now: ms }
// -> { header: segments, panels: [{ id, color, title: segments, right: segments|null, lines: [segments] }] }
export function panelModel(inp, width = 62) {
  const ex = { agents: new Set(), finished: false, blockers: false, log: false, roadmap: false, pace: false, trends: false, ...(inp.expand ?? {}) };
  const w = Math.max(36, width);
  const inner = w - 4; // the border and one column of padding on each side
  const fm = frontmatter(inp.state ?? "") ?? {};
  const panels = [];
  const now = inp.now ?? 0;

  const phase = fm.current_phase ? `phase ${fm.current_phase}${fm.current_phase_name ? " " + fm.current_phase_name : ""}` : fm.milestone ?? "";
  const ws = inp.workstream ?? null;
  const header = [["GSD", C.main, "b"], ...(ws ? [[" · ", C.dim], [cut(ws.name, 24), C.amber]] : []), ...(phase ? [[" · ", C.dim], [cut(phase, w - 22), null, "b"]] : []), ...(fm.status ? [[` · ${fm.status}`, C.dim]] : [])];

  if (inp.reader) return readerModel(inp.reader, header, inner);
  if (ex.trends) return trendsModel(inp, header, inner, now);

  // main: the session's vitals, and anything that needs a person
  const main = [];
  const u = inp.usage;
  if (u && u.pct != null) {
    const g = gauge(u.pct, 10);
    const hot = u.pct >= 80 ? C.warn : u.pct >= 60 ? C.amber : C.main;
    main.push([["ctx ", C.dim], [g.on, hot], [g.off, C.faint], [` ${Math.round(u.pct)}%`, null, "b"], ...(u.tokens != null && u.window ? [[` ${kTokens(u.tokens)}/${kTokens(u.window)}`, C.dim]] : [])]);
  }
  if (u && (u.costUsd != null || (u.limits ?? []).length)) {
    const row = [];
    if (u.costUsd != null) row.push([`${fmtUsd(u.costUsd)}   `, null]);
    for (const l of (u.limits ?? []).slice(0, 2)) {
      const g = gauge(l.pct, 5);
      row.push([`${limitLabel(l.kind)} `, C.dim], [g.on, l.pct >= 80 ? C.warn : C.main], [g.off, C.faint], [` ${Math.round(l.pct)}%   `, C.dim]);
    }
    main.push(row);
  }
  if (ws && ws.total > 1) main.push({ button: { key: "ws", label: `⇄ workstream ${cut(ws.name, inner - 26)} · ${ws.index} of ${ws.total}`, color: C.amber, hotkey: "w" } });
  const h = inp.handoff;
  const blockers = h ? listLen(h.blockers) : 0;
  const people = h ? listLen(h.human_actions_pending) : 0;
  if (blockers || people) {
    const label = `${ex.blockers ? "▾" : "▸"} ${[blockers ? `⚠ ${plural(blockers, "blocker")}` : "", people ? `${people} need${people === 1 ? "s" : ""} a person` : ""].filter(Boolean).join(" · ")}`;
    main.push({ button: { key: "blockers", label, color: blockers ? C.warn : C.amber, hotkey: "b" } });
    if (ex.blockers) {
      for (const t of items(h.blockers)) main.push([["  - ", C.warn], [cut(t, inner - 4), null]]);
      for (const t of items(h.human_actions_pending)) main.push([["  - ", C.amber], [cut(t, inner - 4), null]]);
    }
  }
  main.push({ button: { key: "reader:browse", label: "▸ read .planning", color: C.arch, hotkey: "o" } });
  if (fm.last_activity_desc && !(u && u.pct != null)) main.push([[cut(summarize(fm.last_activity_desc, inner), inner), C.dim]]);
  panels.push({
    id: "main", color: C.main,
    title: [[cut(phase || "GSD project", inner - 12), C.main, "b"]],
    right: [inp.isRunning ? ["● working", C.main] : (inp.agents ?? []).some((a) => a.status === "running") ? ["◐ agents working", C.agent] : ["○ idle", C.dim]],
    lines: main,
  });

  // roadmap: the phases, with the current one marked. Finished phases and far-off ones fold into one button.
  const road = roadmapPhases(inp.roadmap);
  if (road.length) {
    const cur = currentIndex(road, fm);
    const doneN = road.filter((p) => p.done).length;
    const first = cur >= 0 ? cur : Math.max(0, road.findIndex((p) => !p.done));
    const WINDOW = 6;
    const from = ex.roadmap ? 0 : first;
    const to = ex.roadmap ? road.length : Math.min(road.length, first + WINDOW);
    const lines = [];
    const before = ex.roadmap ? 0 : from, after = ex.roadmap ? 0 : road.length - to;
    if (!ex.roadmap && (before || after)) lines.push({ button: { key: "roadmap", label: `▸ ${[before ? `${before} before` : "", after ? `${after} later` : ""].filter(Boolean).join(" · ")}`, color: C.dim, hotkey: "r" } });
    road.slice(from, to).forEach((p, i) => {
      const here = from + i === cur;
      const glyph = p.done ? "✓" : here ? "▶" : "·";
      const id = p.id.padEnd(4);
      lines.push([[`${glyph} `, p.done ? C.ok : here ? C.main : C.faint], [id + " ", here ? C.main : C.dim, here ? "b" : undefined], [cut(p.name, inner - 2 - id.length - 1), p.done ? C.dim : null, here ? "b" : undefined]]);
    });
    if (ex.roadmap) lines.push({ button: { key: "roadmap", label: "▾ collapse", color: C.dim, hotkey: "r" } });
    const sm = String(inp.state ?? "");
    const pn = Number(/^\s*completed_plans:\s*(\d+)/m.exec(sm)?.[1]), pt = Number(/^\s*total_plans:\s*(\d+)/m.exec(sm)?.[1]);
    panels.push({ id: "roadmap", color: C.ok, title: [["roadmap", C.ok, "b"]],
      right: [[`${doneN}/${road.length} phases${pt ? ` · ${pn}/${pt} plans` : ""}`, C.dim]], lines });
  }

  // pace: how the plans are laid out, and where this session's agent time went. The hint shows only on clear evidence.
  const shape = planShape(inp.plans);
  const pace = agentPace(inp.agents, now);
  const showTime = pace.total >= 60000;
  const hist = inp.history ?? [];
  if (shape.total || showTime || hist.length) {
    const lines = [];
    const serialPlans = shape.open >= 2 && shape.widest === 1;
    const serialRun = pace.executors >= 2 && pace.executorParallel != null && pace.executorParallel < 1.15 && pace.total >= 120000;
    if (shape.total) lines.push([["plans ", C.dim], [`${shape.open} to run of ${shape.total} · ${plural(shape.waves, "wave")} · widest ${shape.widest}`, null]]);
    if (serialPlans) lines.push([["serial: each plan waits for the one before it", C.amber]]);
    if (showTime) {
      lines.push([["time  ", C.dim], [pace.byType.slice(0, 3).map(([t, ms]) => `${t} ${Math.round((100 * ms) / pace.total)}%`).join(" · "), null]]);
      if (serialRun) lines.push([["serial: executors ran one at a time", C.amber], [` ×${pace.executorParallel.toFixed(1)}`, C.dim]]);
    }
    lines.push({ button: { key: "pace", label: `${ex.pace ? "▾ hide" : "▸"} details`, color: C.dim, hotkey: "p" } });
    if (hist.length) lines.push({ button: { key: "trends", label: "▸ trends", color: C.dim, hotkey: "t" } });
    if (ex.pace) {
      for (const [wave, list] of shape.byWave) lines.push([[`  wave ${wave}  `, C.dim], [list.map((p) => `${p.id} ${p.done ? "✓" : "○"}`).join("  "), null]]);
      const wid = Math.max(...pace.byType.map(([t]) => t.length)) + 2;
      for (const [t, ms] of pace.byType) lines.push([[`  ${t.padEnd(wid)}`, C.dim], [clock(ms), null], [`  ${Math.round((100 * ms) / pace.total)}%`, C.dim]]);
      const here = phaseTotals(hist.filter((r) => String(r[2]) === String(fm.current_phase ?? "")), 1)[0];
      if (here) lines.push([["  this phase  ", C.dim], [["planning", "executing", "checking"].filter((k) => here[k] > 0).map((k) => `${k} ${dur(here[k])}`).join(" · "), null]]);
      if (pace.executors >= 2 && pace.executorParallel != null) lines.push([["  executors in parallel ", C.dim], [`×${pace.executorParallel.toFixed(2)}`, null]]);
    }
    panels.push({ id: "pace", color: C.amber, title: [["pace", C.amber, "b"]], right: shape.total && serialPlans ? [["serial", C.amber]] : null, lines });
  }

  // agents: a tree, so a fork or a sub-agent sits under the agent that started it
  const tree = agentTree(inp.agents);
  if (tree.length) {
    const running = tree.filter((a) => a.status === "running").length;
    const forks = tree.filter((a) => a.isFork).length;
    const base = visibleAgents(tree);
    const { shown, hidden } = ex.finished ? visibleAgents(tree, { budget: 12, keep: 12 }) : base;
    const lines = [];
    shown.forEach((a, i) => {
      const isRun = a.status === "running";
      const bad = a.status === "failed" || a.status === "killed";
      const glyph = isRun ? "◐" : bad ? "✗" : "✓";
      const t = isRun ? now - (a.since ?? now) : (a.endedAt ?? now) - (a.since ?? now);
      const right = a.since ? clock(Math.max(0, t)) : "";
      const typ = isRun && a.since ? typical(inp.history, a.type) : null; // what this kind of agent usually takes here
      const typTxt = typ ? ` · typ ${clock(typ)}` : "";
      const indent = a.depth ? "  ".repeat(Math.min(a.depth, 3) - 1) + "└ " : "";
      const label = `${a.isFork ? "⑂ " : ""}${shortType(a.type)} `;
      const room = Math.max(4, inner - 8 - indent.length - label.length - right.length - typTxt.length - 1);
      const open = ex.agents.has(a.id);
      lines.push({
        toggle: { key: `agent:${a.id}`, open, hotkey: i < 6 ? String(i + 1) : undefined },
        segs: [[`${glyph} `, isRun ? C.agent : bad ? C.warn : C.ok], [indent, C.faint], [label, null, "b"], [cut(String(a.description ?? "").replace(/\s+/g, " "), room).padEnd(room + 1), C.dim], [right, isRun ? C.agent : C.dim], ...(typTxt ? [[typTxt, t > 2 * typ ? C.amber : C.dim]] : [])],
      });
      if (open) {
        const full = String(a.description ?? "").replace(/\s+/g, " ").trim();
        for (const part of [full.slice(0, inner - 4), full.slice(inner - 4, 2 * (inner - 4))].filter(Boolean)) lines.push([["    ", null], [part, null]]);
        const parent = a.parentId ? tree.find((x) => x.id === a.parentId) : null;
        lines.push([["    ", null], [`id ${String(a.id).slice(0, 8)} · ${a.type}${a.isFork ? " · fork" : ""}${a.parentId ? ` · under ${parent ? shortType(parent.type) : String(a.parentId).slice(0, 8)}` : ""} · ${a.status}`, C.dim]]);
      }
    });
    const hiddenLive = tree.filter((a) => a.status === "running" && !shown.includes(a)).length;
    if (hiddenLive) lines.push([[`+${hiddenLive} running, ${hidden - hiddenLive} finished not shown`, C.agent]]);
    else if (!ex.finished && hidden) lines.push({ button: { key: "finished", label: `▸ ${hidden} more finished`, color: C.ok, hotkey: "f" } });
    else if (ex.finished && base.hidden) lines.push({ button: { key: "finished", label: "▾ collapse finished", color: C.dim, hotkey: "f" } });
    const depth = Math.max(...tree.map((a) => a.depth));
    panels.push({ id: "agents", color: C.agent, title: [[`agents · ${running} running`, C.agent, "b"]],
      right: [[`${tree.length} total${forks ? ` · ${forks} fork${forks === 1 ? "" : "s"}` : ""}${depth ? ` · ${depth + 1} deep` : ""}`, C.dim]], lines });
  }

  // turn: the one running now, else the last receipt
  if (inp.isRunning && inp.turn) {
    panels.push({ id: "turn", color: C.main, title: [["turn", C.main, "b"]], right: [[clock(Math.max(0, now - inp.turn.startedAt)), C.main]],
      lines: [[[`${plural(inp.turn.edits, "edit")} · ${plural(inp.turn.errors, "error")}`, C.dim]]] });
  } else if (inp.receipt) {
    const r = inp.receipt;
    const bits = [`${Math.round(r.durationMs / 1000)}s`, plural(r.edits, "edit"), plural(r.commits, "commit"), plural(r.errors, "error")];
    if (r.costDelta != null && r.costDelta > 0) bits.push(`+${fmtUsd(r.costDelta)}`);
    panels.push({ id: "turn", color: C.faint, title: [["last turn", C.dim, "b"]], right: [["✓", C.ok]], lines: [[[bits.join(" · "), C.dim]]] });
  }

  // streams: the kinds of work this project holds, and the newest of each
  if ((inp.streams ?? []).length) {
    const lines = [];
    for (const st of inp.streams) {
      const open = ex.streams?.has?.(st.name);
      lines.push({ toggle: { key: `stream:${st.name}`, open }, segs: [[st.name.padEnd(8), C.dim], [String(st.count).padStart(4) + "  ", null, "b"], [cut(st.newest, inner - 16), C.dim]] });
      if (open) (st.recent ?? [st.newest]).slice(0, 5).forEach((n, i) => lines.push(st.paths?.[i] ? { button: { key: `reader:open-path:${st.paths[i]}`, label: `    ${cut(n, inner - 8)}`, color: C.dim } } : [["      ", null], [cut(n, inner - 8), C.dim]]));
    }
    panels.push({ id: "streams", color: C.arch, title: [["work streams", C.arch, "b"]], right: null, lines });
  }

  // log: what happened, newest last; the button shows earlier entries
  const all = inp.log ?? [];
  const log = ex.log ? all.slice(-24) : all.slice(-8);
  if (log.length) {
    const lines = log.map((l) => {
      const [word, color] = KIND[l.kind] ?? [l.kind, C.dim];
      return [[`${hms(l.at)} `, C.dim], [word.padEnd(7), color, "b"], [cut(l.text, inner - 17), null]];
    });
    if (!ex.log && all.length > 8) lines.unshift({ button: { key: "log", label: `▸ ${Math.min(all.length, 24) - 8} earlier`, color: C.dim, hotkey: "l" } });
    else if (ex.log && all.length > 8) lines.unshift({ button: { key: "log", label: "▾ show less", color: C.dim, hotkey: "l" } });
    panels.push({ id: "log", color: C.faint, title: [["session log", C.dim, "b"]], right: null, lines });
  }
  return { header, panels };
}
