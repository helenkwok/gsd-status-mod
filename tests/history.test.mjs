import test from "node:test";
import assert from "node:assert/strict";
import { KEEP, stageOf, addRun, typical, phaseTotals, dailyBuckets, spark, dur, quotaPerRun, forecast, burst } from "../hooks/history.mjs";
import { planShape } from "../hooks/panel.mjs";

const run = (end, type, phase, ms) => [end, type, phase, ms, 10, 1000, 100, "m"];
const MIN = 60000;

test("stages", () => {
  assert.equal(stageOf("gsd-planner"), "planning");
  assert.equal(stageOf("gsd-executor"), "executing");
  assert.equal(stageOf("gsd-verifier"), "checking");
  assert.equal(stageOf("general-purpose"), "other");
  assert.equal(stageOf(undefined), "other");
});

test("addRun keeps the newest KEEP runs", () => {
  let r = [];
  for (let i = 0; i < KEEP + 5; i++) r = addRun(r, run(i, "executor", "1", 1));
  assert.equal(r.length, KEEP);
  assert.equal(r[0][0], 5);
  assert.deepEqual(addRun(undefined, run(1, "x", "1", 1)).length, 1);
});

test("typical needs five runs of that type and is their median", () => {
  const runs = [10, 20, 30, 40].map((m, i) => run(i, "gsd-executor", "1", m * MIN));
  assert.equal(typical(runs, "gsd-executor"), null);
  runs.push(run(9, "executor", "1", 50 * MIN)); // "gsd-" prefix is ignored
  assert.equal(typical(runs, "gsd-executor"), 30 * MIN);
  assert.equal(typical([...runs, run(10, "gsd-planner", "1", 999 * MIN)], "gsd-executor"), 30 * MIN);
  runs.push(run(11, "executor", "1", 60 * MIN));
  assert.equal(typical(runs, "executor"), 35 * MIN); // even count: mean of the two middle
});

test("phaseTotals splits a phase by stage and orders phases by when they last ran", () => {
  const p = phaseTotals([run(100, "gsd-planner", "4", 10), run(200, "gsd-executor", "4", 30), run(150, "gsd-executor", "3", 5), run(210, "gsd-verifier", "4", 2), run(1, "gsd-executor", "", 7)]);
  assert.deepEqual(p.map((x) => x.phase), ["?", "3", "4"]);
  const four = p[2];
  assert.deepEqual([four.planning, four.executing, four.checking, four.total], [10, 30, 2, 42]);
  assert.equal(phaseTotals(Array.from({ length: 12 }, (_, i) => run(i, "executor", String(i), 1)), 8).length, 8);
});

test("dailyBuckets: a run counts on the day it ended, oldest first", () => {
  const noon = (d) => new Date(2026, 9, d, 12, 0, 0).getTime();
  const b = dailyBuckets([run(noon(3), "x", "1", 60 * MIN), run(noon(3), "x", "1", 30 * MIN), run(noon(1), "x", "1", 10 * MIN), run(noon(3) - 40 * 864e5, "x", "1", 99 * MIN)], noon(3), 14);
  assert.equal(b.length, 14);
  assert.equal(b[13].ms, 90 * MIN);
  assert.equal(b[11].ms, 10 * MIN);
  assert.equal(b.reduce((m, x) => m + x.ms, 0), 100 * MIN); // the run from 40 days ago is outside
});

test("spark and dur", () => {
  assert.equal(spark([0, 1, 4, 8]), "·▁▄█");
  assert.equal(spark([0, 0]), "··");
  assert.equal(spark([]), "");
  assert.equal(dur(45 * MIN), "45m");
  assert.equal(dur(10400), "10s");
  assert.equal(dur(125 * MIN), "2h05");
});

const q = (end, ms, quota, width = 1) => [end, "gsd-executor", "1", ms, 10, 1, 1, "m", quota, width];

test("quotaPerRun: median and middle half of measured runs, none under five, unmeasured (-1, absent) left out", () => {
  const runs = [2, 3, 3, 4, 10].map((v, i) => q(i, MIN, v));
  assert.deepEqual(quotaPerRun(runs), { n: 5, med: 3, lo: 3, hi: 4 });
  assert.equal(quotaPerRun(runs.slice(1)), null); // four measured
  assert.equal(quotaPerRun([...runs.slice(1), q(9, MIN, -1), run(9, "gsd-executor", "1", MIN)]), null); // -1 and an old 8-number row do not count
});

test("forecast: executor time per open wave less what a running one has spent; quota per executor adds up however they overlap", () => {
  const runs = [10, 10, 10, 10, 10, 10].map((m, i) => q(i, m * MIN, 3, i % 2 ? 3 : 1));
  const plans = [{ id: "a", wave: 1, done: true }, { id: "b", wave: 2, done: false }, { id: "c", wave: 2, done: false }, { id: "d", wave: 2, done: false }, { id: "e", wave: 3, done: false }];
  const shape = planShape(plans); // 4 open: three together in wave 2, one in wave 3
  const reset = new Date(1000 + 90 * MIN).toISOString();
  const f = forecast(shape, runs, [{ type: "gsd-executor", status: "running", since: 1000 - 4 * MIN }], 1000, [{ kind: "five_hour", pct: 70, resetsAt: reset }]);
  assert.equal(f.ms, 16 * MIN); // two waves x 10m, 4m already spent
  assert.equal(f.nextN, 3);
  assert.equal(f.resetMs, 90 * MIN);
  assert.equal(f.quota.add, 12); // 4 executors x 3 points, whether run three together or one by one
  assert.equal(f.quota.next.add, 9);
  assert.equal(f.quota.end, 82);
  assert.equal(f.level, null);
  assert.equal(forecast(shape, runs, [], 1000, [{ kind: "five_hour", pct: 95, resetsAt: reset }]).level, "warn"); // 95 + 12 passes 100
  assert.equal(forecast(shape, runs, [], 1000, [{ kind: "five_hour", pct: 80, resetsAt: reset }]).level, "amber"); // 92 of the window
});

test("forecast: time only until quota is measured; nothing without executor history or open plans", () => {
  const runs = [10, 10, 10].map((m, i) => run(i, "gsd-executor", "1", m * MIN)); // three runs: enough for time, none measured for quota
  const shape = planShape([{ id: "a", wave: 1, done: false }, { id: "b", wave: 2, done: false }]);
  const f = forecast(shape, runs, [], 0, [{ kind: "five_hour", pct: 10, resetsAt: new Date(5 * MIN).toISOString() }]);
  assert.equal(f.quota, null);
  assert.equal(f.level, "amber"); // 20m of work, the window resets in 5m
  assert.equal(forecast(shape, runs.slice(1), [], 0, []), null);
  assert.equal(forecast(planShape([{ id: "a", wave: 1, done: true }]), runs, [], 0, []), null);
});

test("burst: the latest working stretch, split at a long quiet gap, running agents included", () => {
  const H = 60 * MIN;
  const runs = [run(1 * H, "gsd-executor", "1", 10 * MIN), run(5 * H, "gsd-planner", "1", 10 * MIN), run(5 * H + 20 * MIN, "gsd-executor", "1", 15 * MIN)];
  const b = burst(runs, [{ type: "gsd-executor", status: "running", since: 5 * H + 25 * MIN }], 5 * H + 30 * MIN);
  assert.deepEqual(b.map((x) => x.type), ["gsd-planner", "gsd-executor", "gsd-executor"]); // the 1h run is hours earlier
  assert.equal(b[2].running, true);
  assert.deepEqual([b[0].a, b[0].b], [5 * H - 10 * MIN, 5 * H]);
  assert.equal(burst([], [], 0).length, 0);
  assert.equal(burst(Array.from({ length: 20 }, (_, i) => run(i * MIN, "gsd-executor", "1", MIN)), [], 0).length, 12);
});
