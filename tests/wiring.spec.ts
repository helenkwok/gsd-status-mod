import test from "node:test";
import assert from "node:assert/strict";
import type { Run } from "../hooks/types.ts";
let n = 0; // the module keeps its state in variables, so each test loads its own copy

// A fake `$` and a controlled clock, driving the real handlers: what the live session would do, minus the engine.
type Ev = Record<string, unknown>;
type Drawn = { box: { children: Drawn[] }; md: { text: string; pressableLinks: string[] }; props: { text: string } };
type Hook = ($: unknown, e: Ev, next: (z: Ev) => Promise<Ev>) => Promise<Drawn>;
type FakeAgent = { id: string; type: string; status: string; description?: string };
async function rig({ runs = [], agents = [], usage }: { runs?: Run[]; agents?: FakeAgent[]; usage?: unknown }) {
  const { register } = (await import(`../hooks/gsd-status.ts?copy=${++n}`)) as typeof import("../hooks/gsd-status.ts");
  const h: Record<string, { m: Ev | null; fn: Hook }[]> = {};
  const state: { now: number; agents: FakeAgent[]; usage: unknown; toasts: string[]; saved: { runs: Run[] } | null; tick: (() => void) | null } = { now: 1_000_000, agents, usage, toasts: [], saved: null, tick: null };
  const on = (name: string, a: Ev | Hook, b?: Hook) => { const [m, fn] = b ? [a as Ev, b] : [null, a as Hook]; (h[name] ??= []).push({ m, fn }); };
  register(on as never, {});
  const miss = () => Promise.reject(new Error("missing"));
  const $ = {
    command: { register: async () => {} }, prompt: { suggest: async () => {} },
    clock: { now: async () => state.now, every: (_ms: number, f: () => void) => { state.tick = f; }, sleep: async () => {} },
    session: { root: async () => "/p", usage: async () => state.usage },
    fs: {
      read: async (p: string) => (p === "/p/.planning/STATE.md" ? "---\ngsd_state_version: 1\ncurrent_phase: 1\n---\n" : miss()),
      list: async (_p: string): Promise<{ name: string; kind: string }[]> => [], stat: async (_p: string): Promise<{ kind: string } | null> => null,
    },
    agent: { list: async () => state.agents },
    store: { get: async () => ({ v: 1, runs }), set: async (_k: string, v: { runs: Run[] }) => { state.saved = v; } },
    ui: { open: async () => ({ isPlaced: true }), close: async () => {}, invalidate: () => {}, toast: (t: string) => state.toasts.push(t), resolve: (): Record<string, (p: unknown) => unknown> => ({}), scroll: async () => ({}) },
  };
  const fire = async (name: string, e: Ev = {}, m: Ev | null = null) => { const x = h[name]!.find((y) => !y.m || Object.entries(y.m).every(([k, v]) => e[k] === v || m?.[k] === v))!; return x.fn($, e, async (z) => z); };
  return { $, state, fire, h };
}

const run = (end: number, type: string, ms: number): Run => [end, type, "1", ms, 10, 1, 1, "m", -1, 0];

test("toast: an agent past twice its usual time is said once, while it is still running", async () => {
  const runs = [38, 39, 40, 41, 42].map((s, i) => run(i, "general-purpose", s * 1000));
  const r = await rig({ runs, agents: [{ id: "a1", type: "general-purpose", status: "running", description: "x" }], usage: { context: {}, cost: { usd: 1 }, rateLimits: [] } });
  await r.fire("session.start", { isInteractive: true });
  const t0 = r.state.now;
  const seenAt = [];
  for (let s = 6; s <= 200; s += 6) {
    r.state.now = t0 + s * 1000;
    r.state.tick!();
    await new Promise((res) => setImmediate(res)); // the engine's timer does not wait for the callback either: let it finish
    if (r.state.toasts.length && !seenAt.length) seenAt.push(s);
  }
  assert.equal(r.state.toasts.length, 1);
  assert.match(r.state.toasts[0]!, /^general-purpose has run 1:\d\d, usually 0:40$/);
  assert.ok(seenAt[0]! <= 100, `the notice came at ${seenAt[0]}s, should be just past 80s`);
});

test("quota: executors that overlapped share the window's rise, and the rows are filled in when the cluster closes", async () => {
  const limit = (pct: number) => ({ context: {}, cost: { usd: 1 }, rateLimits: [{ kind: "five_hour", percentUsed: pct, resetsAt: "2026-10-04T10:00:00Z" }] });
  const agents = [{ id: "e1", type: "gsd-executor", status: "running" }, { id: "e2", type: "gsd-executor", status: "running" }];
  const r = await rig({ agents, usage: limit(20) });
  await r.fire("session.start", { isInteractive: false });
  r.state.now += 5000; r.state.usage = limit(26); // the window rose 6 points while both ran
  r.state.agents = agents.map((a) => ({ ...a, status: "completed" }));
  await r.fire("turn.complete", { agentId: "e1", durationMs: 600000, usage: {} });
  await r.fire("turn.complete", { agentId: "e2", durationMs: 590000, usage: {} });
  const rows = r.state.saved!.runs;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => [x[8], x[9]]), [[3, 2], [3, 2]]); // 6 points over 2 executors
});

test("quota: a reviewer in the stretch, or a window reset, leaves it unmeasured", async () => {
  const limit = (pct: number, reset: string) => ({ context: {}, cost: { usd: 1 }, rateLimits: [{ kind: "five_hour", percentUsed: pct, resetsAt: reset }] });
  const agents = [{ id: "e1", type: "gsd-executor", status: "running" }, { id: "v1", type: "gsd-verifier", status: "running" }];
  const r = await rig({ agents, usage: limit(20, "A") });
  await r.fire("session.start", { isInteractive: false });
  r.state.now += 5000; r.state.usage = limit(26, "A");
  r.state.agents = agents.map((a) => ({ ...a, status: "completed" }));
  await r.fire("turn.complete", { agentId: "e1", durationMs: 600000, usage: {} });
  assert.equal(r.state.saved!.runs[0]![8], -1);
  const q = await rig({ agents: [{ id: "e1", type: "gsd-executor", status: "running" }], usage: limit(90, "A") });
  await q.fire("session.start", { isInteractive: false });
  q.state.now += 5000; q.state.usage = limit(4, "B"); // the window reset in between
  q.state.agents = [{ id: "e1", type: "gsd-executor", status: "completed" }];
  await q.fire("turn.complete", { agentId: "e1", durationMs: 600000, usage: {} });
  assert.equal(q.state.saved!.runs[0]![8], -1);
});

test("a reply naming .planning documents gets a line of reader links under it; other replies are left alone", async () => {
  const r = await rig({ usage: { context: {}, cost: { usd: 0 }, rateLimits: [] } });
  await r.fire("session.start", { isInteractive: true });
  const files = new Set(["/p/.planning/threads/x.md", "/p/.planning/phases/04-b/04-01-PLAN.md"]);
  r.$.fs.stat = async (p: string) => (files.has(p) ? { kind: "file" } : null);
  r.$.fs.list = async (p: string) => (p === "/p/.planning" ? [{ name: "phases", kind: "dir" }] : p === "/p/.planning/phases" ? [{ name: "04-b", kind: "dir" }] : p === "/p/.planning/phases/04-b" ? [{ name: "04-01-PLAN.md", kind: "file" }] : []);
  r.$.ui.resolve = () => ({ Box: (p) => ({ box: p }), Markdown: (p) => ({ md: p }) });
  const draw = (text: string) => r.fire("ui.render", { component: "AssistantMessage", surface: "terminal", viewport: { isFullscreen: true }, props: { text } });
  const out = await draw("Check .planning/threads/x.md and 04-01-PLAN.md:12, not missing.md or https://x.io/a.md");
  const line = out.box.children[1]!.box.children[0]!.md;
  assert.equal(line.pressableLinks.length, 2);
  assert.match(line.text, /\[x\.md\]\(file:\/\/\/p\/\.planning\/threads\/x\.md\) · \[04-01-PLAN\.md\]/);
  const plain = { component: "AssistantMessage", surface: "terminal", viewport: { isFullscreen: true }, props: { text: "nothing here" } };
  assert.deepEqual(await r.fire("ui.render", plain), plain); // next(e) unchanged
  assert.deepEqual((await r.fire("ui.render", { ...plain, viewport: { isFullscreen: false }, props: { text: ".planning/threads/x.md" } })).props.text, ".planning/threads/x.md");
});
