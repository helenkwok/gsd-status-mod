// What a finished agent leaves behind, and what the pace box and the trends view make of it. Pure: no `$`.
// A run is [endedAtMs, type, phase, durationMs, turns, inTokens, outTokens, model, quota]. Numbers only: no description, no text.
// `quota` is the points of the 5-hour window one agent used: the window's rise over the stretch in which agents overlapped,
// divided by how many ran (`width`, the last number). -1: not measurable; both absent in older runs.
export const KEEP = 300; // runs kept per project, the oldest dropped first

const bare = (t) => String(t ?? "").replace(/^gsd-/, "");
const STAGES = {
  planning: /^(planner|phase-researcher|project-researcher|pattern-mapper|roadmapper)$/,
  executing: /^(executor|code-fixer)$/,
  checking: /^(verifier|plan-checker|code-reviewer|ui-checker|security-auditor)$/,
};
export const stageOf = (type) => Object.keys(STAGES).find((k) => STAGES[k].test(bare(type))) ?? "other";

export const addRun = (runs, run) => [...(runs ?? []), run].slice(-KEEP);

// The median duration of past runs of this agent type, once there are `min` of them, else null.
export function typical(runs, type, min = 5) {
  const d = (runs ?? []).filter((r) => bare(r[1]) === bare(type)).map((r) => r[3]).sort((a, b) => a - b);
  return d.length >= min ? (d[(d.length - 1) >> 1] + d[d.length >> 1]) / 2 : null;
}

const pick = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

// Points of the 5-hour window an agent of this type uses: the median and the middle half of the runs where it was measured
// cleanly, alone or in a parallel wave. Null under `min` such runs. The account is shared with other sessions and with the
// main conversation, so this is a range, never one number.
export function quotaPerRun(runs, type = "executor", min = 5) {
  const q = (runs ?? []).filter((r) => bare(r[1]) === bare(type) && r[8] >= 0).map((r) => r[8]).sort((a, b) => a - b);
  return q.length >= min ? { n: q.length, med: pick(q, 0.5), lo: pick(q, 0.25), hi: pick(q, 0.75) } : null;
}

// What is left of the current phase: executor time (one typical run per open wave, the running executor's time already spent
// taken off) and, once quota is measured, the points the open plans would add to the 5-hour window.
// shape: planShape(...); limits: [{ kind, pct, resetsAt }]. Null when nothing is open or executors have no history.
export function forecast(shape, runs, agents, now, limits) {
  const typ = typical(runs, "executor", 3);
  if (!shape?.open || !typ) return null;
  const spent = Math.max(0, ...(agents ?? []).filter((a) => a.status === "running" && bare(a.type) === "executor" && a.since).map((a) => now - a.since));
  const five = (limits ?? []).find((l) => /five|5h/i.test(l.kind) && Number.isFinite(l.pct));
  const resetMs = five?.resetsAt && Number.isFinite(Date.parse(five.resetsAt)) ? Date.parse(five.resetsAt) - now : null;
  const q = five ? quotaPerRun(runs) : null;
  const n = (runs ?? []).filter((r) => bare(r[1]) === "executor").length;
  const next = (shape.byWave ?? []).find(([, l]) => l.some((p) => !p.done));
  const nextN = next ? next[1].filter((p) => !p.done).length : 0; // executors in the next wave: they run together
  const out = { ms: Math.max(0, shape.waves * typ - spent), waves: shape.waves, open: shape.open, nextN, runs: n, pct: five?.pct ?? null, resetMs, quota: null, level: null };
  if (q) {
    const add = shape.open * q.med, lo = shape.open * q.lo, hi = shape.open * q.hi;
    out.quota = { add, lo, hi, end: five.pct + add, endHi: five.pct + hi, n: q.n, next: { add: nextN * q.med, lo: nextN * q.lo, hi: nextN * q.hi, end: five.pct + nextN * q.med } };
    out.level = out.quota.endHi >= 100 ? "warn" : out.quota.end >= 90 ? "amber" : null;
  } else if (resetMs != null && out.ms > resetMs) out.level = "amber";
  return out;
}

// The latest working stretch for the timeline: runs that ended and agents running now, going back from the newest until a
// quiet gap longer than `gap`, at most `max` of them, by start time. -> [{ type, a, b, running }]
export function burst(runs, running, now, gap = 30 * 60000, max = 12) {
  const iv = (runs ?? []).map((r) => ({ type: r[1], a: r[0] - r[3], b: r[0], running: false }))
    .concat((running ?? []).filter((x) => x.status === "running" && x.since).map((x) => ({ type: x.type, a: x.since, b: now, running: true })))
    .sort((x, y) => y.a - x.a);
  const out = [];
  let floor = Infinity;
  for (const x of iv) {
    if (out.length && x.b < floor - gap) break;
    out.push(x); floor = Math.min(floor, x.a);
    if (out.length >= max) break;
  }
  return out.reverse();
}

// Time per phase and stage, the last `last` phases by when they last ran. -> [{ phase, total, planning, executing, checking, other }]
export function phaseTotals(runs, last = 8) {
  const by = new Map();
  for (const r of runs ?? []) {
    const key = r[2] || "?";
    const p = by.get(key) ?? { phase: key, end: 0, total: 0, planning: 0, executing: 0, checking: 0, other: 0 };
    p[stageOf(r[1])] += r[3]; p.total += r[3]; p.end = Math.max(p.end, r[0]);
    by.set(key, p);
  }
  return [...by.values()].sort((a, b) => a.end - b.end).slice(-last);
}

// Agent time per local day for the last `days` days, oldest first. A run counts on the day it ended.
export function dailyBuckets(runs, now, days = 14) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const out = Array.from({ length: days }, (_, i) => ({ start: new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i)).getTime(), ms: 0 }));
  for (const r of runs ?? []) { const b = [...out].reverse().find((d) => r[0] >= d.start); if (b && r[0] < b.start + 864e5) b.ms += r[3]; }
  return out;
}

// One block per value, tall for large, "·" for zero: a sparkline.
export function spark(values) {
  const max = Math.max(0, ...values), ticks = "▁▂▃▄▅▆▇█";
  return values.map((v) => (v <= 0 ? "·" : ticks[Math.min(7, Math.floor((v / max) * 7.999))])).join("");
}

export const dur = (ms) => {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};
