import test from "node:test";
import assert from "node:assert/strict";
import { summarize, isGsdState, resumeLine, handoffLine, handoffInfo, nextCommand, commitsSince, driftNote } from "../hooks/state-line.mjs";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const fm = (body) => `---\ngsd_state_version: "1.0"\n${body}\n---\n# State\n`;

// --- summarize
test("summarize: first sentence, not a blind cut", () =>
  assert.equal(summarize("PAUSED 2026-09-09 after the schema review. Release notes still to write."), "PAUSED 2026-09-09 after the schema review"));
test("summarize: a dot inside PLAN.md or a date is not a sentence end", () =>
  assert.equal(summarize("Completed 01-13-PLAN.md (Phase 1 complete)"), "Completed 01-13-PLAN.md (Phase 1 complete)"));
test("summarize: long single sentence is cut at a word", () => {
  const s = summarize("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau", 40);
  assert.match(s, /…$/);
  assert.ok(s.length <= 40);
  assert.ok(!/\s…$/.test(s));
});
test("summarize: whitespace and empties", () => {
  assert.equal(summarize("  a\n  b  "), "a b");
  assert.equal(summarize(""), "");
  assert.equal(summarize(undefined), "");
});

// --- isGsdState
test("isGsdState: only a STATE.md with gsd_state_version", () => {
  assert.equal(isGsdState(fm("status: x")), true);
  assert.equal(isGsdState("---\nstatus: x\n---\n"), false);
  assert.equal(isGsdState("# State\n"), false);
  assert.equal(isGsdState(""), false);
});

// --- resumeLine
test("resumeLine: stopped_at summarised plus phases, no age", () => {
  const s = resumeLine(fm(`stopped_at: PAUSED 2026-09-09 after ingest. Engine API deferred.
last_updated: "2026-10-03T11:00:00Z"
progress:
  total_phases: 14
  completed_phases: 9`));
  assert.equal(s, "GSD · stopped: PAUSED 2026-09-09 after ingest · 9/14 phases");
  assert.ok(!/ago/.test(s));
});
test("resumeLine: never repeats status or plan counts", () => {
  const s = resumeLine(fm("status: verifying\nstopped_at: a\nprogress:\n  total_plans: 13\n  completed_plans: 13"));
  assert.ok(!s.includes("verifying") && !s.includes("13/13"));
});
test("resumeLine: not a GSD STATE.md -> null", () =>
  assert.equal(resumeLine("---\nstopped_at: a\nprogress:\n  total_phases: 3\n---\n"), null));
test("resumeLine: nothing the statusline lacks -> null", () =>
  assert.equal(resumeLine(fm("status: executing\ncurrent_phase: 2")), null));
test("resumeLine: no frontmatter -> null", () => assert.equal(resumeLine("# State\nPhase: 4\n"), null));
test("resumeLine: CRLF", () =>
  assert.equal(resumeLine("---\r\ngsd_state_version: 1\r\nstopped_at: a\r\n---\r\n"), "GSD · stopped: a"));

// --- handoffLine
const ho = (o) => JSON.stringify(o);
test("handoffLine: next action and the handoff's own age", () =>
  assert.equal(handoffLine(ho({ next_action: "Run /gsd-execute-phase 22. Then verify.", timestamp: "2026-10-03T09:00:00Z" }), NOW),
    "next: Run /gsd-execute-phase 22 · handoff 3h ago"));
test("handoffLine: no timestamp -> no age", () =>
  assert.equal(handoffLine(ho({ next_action: "go" }), NOW), "next: go"));
test("handoffLine: missing/blank next_action, bad JSON -> null", () => {
  assert.equal(handoffLine(ho({ status: "paused" }), NOW), null);
  assert.equal(handoffLine(ho({ next_action: "  " }), NOW), null);
  assert.equal(handoffLine("{not json", NOW), null);
  assert.equal(handoffLine("null", NOW), null);
});
test("handoffLine: future timestamp shows no age", () =>
  assert.equal(handoffLine(ho({ next_action: "go", timestamp: "2027-01-01T00:00:00Z" }), NOW), "next: go"));

// --- nextCommand / handoffInfo: the suggestion must match what the hint shows
test("nextCommand: command plus a phase number or version only", () => {
  assert.equal(nextCommand("Run /gsd-execute-phase 2. Wave 1 is 02-01"), "/gsd-execute-phase 2");
  assert.equal(nextCommand("then /gsd-verify-work 4, entering the UAT"), "/gsd-verify-work 4");
  assert.equal(nextCommand("Run /gsd-complete-milestone v1 to archive milestone v1"), "/gsd-complete-milestone v1");
  assert.equal(nextCommand("/gsd-execute-phase 4.5 (3 plans)"), "/gsd-execute-phase 4.5");
  assert.equal(nextCommand("/gsd-new-milestone — there is nothing to resume"), "/gsd-new-milestone");
  assert.equal(nextCommand("/gsd-phase -> create a phase"), "/gsd-phase");
});
test("nextCommand: free-text arguments are dropped; prose and paths give null", () => {
  assert.equal(nextCommand("run /gsd-quick fix the login bug"), "/gsd-quick");
  assert.equal(nextCommand("Nothing is pending. Competition is wrapped."), null);
  assert.equal(nextCommand("edit ~/.claude/gsd-core/notes.md"), null);
  assert.equal(nextCommand("see docs/gsd-notes"), null);
  assert.equal(nextCommand(undefined), null);
});
test("handoffInfo: the command comes only from the text that is shown", () => {
  const na = "Nothing is in flight. Highest-value next step is a re-run. Then /gsd-new-milestone later.";
  const r = handoffInfo(ho({ next_action: na }), NOW);
  assert.equal(r.line, "next: Nothing is in flight");
  assert.equal(r.command, null);                     // /gsd-new-milestone is not in the shown text
});
test("handoffInfo: a command named in the shown text is offered, and appears in the line", () => {
  const r = handoffInfo(ho({ next_action: "Run /gsd-execute-phase 2. Wave 1 is 02-01.", timestamp: "2026-10-03T09:00:00Z" }), NOW);
  assert.equal(r.command, "/gsd-execute-phase 2");
  assert.ok(r.line.includes(r.command));
});
test("handoffInfo: no suggestion when the action says to go elsewhere", () => {
  const r = handoffInfo(ho({ next_action: "Open a session in ~/workspace/other-project and run /gsd-verify-work 4" }), NOW);
  assert.equal(r.command, null);
  assert.ok(r.line.startsWith("next: Open a session"));
});
test("handoffInfo: bad input -> null", () => {
  assert.equal(handoffInfo("{nope", NOW), null);
  assert.equal(handoffInfo(ho({ status: "paused" }), NOW), null);
});

// --- commitsSince / driftNote
const H = (o, n, msg) => `${o} ${n} Name <e@x> 1700000000 +0000\t${msg}`;
const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40), D = "d".repeat(40), E = "e".repeat(40);
const log = [H("0".repeat(40), A, "commit (initial): one"), H(A, B, "commit: two"), H(B, C, "checkout: moving from x to y"),
  H(C, D, "commit: three"), H(D, E, "merge feature: Fast-forward")].join("\n");

test("commitsSince: counts commits/merges after the state_head, ignores checkouts", () => {
  assert.equal(commitsSince(log, B.slice(0, 7)), 2);   // three + merge; the checkout is not a commit
  assert.equal(commitsSince(log, E.slice(0, 7)), 0);   // already at HEAD
});
test("commitsSince: unknown commit or no state_head -> null", () => {
  assert.equal(commitsSince(log, "f".repeat(7)), null);
  assert.equal(commitsSince(log, undefined), null);
  assert.equal(commitsSince("", "abc1234"), null);
});
test("driftNote: only at or above the threshold", () => {
  const st = (h) => fm(`state_head: ${h}`);
  assert.equal(driftNote(st(B), log, 2), "⚠ ~2 commits since STATE.md");
  assert.equal(driftNote(st(B), log, 5), null);
  assert.equal(driftNote(st(E), log, 1), null);
});
test("driftNote: not GSD, no state_head, or unknown commit -> null", () => {
  assert.equal(driftNote("---\nstate_head: bbbbbbb\n---\n", log, 1), null);
  assert.equal(driftNote(fm("status: x"), log, 1), null);
  assert.equal(driftNote(fm("state_head: fffffff"), log, 1), null);
});
