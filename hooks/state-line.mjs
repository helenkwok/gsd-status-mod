// Pure: STATE.md text -> one-line summary. No $ access, so it is testable under plain Node.
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  let nested = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line || line.trimStart().startsWith("#")) continue;
    const kv = /^(\s*)([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, indent, key, val] = kv;
    const v = val.replace(/^["']|["']$/g, "");
    if (!indent && v === "") { nested = out[key] = {}; continue; }
    if (indent && nested) nested[key] = v; else { nested = null; out[key] = v; }
  }
  return out;
}

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Free text (stopped_at, next_action) -> something that reads at a glance: the first sentence,
// else cut at a word boundary. A "." inside a name like PLAN.md or 2026-09-09 is not a sentence end.
export function summarize(text, max = 70) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const first = /^(.+?[.!?])(?=\s+[A-Z(]|$)/.exec(s)?.[1] ?? s;
  const one = first.replace(/[.!?]+$/, "");
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:–—-]+$/, "") + "…";
}

// True for a STATE.md that GSD wrote (its frontmatter carries gsd_state_version), not any file with that name.
export function isGsdState(text) {
  const fm = frontmatter(text);
  return Boolean(fm && fm.gsd_state_version);
}

// Where work stopped and how many phases are done. No age: STATE.md's last_updated is touched by tools
// without the content changing, so "17h ago" can sit beside a stopped_at from weeks earlier.
// Returns null for a non-GSD file or when there is nothing the GSD statusline lacks.
export function resumeLine(text, max = 70) {
  const fm = frontmatter(text);
  if (!fm || !fm.gsd_state_version) return null;
  const parts = [];
  if (fm.stopped_at) parts.push("stopped: " + summarize(fm.stopped_at, max));
  const p = fm.progress;
  if (p && p.total_phases) parts.push(`${p.completed_phases ?? 0}/${p.total_phases} phases`);
  return parts.length ? "GSD · " + parts.join(" · ") : null;
}

// The command a next_action names, if it names one: the first /gsd-<name>, plus at most one argument that looks like
// a phase number or version (2, 4.5, v1). Free-text arguments are dropped, so the result is something that can be
// offered as a suggestion without guessing. null when the text names no command (prose such as "Nothing is pending").
export function nextCommand(nextAction) {
  const m = /(?<![\w/.~-])(\/gsd-[a-z][a-z0-9-]*)(?:\s+(v?\d+(?:\.\d+)*[a-z]?)(?![\w-]))?/.exec(String(nextAction ?? ""));
  return m ? m[1] + (m[2] ? " " + m[2] : "") : null;
}

// HANDOFF.json is the resume note GSD writes on pause. Its next_action is the first thing to read when resuming.
// The age is the handoff's own timestamp, so unlike STATE.md's it means what it says.
// Returns { line, command }: the text for the hint line, and the command that text names (or null).
export function handoffInfo(jsonText, now = Date.now(), max = 90) {
  let j;
  try { j = JSON.parse(jsonText); } catch { return null; }
  if (!j || typeof j.next_action !== "string" || !j.next_action.trim()) return null;
  const shown = summarize(j.next_action, max);
  const parts = ["next: " + shown];
  const t = j.timestamp ? Date.parse(j.timestamp) : NaN;
  if (!Number.isNaN(t) && now >= t) parts.push("handoff " + ago(now - t));
  // The command comes only from the text that is shown, so the Tab suggestion always matches the hint beside it,
  // and not when the action says to go and do it somewhere else (another session, another directory).
  const elsewhere = /\b(open|start|launch)\b[^.]*\b(session|terminal|window)\b|~\/|\/Users\//i.test(shown);
  return { line: parts.join(" · "), command: elsewhere ? null : nextCommand(shown) };
}

export function handoffLine(jsonText, now = Date.now(), max = 90) {
  return handoffInfo(jsonText, now, max)?.line ?? null;
}

// Commits made after the one STATE.md was written at, counted from the git reflog text (.git/logs/HEAD),
// so no git process is needed. null when the reflog does not contain that commit (pruned, rebased, other clone).
export function commitsSince(reflogText, stateHead) {
  if (!stateHead) return null;
  const rows = reflogText.split(/\r?\n/).filter(Boolean).map((l) => {
    const [head, msg = ""] = l.split("\t");
    const [, now] = head.split(" ");
    return { now, msg };
  });
  let at = -1;
  rows.forEach((r, i) => { if (r.now && r.now.startsWith(stateHead)) at = i; });
  if (at < 0) return null;
  return rows.slice(at + 1).filter((r) => /^(commit|merge|pull|cherry-pick|revert)/.test(r.msg)).length;
}

// "⚠ ~217 commits since STATE.md" when STATE.md is well behind the repo, else null. Approximate: the reflog only
// holds this clone's own HEAD moves, so it undercounts (measured: 124 against 217 from git rev-list).
export function driftNote(stateText, reflogText, threshold = 5) {
  const fm = frontmatter(stateText);
  if (!fm || !fm.gsd_state_version || !fm.state_head) return null;
  const n = commitsSince(reflogText, fm.state_head);
  return n != null && n >= threshold ? `⚠ ~${n} commits since STATE.md` : null;
}
