import test from "node:test";
import assert from "node:assert/strict";
import { segsOf, visibleAgents, agentTree, panelModel, streamInfo, commitFeed, commitCount, shortPath, gauge, kTokens, fmtUsd, limitLabel, sections } from "../hooks/panel.mjs";

const text = (line) => segsOf(line).map((s) => s[0]).join("");
const dump = (m) => [m.header.map((s) => s[0]).join(""), ...m.panels.flatMap((p) => [`[${p.id}] ${p.title.map((s) => s[0]).join("")} | ${p.right ? p.right.map((s) => s[0]).join("") : ""}`, ...p.lines.map(text)])].join("\n");
const STATE = "---\ngsd_state_version: 1.0\nstatus: paused\ncurrent_phase: 22\ncurrent_phase_name: Rebuild mobile rendering\nlast_activity_desc: x\n---";
const NOW = Date.parse("2026-10-03T12:00:00Z");

test("small helpers", () => {
  assert.deepEqual(gauge(50, 10), { on: "▰▰▰▰▰", off: "▱▱▱▱▱" });
  assert.deepEqual(gauge(150, 4), { on: "▰▰▰▰", off: "" });
  assert.equal(kTokens(667000), "667k");
  assert.equal(kTokens(1000000), "1.0M");
  assert.equal(fmtUsd(104.4), "$104");
  assert.equal(fmtUsd(0.15), "$0.15");
  assert.equal(limitLabel("five_hour"), "5h");
  assert.equal(limitLabel("seven_day_opus"), "7d opus");
});

test("commitFeed and commitCount read the reflog", () => {
  const log = [
    "0000000 aaaaaaa1 A <a@x> 1759500000 +1030\tcommit (initial): first",
    "aaaaaaa1 bbbbbbb2 A <a@x> 1759500100 +1030\tcheckout: moving from main to x",
    "bbbbbbb2 ccccccc3 A <a@x> 1759500200 +1030\tcommit: feat(03-02): add invoice model",
  ].join("\n");
  assert.equal(commitCount(log), 2);
  assert.deepEqual(commitFeed(log, 5), [{ hash: "ccccccc", msg: "feat(03-02): add invoice model" }, { hash: "aaaaaaa", msg: "first" }]);
  assert.equal(commitCount(null), 0);
});

test("streamInfo: counts folders, ignores index files, newest by name with numbers in order", () => {
  const d = (name) => ({ name, kind: "dir", size: 0, mtimeMs: 0, isLink: false });
  const f = (name, mtimeMs = 0) => ({ name, kind: "file", size: 1, mtimeMs, isLink: false });
  assert.deepEqual(streamInfo([d("99-a"), d("247-ifcx"), d("100-b"), f("MANIFEST.md"), f("CONVENTIONS.md")]), { count: 3, newest: "247-ifcx", recent: ["247-ifcx", "100-b", "99-a"] });
  assert.deepEqual(streamInfo([f("a.md", 10), f("b.md", 30), f("c.md", 20), f(".keep")]), { count: 3, newest: "b", recent: ["b", "c", "a"] });
  assert.equal(streamInfo([]), null);
  assert.equal(streamInfo([f("README.md")]), null);
});

test("panelModel: a busy session", () => {
  const m = panelModel({
    state: STATE,
    usage: { pct: 67, tokens: 667000, window: 1000000, costUsd: 104, limits: [{ kind: "five_hour", pct: 5 }, { kind: "seven_day", pct: 13 }] },
    isRunning: true, turn: { startedAt: NOW - 12000, edits: 3, errors: 0 }, receipt: null,
    agents: [
      { id: "a", type: "gsd-executor", description: "Execute plan 02 of phase 22", status: "running", since: NOW - 192000 },
      { id: "b", type: "gsd-verifier", description: "Verify phase 22", status: "completed", since: NOW - 60000, endedAt: NOW - 20000 },
    ],
    streams: [{ name: "spikes", count: 252, newest: "247-ifcx-reference-study" }, { name: "threads", count: 38, newest: "meipak-per-flat-layer" }],
    handoff: { blockers: ["x"], human_actions_pending: ["a", "b"] },
    log: [{ at: NOW - 5000, kind: "spawn", text: "executor Execute plan 02" }, { at: NOW - 2000, kind: "commit", text: "f3f0aa3 docs(spike-237)" }],
    now: NOW,
  }, 62);
  const t = dump(m);
  for (const want of [
    "GSD · phase 22 Rebuild mobile rendering · paused", "[main] phase 22 Rebuild mobile rendering | ● working",
    "ctx ▰▰▰▰▰▰▰▱▱▱ 67% 667k/1.0M", "$104   5h ▱▱▱▱▱ 5%", "7d ▰▱▱▱▱ 13%", "▸ ⚠ 1 blocker · 2 need a person",
    "[agents] agents · 1 running | 2 total", "◐ executor Execute plan 02 of phase 22", "3:12", "✓ verifier Verify phase 22", "0:40",
    "[turn] turn | 0:12", "3 edits · 0 errors", "[streams] work streams", "spikes   252  247-ifcx-reference-study", "threads   38",
    "[log] session log", "spawn  executor Execute plan 02", "commit f3f0aa3 docs(spike-237)",
  ]) assert.ok(t.includes(want), want + "\n" + t);
  assert.ok(m.panels.every((p) => p.color));
});

test("panelModel: idle with a receipt, nothing else", () => {
  const m = panelModel({ state: STATE, usage: null, isRunning: false, receipt: { durationMs: 35000, edits: 2, errors: 0, commits: 1, costDelta: 0.15 }, now: NOW });
  const t = dump(m);
  assert.ok(t.includes("[main] phase 22 Rebuild mobile rendering | ○ idle"), t);
  assert.ok(t.includes("35s · 2 edits · 1 commit · 0 errors · +$0.15"), t);
  assert.ok(!t.includes("[agents]") && !t.includes("[streams]") && !t.includes("[log]"), t);
});

test("panelModel: no STATE.md, odd input and narrow width never throw or run past the box", () => {
  assert.ok(panelModel({ state: null, now: 0 }).panels.length >= 1);
  const m = panelModel({
    state: STATE, usage: { pct: 91, tokens: 1, window: 2, costUsd: 3, limits: [] }, isRunning: false,
    agents: [{ id: "a", type: "gsd-executor", description: "x".repeat(200), status: "running", since: 0 }],
    streams: [{ name: "spikes", count: 1, newest: "y".repeat(200) }], log: [{ at: 0, kind: "write", text: "z".repeat(200) }], now: 5000,
  }, 36);
  for (const p of m.panels) for (const l of p.lines) assert.ok(text(l).length <= 32, `${p.id}: ${text(l)}`);
});

test("shortPath keeps .planning/ paths from that point, else the last two parts", () => {
  assert.equal(shortPath("/Users/h/proj/.planning/spikes/247-x/FINDINGS.md"), ".planning/spikes/247-x/FINDINGS.md");
  assert.equal(shortPath("/Users/h/proj/src/app/main.js"), "app/main.js");
  assert.equal(shortPath("main.js"), "main.js");
  assert.equal(shortPath(undefined), "");
});

test("panelModel: the main box says agents are working while one runs between turns", () => {
  const m = panelModel({ state: STATE, isRunning: false, agents: [{ id: "a", type: "gsd-executor", description: "x", status: "running", since: 0 }], now: 1000 });
  assert.ok(dump(m).includes("◐ agents working"), dump(m));
});

test("agentTree: children follow their parent, deeper; orphans and cycles still show", () => {
  const a = (id, parentId, status = "running", since = 0) => ({ id, parentId, status, since, type: "t", description: id });
  const tree = agentTree([a("c2", "p", "running", 3), a("p", undefined, "running", 1), a("g", "c1", "running", 4), a("c1", "p", "running", 2), a("o", "gone", "completed", 9), a("x", "y"), a("y", "x")]);
  assert.deepEqual(tree.map((n) => [n.id, n.depth]), [["p", 0], ["c1", 1], ["g", 2], ["c2", 1], ["o", 0], ["x", 0], ["y", 1]].filter(Boolean));
  assert.equal(agentTree(null).length, 0);
});

test("panelModel: forks and sub-agents are indented and marked, with depth in the header", () => {
  const m = panelModel({
    state: STATE, isRunning: false, now: NOW,
    agents: [
      { id: "p", type: "gsd-executor", description: "Execute plan 02 of phase 22", status: "running", since: NOW - 60000 },
      { id: "f", parentId: "p", isFork: true, type: "gsd-executor", description: "same context", status: "running", since: NOW - 30000 },
      { id: "s", parentId: "f", type: "Explore", description: "find the tests", status: "completed", since: NOW - 20000, endedAt: NOW - 10000 },
    ],
  });
  const t = dump(m);
  assert.ok(t.includes("◐ executor Execute plan 02"), t);
  assert.ok(t.includes("◐ └ ⑂ executor same context"), t);
  assert.ok(t.includes("✓   └ Explore find the tests"), t);
  assert.ok(t.includes("3 total · 1 fork · 3 deep"), t);
});

test("visibleAgents: a wave collapses finished agents but keeps running ones and their parents", () => {
  const a = (id, status, endedAt, parentId) => ({ id, parentId, status, since: 0, endedAt, type: "gsd-executor", description: id });
  const tree = agentTree([a("root", "running", null), ...Array.from({ length: 5 }, (_, i) => a(`d${i}`, "completed", 100 + i, "root")), a("live", "running", null, "root"), a("bad", "failed", 50, "root")]);
  const { shown, hidden } = visibleAgents(tree);
  const ids = shown.map((n) => n.id);
  assert.ok(ids.includes("root") && ids.includes("live") && ids.includes("bad"), ids.join());
  assert.deepEqual(ids.filter((i) => i.startsWith("d")).sort(), ["d3", "d4"]);
  assert.equal(hidden, 3);
});

test("visibleAgents: when nothing runs, finished agents fill the budget; a huge wave is capped", () => {
  const done = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, status: "completed", since: 0, endedAt: i, type: "t", description: "x" }));
  assert.equal(visibleAgents(agentTree(done)).shown.length, 8);
  const live = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, status: "running", since: 0, type: "t", description: "x" }));
  const v = visibleAgents(agentTree(live));
  assert.equal(v.shown.length, 12);
  assert.equal(v.hidden, 8);
});

test("panelModel: the agents box says what it collapsed", () => {
  const mk = (id, status, endedAt) => ({ id, status, since: NOW - 90000, endedAt, type: "gsd-executor", description: id });
  const t = dump(panelModel({ state: STATE, isRunning: false, now: NOW, agents: [mk("live", "running"), ...Array.from({ length: 5 }, (_, i) => mk(`d${i}`, "completed", NOW - i * 1000))] }));
  assert.ok(t.includes("▸ 3 more finished"), t);
  assert.ok(t.includes("agents · 1 running"), t);
});

test("clickable lines: agent rows and streams toggle, blockers and finished are buttons", () => {
  const mk = (id, status, endedAt) => ({ id, status, since: NOW - 90000, endedAt, type: "gsd-executor", description: "Execute plan 02 of phase 22 and then some more words to make this one long enough to wrap", parentId: id === "kid" ? "live" : undefined });
  const base = { state: STATE, isRunning: false, now: NOW, handoff: { blockers: ["Stripe key missing"], human_actions_pending: ["Approve schema"] },
    agents: [mk("live", "running"), mk("kid", "running"), ...Array.from({ length: 4 }, (_, i) => mk(`d${i}`, "completed", NOW - i * 1000))],
    streams: [{ name: "spikes", count: 3, newest: "c", recent: ["c", "b", "a"] }], log: Array.from({ length: 12 }, (_, i) => ({ at: NOW + i, kind: "write", text: `f${i}` })) };
  const lines = (m, id) => m.panels.find((p) => p.id === id).lines;
  const closed = panelModel(base);
  const rows = lines(closed, "agents");
  assert.deepEqual(rows.filter((l) => l.toggle).map((l) => [l.toggle.key, l.toggle.open, l.toggle.hotkey]).slice(0, 2), [["agent:live", false, "1"], ["agent:kid", false, "2"]]);
  assert.ok(rows.some((l) => l.button?.key === "finished" && l.button.label.startsWith("▸")));
  assert.ok(lines(closed, "main").some((l) => l.button?.key === "blockers" && l.button.hotkey === "b"));
  assert.ok(lines(closed, "log")[0].button?.key === "log");
  assert.ok(lines(closed, "streams")[0].toggle.key === "stream:spikes");

  const open = panelModel({ ...base, expand: { agents: new Set(["kid"]), finished: true, blockers: true, streams: new Set(["spikes"]), log: true } });
  const t = dump(open);
  for (const want of ["id kid · gsd-executor · under executor · running", "- Stripe key missing", "- Approve schema", "      c\n", "▾ collapse finished", "▾ show less"]) {
    assert.ok(t.includes(want.replace("\\n", "")), want + "\n" + t);
  }
  assert.equal(lines(open, "log").length, 13);
  assert.ok(lines(open, "agents").filter((l) => l.toggle).length > lines(closed, "agents").filter((l) => l.toggle).length);
});

test("roadmap: reads the phase checklist and marks the current phase by its label", async () => {
  const { roadmapPhases, panelModel } = await import("../hooks/panel.mjs");
  const road = "## Phases\n- [x] **Phase 1: P0 — a** - x\n- [ ] **Phase 2.1: P1.5 — b (INSERTED)** - y\n- [ ] **Phase 3: P2 — c** - z\nnot a phase\n";
  assert.equal(roadmapPhases(road).length, 3);
  const state = "---\nstatus: planning\ncurrent_phase_name: P1.5 — b (vector)\ncompleted_plans: 2\ntotal_plans: 5\n---\n";
  const m = panelModel({ roadmap: road, state, now: 0 }, 62);
  const p = m.panels.find((x) => x.id === "roadmap");
  const text = p.lines.map((l) => (Array.isArray(l) ? l.map((s) => s[0]).join("") : "")).join("\n");
  assert.match(text, /▶ 2\.1/);
  assert.ok(p.lines.some((l) => l.button?.label === "▸ 1 before · 1 later" || l.button?.label === "▸ 1 before"));
  assert.match(p.right[0][0], /1\/3 phases · 2\/5 plans/);
  // no match, no marker
  const none = panelModel({ roadmap: road, state: "---\nstatus: x\n---\n", now: 0 }, 62).panels.find((x) => x.id === "roadmap");
  assert.ok(!none.lines.some((l) => Array.isArray(l) && l[0][0].startsWith("▶")));
});

test("workstream: named in the header, with a switch button only when there are several", async () => {
  const { panelModel } = await import("../hooks/panel.mjs");
  const state = "---\nstatus: executing\ncurrent_phase: 3\n---\n";
  const two = panelModel({ state, workstream: { name: "emsd", index: 1, total: 2, names: ["emsd", "nrb2"] }, now: 0 }, 62);
  assert.match(two.header.map((s) => s[0]).join(""), /GSD · emsd · phase 3/);
  assert.ok(two.panels[0].lines.some((l) => l.button?.key === "ws" && /1 of 2/.test(l.button.label)));
  const one = panelModel({ state, workstream: { name: "emsd", index: 1, total: 1, names: ["emsd"] }, now: 0 }, 62);
  assert.ok(!one.panels[0].lines.some((l) => l.button?.key === "ws"));
});

test("reader: pages cut at a line and not inside a fence; frontmatter hidden; browser lists folders first", async () => {
  const { pages, stripFrontmatter, browseList, panelModel } = await import("../hooks/panel.mjs");
  assert.equal(stripFrontmatter("---\nstatus: x\n---\n# Title\nbody"), "# Title\nbody");
  assert.equal(stripFrontmatter("no header"), "no header");
  const body = Array.from({ length: 60 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
  const p = pages(body, 500);
  assert.ok(p.length > 3 && p.every((x) => x.length <= 560));
  assert.equal(p.join("\n"), body);
  const fenced = "```\n" + Array.from({ length: 40 }, () => "y".repeat(40)).join("\n") + "\n```\nafter";
  assert.ok(pages(fenced, 500)[0].endsWith("```")); // a fence is kept whole, the cut comes after it
  assert.deepEqual(pages(""), [""]);
  const e = (name, kind) => ({ name, kind });
  assert.deepEqual(browseList([e("10-x", "dir"), e("NOTES.md", "file"), e("2-y", "dir"), e("a.json", "file"), e(".hid", "dir")]).map((x) => x.name), ["2-y", "10-x", "NOTES.md"]);
  const dir = panelModel({ reader: { path: ".planning/phases", isFile: false, entries: [e("04-billing", "dir")] } }, 62);
  assert.equal(dir.panels.length, 1);
  assert.ok(dir.panels[0].lines.some((l) => l.button?.key === "reader:open:04-billing"));
  const keys = (m) => m.panels[0].lines.filter((l) => l.button).map((l) => l.button.key);
  assert.ok(!keys(panelModel({ reader: { path: ".planning", isFile: false, entries: [] } }, 62)).includes("reader:close")); // at the top, back already leaves
  assert.ok(keys(dir).includes("reader:close") && keys(dir).includes("reader:up")); // deeper, one button leaves at once
  const file = panelModel({ reader: { path: ".planning/ROADMAP.md", isFile: true, text: "---\na: b\n---\n# Hi\n- [x] done\n- [ ] todo" } }, 62);
  assert.ok(file.panels[0].lines.some((l) => l.md === "# Hi\n- ✓ done\n- ○ todo"));
  assert.equal(file.panels[0].lines.at(-1).button?.key, "reader:top"); // the last row of a file is the way back to its top
  const huge = panelModel({ reader: { path: ".planning/x.md", isFile: true, text: "z".repeat(30000) } }, 62);
  assert.ok(huge.panels[0].lines.filter((l) => l.md !== undefined).every((l) => l.md.length <= 9900));
  const { resolveLink } = await import("../hooks/gsd-status.mjs");
  assert.equal(resolveLink(".planning/phases/04-x/04-01-PLAN.md", "./04-02-PLAN.md"), ".planning/phases/04-x/04-02-PLAN.md");
  assert.equal(resolveLink(".planning/phases/04-x/a.md", "../../ROADMAP.md#top"), ".planning/ROADMAP.md");
  assert.equal(resolveLink(".planning/a.md", "../../etc/x.md"), null);
  assert.equal(resolveLink(".planning/a.md", "https://x.dev/a.md"), null);
  assert.equal(resolveLink(".planning/a.md", "/abs.md"), null);
  assert.equal(resolveLink(".planning/a.md", "img.png"), null);
});

test("pace: plan shape, agent time shares, parallelism, and a hint only on clear evidence", async () => {
  const { planShape, agentPace, panelModel } = await import("../hooks/panel.mjs");
  const chain = [{ id: "04-01", wave: 1, done: true }, { id: "04-02", wave: 2, done: false }, { id: "04-03", wave: 3, done: false }];
  assert.deepEqual({ ...planShape(chain), byWave: undefined }, { total: 3, open: 2, waves: 2, widest: 1, byWave: undefined });
  assert.equal(planShape([{ id: "a", wave: 1, done: false }, { id: "b", wave: 1, done: false }]).widest, 2);
  assert.equal(planShape([]).widest, 0);
  const T = 1000, B = 1e6; // B: a real start time is never 0
  const serial = [{ type: "gsd-executor", since: B, endedAt: B + 60 * T }, { type: "gsd-executor", since: B + 60 * T, endedAt: B + 120 * T }, { type: "gsd-planner", since: B + 120 * T, endedAt: B + 150 * T }];
  const p = agentPace(serial, B + 200 * T);
  assert.equal(p.byType[0][0], "executor");
  assert.equal(p.executors, 2);
  assert.ok(Math.abs(p.executorParallel - 1) < 1e-9);
  const para = agentPace([{ type: "gsd-executor", since: B, endedAt: B + 60 * T }, { type: "gsd-executor", since: B, endedAt: B + 60 * T }], B + 100 * T);
  assert.ok(Math.abs(para.executorParallel - 2) < 1e-9);
  const state = "---\ncurrent_phase: 4\n---\n";
  const lines = (m) => m.panels.find((x) => x.id === "pace").lines.map((l) => (Array.isArray(l) ? l.map((s) => s[0]).join("") : l.button.label));
  const a = lines(panelModel({ state, plans: chain, agents: serial, now: B + 200 * T }, 62));
  assert.ok(a.some((l) => /serial: each plan waits/.test(l)) && a.some((l) => /serial: executors ran one at a time/.test(l)));
  const wide = lines(panelModel({ state, plans: [{ id: "a", wave: 1, done: false }, { id: "b", wave: 1, done: false }], agents: [], now: 0 }, 62));
  assert.ok(!wide.some((l) => /serial/.test(l)));
  assert.equal(panelModel({ state, plans: [], agents: [], now: 0 }, 62).panels.some((x) => x.id === "pace"), false);
});

test("history: typical beside a running clock (amber when slow), trends button, trends view, this phase's stages", async () => {
  const { panelModel } = await import("../hooks/panel.mjs");
  const MIN = 60000, B = 1e9;
  const hist = [10, 20, 30, 40, 50].map((m, i) => [B + i, "gsd-executor", "4", m * MIN, 50, 1, 1, "m"]);
  const state = "---\ncurrent_phase: 4\n---\n";
  const agentRow = (m) => m.panels.find((x) => x.id === "agents").lines.find((l) => l.segs).segs;
  const txt = (segs) => segs.map((s) => s[0]).join("");
  const slow = panelModel({ state, history: hist, agents: [{ id: "a", type: "gsd-executor", description: "Execute plan 01", status: "running", since: B }], now: B + 70 * MIN }, 70);
  assert.match(txt(agentRow(slow)), /70:00 · typ 30:00/);
  assert.equal(agentRow(slow).at(-1)[1], "warning"); // over twice the typical
  const ok = panelModel({ state, history: hist, agents: [{ id: "a", type: "gsd-executor", description: "x", status: "running", since: B }], now: B + 40 * MIN }, 70);
  assert.equal(agentRow(ok).at(-1)[1], "inactive");
  const few = panelModel({ state, history: hist.slice(0, 4), agents: [{ id: "a", type: "gsd-executor", description: "x", status: "running", since: B }], now: B + 5 * MIN }, 70);
  assert.ok(!/typ/.test(txt(agentRow(few)))); // fewer than five runs: nothing is called typical
  const lines = slow.panels.find((x) => x.id === "pace").lines;
  assert.ok(lines.some((l) => l.button?.key === "trends"));
  const tr = panelModel({ state, history: hist, expand: { trends: true }, now: B + 60 * MIN }, 70);
  assert.equal(tr.panels.length, 1);
  assert.equal(tr.panels[0].id, "trends");
  const flat = tr.panels[0].lines.map((l) => (Array.isArray(l) ? l.map((s) => s[0]).join("") : l.button.label)).join("\n");
  assert.match(flat, /executor time per run/);
  assert.match(flat, /time by phase and stage/);
  assert.match(flat, /agent time per day/);
  assert.match(flat, /median 30m/);
  const open = panelModel({ state, history: hist, plans: [{ id: "a", wave: 1, done: false }], expand: { pace: true }, now: B }, 70).panels.find((x) => x.id === "pace").lines;
  assert.ok(open.some((l) => Array.isArray(l) && /this phase/.test(l[0][0]) && /executing 2h30/.test(l[1][0])));
});

test("pace shows the fit of the rest of the phase, and a wave that runs together", () => {
  const MIN = 60000, B = 10 * 3600000;
  const state = "---\ngsd_state_version: 1\ncurrent_phase: 2\n---\n";
  const hist = Array.from({ length: 6 }, (_, i) => [B + i * MIN, "gsd-executor", "2", 10 * MIN, 10, 1, 1, "m", 3, 1]);
  const plans = [{ id: "a", wave: 1, done: false }, { id: "b", wave: 1, done: false }, { id: "c", wave: 2, done: false }];
  const usage = { limits: [{ kind: "five_hour", pct: 90, resetsAt: new Date(B + 30 * MIN).toISOString() }] };
  const m = panelModel({ state, history: hist, plans, usage, agents: [], now: B }, 70);
  const text = m.panels.find((x) => x.id === "pace").lines.map((l) => (Array.isArray(l) ? l.map((s) => s[0]).join("") : l.button.label)).join("\n");
  assert.match(text, /≈ 20m of executing · 2 waves · from 6 runs/);
  assert.match(text, /5h\s+90% · resets in 30m/);
  assert.match(text, /quota \+9% \(9–9\) → 99%/);
  assert.match(text, /next\s+wave of 2 together \+6% \(6–6\) → 96%/);
  assert.match(text, /▸ timeline/);
});

test("timeline: one bar per agent over the latest stretch; overlapped executors read as parallel, serial ones as a staircase", () => {
  const MIN = 60000, B = 10 * 3600000;
  const state = "---\ngsd_state_version: 1\n---\n";
  const ex = (end, ms) => [end, "gsd-executor", "1", ms, 5, 1, 1, "m"];
  const serial = panelModel({ state, history: [ex(B + 10 * MIN, 10 * MIN), ex(B + 20 * MIN, 10 * MIN)], expand: { timeline: true }, now: B + 20 * MIN }, 70);
  const rows = serial.panels[0].lines.filter((l) => Array.isArray(l) && l[0][0].startsWith("executor"));
  assert.equal(rows.length, 2);
  assert.ok(rows[1][1][0].length > rows[0][1][0].length); // the second bar starts later
  assert.match(serial.panels[0].lines.map((l) => (Array.isArray(l) ? l.map((s) => s[0]).join("") : l.button.label)).join("\n"), /executors ×1\.0 one at a time/);
  const par = panelModel({ state, history: [ex(B + 10 * MIN, 10 * MIN), ex(B + 10 * MIN, 10 * MIN)], expand: { timeline: true }, now: B + 10 * MIN }, 70);
  assert.match(par.panels[0].lines.map((l) => (Array.isArray(l) ? l.map((s) => s[0]).join("") : l.button.label)).join("\n"), /executors ×2\.0 overlapped/);
  assert.match(panelModel({ state, history: [], expand: { timeline: true }, now: B }, 70).panels[0].lines.map((l) => (Array.isArray(l) ? l[0][0] : l.button.label)).join(" "), /no agents recorded yet/);
});

test("reader: sections split at headings outside code fences; contents list jumps to them by key", () => {
  const text = "intro\n\n# One\ntext\n```\n# not a heading\n```\n## Two\nmore\n### Three\nx\n";
  const s = sections(text);
  assert.deepEqual(s.map((x) => x.heading?.title), [undefined, "One", "Two", "Three"]);
  assert.ok(s[1].md.includes("# not a heading")); // stays inside its section
  const rd = { path: ".planning/a.md", isFile: true, text };
  const closed = panelModel({ state: "---\ngsd_state_version: 1\n---\n", reader: rd, now: 0 }, 70).panels[0].lines;
  assert.equal(closed.filter((l) => l.md !== undefined).map((l) => l.key).join(), "sec0,sec1,sec2,sec3");
  assert.equal(closed.find((l) => l.button?.key === "reader:toc").button.label, "▸ contents (3)");
  assert.equal(closed.some((l) => l.button?.key?.startsWith("reader:goto")), false);
  const open = panelModel({ state: "---\ngsd_state_version: 1\n---\n", reader: rd, expand: { toc: true }, now: 0 }, 70).panels[0].lines;
  assert.deepEqual(open.filter((l) => l.button?.key?.startsWith("reader:goto")).map((l) => l.button.key), ["reader:goto:1", "reader:goto:2", "reader:goto:3"]);
  const few = panelModel({ state: "---\ngsd_state_version: 1\n---\n", reader: { path: ".planning/b.md", isFile: true, text: "# a\nx\n## b\ny" }, now: 0 }, 70).panels[0].lines;
  assert.equal(few.some((l) => l.button?.key === "reader:toc"), false); // fewer than three headings: no contents
});
