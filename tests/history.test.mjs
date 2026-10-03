import test from "node:test";
import assert from "node:assert/strict";
import { KEEP, stageOf, addRun, typical, phaseTotals, dailyBuckets, spark, dur } from "../hooks/history.mjs";

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
