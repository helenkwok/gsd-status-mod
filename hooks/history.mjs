// What a finished agent leaves behind, and what the pace box and the trends view make of it. Pure: no `$`.
// A run is [endedAtMs, type, phase, durationMs, turns, inTokens, outTokens, model]. Numbers only: no description, no text.
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
