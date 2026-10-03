import { frontmatter, isGsdState, resumeLine, handoffInfo, driftNote, statusReport, pickWorkstream } from "./state-line.mjs";
import { panelModel, streamInfo, commitCount, commitFeed, shortPath } from "./panel.mjs";

// The command named by the handoff's next_action (see nextCommand) is offered as a dim suggestion: Tab puts it in the
// prompt box and nothing runs until the person presses Enter. No command named, no suggestion.

// Module state: the render hooks only read these, never touch the file system.
let rows = { resume: null, drift: null, handoff: null, command: null };
let suggested = false;
let panePlaced = false; // true while our pane is on screen: the band above the prompt would only repeat it
let openOnStart = true;
let isGsd = false;
let live = freshLive(); // what the pane draws: events of this session plus what the last refresh read
let lastRefreshAt = 0;
const seen = new Map(); // agent id -> { since, status, endedAt }: when this module first saw it, and how it last stood
const forks = new Set(); // ids of agents started as forks of their parent (only the spawn event says so)
const PANE = "gsd-board";
// What the person has opened in the pane by clicking (or pressing a hotkey): agent rows, finished agents, blockers, streams, log.
let reader = null; // the markdown reader: { path, isFile, entries | text }, or null for the dashboard
const expand = { agents: new Set(), roadmap: false, pace: false, finished: false, blockers: false, streams: new Set(), log: false };
const PANE_SIZE = { columns: 64, rows: 16 };
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const STREAMS = ["phases", "spikes", "threads", "quick", "todos", "seeds", "notes"];

// A press on one of the pane's buttons: flip what it names. The key says which: "agent:<id>", "stream:<name>", or a word.
function flip(key) {
  if (key === "ws") {
    const n = wsInfo?.names ?? [];
    if (n.length > 1) wsChoice = n[(n.indexOf(wsInfo.name) + 1) % n.length];
    return;
  }
  const [kind, id] = String(key).split(/:(.*)/s);
  const set = kind === "agent" ? expand.agents : kind === "stream" ? expand.streams : null;
  if (set) { if (!set.delete(id)) set.add(id); return; }
  if (kind in expand && typeof expand[kind] === "boolean") expand[kind] = !expand[kind];
}

function freshLive() {
  return { state: null, roadmap: null, plans: [], workstream: null, handoff: null, usage: null, agents: [], streams: [], log: [], isRunning: false, turn: null, receipt: null,
    commits: 0, newest: null, startCommits: 0, startCost: null };
}

function note(kind, text, at) {
  live.log = [...live.log, { at, kind, text }].slice(-40);
}

// Paths are read from the session root, not the current directory: Bash can `cd` anywhere, and a cwd-relative
// ".planning/STATE.md" then goes missing and the pane flips to "No GSD project here".
let root = "";
let planRoot = ""; // where .planning lives: the session root, or the main checkout when the session is in a linked worktree
const at = (path) => {
  const base = path.startsWith(".planning") ? planRoot || root : root;
  return base ? `${base}/${path}` : path;
};
// Workstream mode: STATE.md, ROADMAP.md and the work streams live under .planning/workstreams/<name>/.
let wsBase = ""; // "" for a normal project, else ".planning/workstreams/<name>"
let wsChoice = ""; // the workstream the person picked in the pane
let wsInfo = null; // { name, index, total, names }
const plan = (name) => `${wsBase || ".planning"}/${name}`;
const read = ($, path) => $.fs.read(at(path)).catch(() => null);
async function resolvePlan($) {
  wsBase = ""; wsInfo = null;
  if ((await read($, ".planning/STATE.md")) != null) return;
  const dirs = (await $.fs.list(at(".planning/workstreams")).catch(() => [])).filter((e) => e.kind === "dir" && !e.name.startsWith("."));
  const cands = [];
  for (const d of dirs) {
    const st = await $.fs.stat(at(`.planning/workstreams/${d.name}/STATE.md`)).catch(() => null);
    if (st) cands.push({ name: d.name, mtimeMs: st.mtimeMs ?? 0 });
  }
  const pick = pickWorkstream(cands, (await read($, ".planning/active-workstream")) ?? "", wsChoice);
  if (pick) { wsInfo = pick; wsBase = `.planning/workstreams/${pick.name}`; }
}

async function findRoot($) {
  if (root) return;
  root = String((await $.session.root().catch(() => "")) ?? "").replace(/\/+$/, "");
  // A linked worktree has no .planning of its own: its .git file points into <main>/.git/worktrees/<name>.
  if (root && (await read($, ".planning/STATE.md")) == null) {
    const ptr = await read($, ".git");
    const main = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/\s]+\s*$/m.exec(ptr ?? "")?.[1];
    if (main && ((await $.fs.read(`${main}/.planning/STATE.md`).catch(() => null)) != null || (await $.fs.list(`${main}/.planning/workstreams`).catch(() => [])).length)) planRoot = main;
  }
}

// The reflog lives in .git/logs/HEAD; in a linked worktree .git is a file pointing at the real git dir.
async function reflog($) {
  const direct = await read($, ".git/logs/HEAD");
  if (direct != null) return direct;
  const ptr = await read($, ".git");
  const dir = ptr && /^gitdir:\s*(.+)$/m.exec(ptr)?.[1]?.trim();
  return dir ? read($, `${dir}/logs/HEAD`) : null;
}

async function readUsage($) {
  const u = await $.session.usage().catch(() => null);
  if (!u) return null;
  return { pct: u.context?.percent ?? null, tokens: u.context?.tokens ?? null, window: u.context?.window ?? null, costUsd: u.cost?.usd ?? null,
    limits: (u.rateLimits ?? []).map((r) => ({ kind: r.kind, pct: r.percentUsed })) };
}

// Live agents, with when each was first seen and, as they finish, a line in the log.
async function readAgents($, now) {
  const listed = await $.agent.list().catch(() => []);
  const agents = listed.map((a) => {
    const before = seen.get(a.id);
    const rec = before ?? { since: now, status: a.status, endedAt: null };
    if (before && before.status === "running" && a.status !== "running") {
      rec.endedAt = now;
      const bad = a.status === "failed" || a.status === "killed";
      note(bad ? "fail" : "done", `${String(a.type).replace(/^gsd-/, "")} ${Math.round((now - rec.since) / 1000)}s`, now);
    }
    rec.status = a.status;
    seen.set(a.id, rec);
    return { ...a, since: rec.since, endedAt: rec.endedAt, isFork: forks.has(a.id) };
  });
  return agents;
}

// The current phase's plans and whether each is done, for the pace box. The phase folder is matched by number (04 is 4,
// 02.1 is 2.1); a plan is done when its NN-MM-SUMMARY.md exists; a plan with no `wave:` is left out.
async function readPlans($, state) {
  const num = String(frontmatter(state)?.current_phase ?? "").replace(/^0+(?=\d)/, "");
  if (!num) return [];
  const dirs = await $.fs.list(at(plan("phases"))).catch(() => []);
  const dir = dirs.find((e) => e.kind === "dir" && e.name.split("-")[0].replace(/^0+(?=\d)/, "") === num);
  if (!dir) return [];
  const base = `${plan("phases")}/${dir.name}`;
  const files = await $.fs.list(at(base)).catch(() => []);
  const out = [];
  for (const f of files) {
    const id = /^(.*)-PLAN\.md$/.exec(f.name)?.[1];
    if (!id) continue;
    const wave = Number(frontmatter((await read($, `${base}/${f.name}`)) ?? "")?.wave);
    if (wave) out.push({ id, wave, done: files.some((x) => x.name === `${id}-SUMMARY.md`) });
  }
  return out;
}

async function readStreams($) {
  const out = [];
  for (const name of STREAMS) {
    // In workstream mode the project-wide folders (threads, spikes, seeds...) stay at .planning/, beside the workstream's own.
    const here = await $.fs.list(at(plan(name))).catch(() => []);
    const top = wsBase ? await $.fs.list(at(`.planning/${name}`)).catch(() => []) : [];
    const info = streamInfo([...here.map((e) => ({ ...e, from: plan(name) })), ...top.map((e) => ({ ...e, from: `.planning/${name}` }))]);
    if (info) out.push({ name, ...info });
  }
  return out;
}

// Everything the band, the hint and the pane need. The work streams are listed only when `full` (they change rarely).
async function refresh($, full = true) {
  await findRoot($);
  await resolvePlan($);
  const now = await $.clock.now();
  lastRefreshAt = now;
  const state = await read($, plan("STATE.md"));
  isGsd = state != null && isGsdState(state);
  const handoffText = isGsd ? (await read($, plan("HANDOFF.json"))) ?? (wsBase ? await read($, ".planning/HANDOFF.json") : null) : null;
  const handoff = handoffText == null ? null : handoffInfo(handoffText, now);
  rows = { resume: isGsd ? resumeLine(state) : null, handoff: handoff?.line ?? null, command: handoff?.command ?? null, drift: null };
  if (!isGsd) { live = freshLive(); $.ui.invalidate("ui.render"); return; }

  let parsed = null;
  try { parsed = handoffText == null ? null : JSON.parse(handoffText); } catch { /* unreadable: no handoff rows */ }
  const log = await reflog($);
  if (log != null) {
    if (rows.resume && /^state_head:/m.test(state)) rows.drift = driftNote(state, log);
    const feed = commitFeed(log, 5);
    if (live.newest && feed.length && feed[0].hash !== live.newest) {
      const fresh = [];
      for (const c of feed) { if (c.hash === live.newest) break; fresh.push(c); }
      for (const c of fresh.reverse()) note("commit", `${c.hash} ${c.msg}`, now);
    }
    live.newest = feed[0]?.hash ?? live.newest;
    live.commits = commitCount(log);
  }
  live.state = state;
  live.workstream = wsInfo;
  live.handoff = parsed;
  live.usage = await readUsage($);
  live.agents = await readAgents($, now);
  if (full) { live.streams = await readStreams($); live.roadmap = await read($, plan("ROADMAP.md")); live.plans = await readPlans($, state); }
  $.ui.invalidate("ui.render"); // render output is cached until invalidated
}

// /gsd-status: the full report, read fresh from disk each time so it is never behind the band.
async function report($) {
  await findRoot($);
  await resolvePlan($);
  const state = await read($, plan("STATE.md"));
  const ok = state != null && isGsdState(state);
  const handoff = ok ? (await read($, plan("HANDOFF.json"))) ?? (wsBase ? await read($, ".planning/HANDOFF.json") : null) : null;
  let drift = null;
  if (ok && /^state_head:/m.test(state)) {
    const log = await reflog($);
    if (log != null) drift = driftNote(state, log);
  }
  return statusReport(state, handoff, await $.clock.now(), drift).text;
}

// At most every 2 seconds, and not awaited by the hooks that call it, so it never slows a tool call down.
async function soon($) {
  const now = await $.clock.now();
  if (!isGsd || now - lastRefreshAt < 2000) return;
  await refresh($, false).catch(() => {});
}

// Once a second while the pane is open and something is running: redraw so the clocks move, and every 5 seconds
// re-read agents and commits, since an agent can end without a hook of ours firing.
async function tick($) {
  if (!isGsd || !panePlaced) return;
  if (!live.isRunning && !live.agents.some((a) => a.status === "running")) return;
  const now = await $.clock.now();
  if (now - lastRefreshAt >= 5000) await refresh($, false).catch(() => {});
  else $.ui.invalidate("ui.render");
}

// The reader opens a folder listing or one file; path is a ".planning/..." path, so it can never leave .planning.
async function openReader($, path) {
  const parts = String(path).split("/").filter((x) => x && x !== ".");
  if (parts[0] !== ".planning" || parts.includes("..")) return;
  const p = parts.join("/");
  const entries = await $.fs.list(at(p)).catch(() => null);
  if (entries) reader = { path: p, isFile: false, entries };
  else {
    const text = await read($, p);
    if (text == null) return;
    reader = { path: p, isFile: true, text };
  }
  $.ui.invalidate("ui.render");
}

// A link inside the open file -> the .planning path it points at, or null (not a relative .md link, or outside .planning).
// It lives here, not in panel.mjs: a press handler runs where only this file's own functions are visible, not imported names.
export function resolveLink(from, href) {
  const h = String(href ?? "").split("#")[0];
  if (!h || h.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(h) || !/\.md$/i.test(h)) return null;
  const parts = String(from).split("/").slice(0, -1);
  for (const seg of h.split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
  return parts[0] === ".planning" ? parts.join("/") : null;
}

// A click on a link in the open file: a relative .md link opens in the reader; anything else is left alone.
async function linkPress($, href) {
  const t = reader && resolveLink(reader.path, href);
  if (t) await openReader($, t);
}

async function readerPress($, key) {
  const [, kind, arg] = /^reader:([^:]+):?(.*)$/s.exec(key) ?? [];
  if (kind === "browse") return openReader($, ".planning");
  if (kind === "open-path") return openReader($, arg);
  if (!reader) return;
  if (kind === "top") return void (await $.ui.scroll({ in: PANE, to: "start" }));
  if (kind === "close") { reader = null; $.ui.invalidate("ui.render"); return; }
  if (kind === "open") return openReader($, `${reader.path}/${arg}`);
  if (kind === "up") {
    if (!reader.isFile && reader.path === ".planning") { reader = null; $.ui.invalidate("ui.render"); return; }
    return openReader($, reader.path.split("/").slice(0, -1).join("/"));
  }
}

async function openPane($) {
  const r = await $.ui.open({ id: PANE, title: "GSD", ...PANE_SIZE });
  panePlaced = r.isPlaced;
  return r;
}

export function register(on, options) {
  openOnStart = options?.openOnStart !== false;
  on("session.start", async ($, e, next) => {
    // A host without commands just goes without the report and the toggle; the band and hint do not depend on them.
    try {
      await $.command.register({ name: "gsd-status", description: "Where this GSD project stands: phase, progress, handoff, blockers" });
      await $.command.register({ name: "gsd-board", description: "Show or hide the live GSD pane", argumentHint: "[close]" });
    } catch { /* no command support here */ }
    if (e.isInteractive) $.clock.every(1000, () => void tick($));
    await refresh($);
    if (isGsd && openOnStart) { try { await openPane($); } catch { /* not placed: /gsd-board opens it */ } }
    // Once per session, and only when the handoff names a command: propose it in the empty prompt box.
    if (rows.command && !suggested) {
      suggested = true;
      await $.prompt.suggest({ text: rows.command }).catch(() => {});
    }
    return next(e);
  });
  on("command.run", { command: "gsd-status" }, async ($) => ({ text: await report($) }));
  on("command.run", { command: "gsd-board" }, async ($, e) => {
    if ((e.args ?? "").trim() === "close") { await $.ui.close({ id: PANE }); panePlaced = false; return { text: "GSD pane closed." }; }
    if (!isGsd) return { text: "No GSD project here: nothing to show." };
    const r = await openPane($);
    return { text: r.isPlaced ? "GSD pane opened. /gsd-board close hides it." : `The GSD pane is not shown: ${r.reason}` };
  });

  // The pane is driven by the session's own events.
  on("turn.start", async ($, e, next) => {
    const out = await next(e);
    if (isGsd && !e.agentId) {
      const now = await $.clock.now();
      live.isRunning = true;
      live.turn = { startedAt: now, edits: 0, errors: 0 };
      live.startCommits = live.commits;
      live.startCost = live.usage?.costUsd ?? null;
      // A finished background agent reports back as a turn that opens with <agent-message>: the agent's own "done" line says that.
      if (e.text && !String(e.text).trimStart().startsWith("<")) note("prompt", String(e.text).replace(/\s+/g, " ").trim(), now);
      void soon($);
    }
    return out;
  });
  on("tool.call", async ($, e, next) => {
    const out = await next(e);
    if (isGsd && e.tool !== "Agent") {
      const now = await $.clock.now();
      const failed = out?.isError === true;
      const isEdit = EDIT_TOOLS.has(e.tool) && !failed && out?.deny === undefined;
      if (live.turn && !e.agentId) {
        if (isEdit) live.turn.edits += 1;
        if (failed) live.turn.errors += 1;
      }
      if (isEdit) note("write", shortPath(e.file_path ?? e.input?.file_path ?? e.notebook_path ?? ""), now);
      else if (failed) note("error", String(e.tool), now);
      void soon($);
    }
    return out;
  });
  on("agent.spawn", async ($, e, next) => {
    const out = await next(e);
    if (isGsd) {
      if (e.fork && out?.agentId) forks.add(out.agentId);
      note("spawn", `${e.fork ? "fork " : ""}${String(e.subagentType ?? "agent").replace(/^gsd-/, "")} ${e.description ?? ""}`.trim(), await $.clock.now());
      void soon($);
    }
    return out;
  });
  on("turn.complete", async ($, e, next) => {
    await refresh($);
    if (isGsd && !e.agentId) {
      const now = await $.clock.now();
      const t = live.turn;
      const cost = live.usage?.costUsd ?? null;
      live.receipt = {
        durationMs: e.durationMs ?? (t ? now - t.startedAt : 0),
        edits: t?.edits ?? 0, errors: t?.errors ?? 0,
        commits: Math.max(0, live.commits - live.startCommits),
        costDelta: cost != null && live.startCost != null ? cost - live.startCost : null,
      };
      live.isRunning = false;
      live.turn = null;
      $.ui.invalidate("ui.render");
    }
    return next(e);
  });

  // The person closing the pane with its close mark: the band comes back.
  on("ui.close", { id: PANE }, async ($, e, next) => { const out = await next(e); panePlaced = false; return out; });

  // The pane: a bordered box per topic, the way the engine's own panes are drawn.
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e);
    if (!isGsd) return Text({ dimColor: true, children: "No GSD project here." });
    const W = Math.max(40, e.props.bodyColumns);
    const segs = (list) => list.map(([text, color, flags]) => Text({ ...(color ? { color } : {}), ...(flags === "b" ? { bold: true } : {}), children: text }));
    const press = (key) => () => {
      if (key.startsWith("reader:")) return void readerPress($, key);
      flip(key);
      if (key === "ws") void refresh($); else $.ui.invalidate("ui.render");
    };
    const link = (k) => void linkPress($, k.href);
    // A line is plain text, a row with a ▸/▾ button in front, or one whole-line button.
    const line = (l, i) => {
      if (l.md !== undefined) return Markdown({ key: `md${i}`, text: l.md, onLinkPress: link });
      if (Array.isArray(l)) return Text({ wrap: "truncate", children: segs(l) });
      if (l.toggle) {
        return Box({ flexDirection: "row", children: [
          Button({ key: l.toggle.key, label: l.toggle.open ? "▾" : "▸", plain: true, ...(l.toggle.hotkey ? { hotkey: l.toggle.hotkey } : {}), onPress: press(l.toggle.key) }),
          Text({ children: " " }),
          Text({ wrap: "truncate", children: segs(l.segs) }),
        ] });
      }
      return Button({ key: l.button.key, label: l.button.label, plain: true, hotkey: l.button.hotkey, onPress: press(l.button.key) });
    };
    const m = panelModel({ ...live, reader, expand, now: await $.clock.now() }, W);
    return Box({
      flexDirection: "column", width: W,
      children: [
        Box({ justifyContent: "center", children: [Text({ bold: true, wrap: "truncate", children: segs(m.header) })] }),
        ...m.panels.map((p) => Box({
          flexDirection: "column", borderStyle: "round", borderColor: p.color, paddingX: 1, width: W,
          children: [
            Box({ justifyContent: "space-between", children: [Text({ wrap: "truncate", children: segs(p.title) }), ...(p.right ? [Text({ children: segs(p.right) })] : [])] }),
            ...p.lines.map(line),
          ],
        })),
      ],
    });
  });

  // The band above the prompt: the GSD line, and the drift warning when STATE.md is behind. While the pane is open it
  // shows the same, so the band stands down.
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const below = await next(e); // whatever other mods draw in this band: keep it, add our line on top
    const { resume, drift } = rows;
    if (!resume || panePlaced) return below;
    const { Box, Text } = $.ui.resolve(e);
    const parts = [Text({ color: "cyan", children: resume })];
    if (drift) parts.push(Text({ color: "yellow", children: "  " + drift }));
    const mine = Box({ paddingX: 1, flexDirection: "row", children: parts });
    return below ? Box({ flexDirection: "column", children: [mine, below] }) : mine;
  });

  // The line under the prompt: add the handoff's next action to its end, dim. The engine's own line and its pills
  // stay; another mod's tail is kept and ours follows it. Nothing while typing or while a turn runs.
  on("ui.render", { component: "PromptHint" }, async ($, e, next) => {
    const p = e.props ?? {};
    if (!rows.handoff || p.isDraft || p.isWorking) return next(e);
    const tail = p.tail ? `${p.tail} · ${rows.handoff}` : rows.handoff;
    return next({ ...e, props: { ...p, tail } });
  });
}
