// Pure: STATE.md text -> one-line summary. No $ access, so it is testable under plain Node.
export function frontmatter(text) {
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

// Free-form lists in HANDOFF.json (blockers, human_actions_pending, remaining_tasks) come as strings or as objects
// with some text field. Show each as one line of text; anything unreadable is skipped rather than guessed at.
export function items(v) {
  if (v == null || v === "") return [];
  const list = Array.isArray(v) ? v : [v];
  return list
    .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? (x.description ?? x.text ?? x.title ?? x.task ?? x.name ?? "") : String(x)))
    .map((s) => summarize(s, 110))
    .filter(Boolean);
}

function listBlock(label, v, show = 5) {
  const all = items(v);
  if (!all.length) return [];
  const out = [`${label} (${all.length})`, ...all.slice(0, show).map((s) => "  - " + s)];
  if (all.length > show) out.push(`  … and ${all.length - show} more`);
  return out;
}

// The full resume report for the /gsd-status command: everything the band and hint compress, in plain lines.
// Pure. stateText may be null (no STATE.md), handoffText may be null (no HANDOFF.json), driftText is driftNote's output.
// Returns { text, isGsd }: isGsd is false when there is no GSD STATE.md here, and text then says so.
export function statusReport(stateText, handoffText, now = Date.now(), drift = null) {
  const fm = stateText == null ? null : frontmatter(stateText);
  if (!fm || !fm.gsd_state_version) {
    return { isGsd: false, text: "No GSD project here: .planning/STATE.md is missing or has no gsd_state_version." };
  }
  const out = ["GSD status"];
  const phase = [fm.current_phase && `phase ${fm.current_phase}`, fm.current_phase_name].filter(Boolean).join(" · ");
  if (phase) out.push("Now: " + phase + (fm.status ? ` (${fm.status})` : ""));
  else if (fm.status) out.push("Status: " + fm.status);
  const p = fm.progress;
  if (p) {
    const bits = [];
    if (p.total_phases) bits.push(`${p.completed_phases ?? 0}/${p.total_phases} phases`);
    if (p.total_plans) bits.push(`${p.completed_plans ?? 0}/${p.total_plans} plans`);
    if (bits.length) out.push("Progress: " + bits.join(" · "));
  }
  if (fm.stopped_at) out.push("Stopped at: " + summarize(fm.stopped_at, 220));
  if (drift) out.push(drift);

  let j = null;
  try { j = handoffText == null ? null : JSON.parse(handoffText); } catch { /* unreadable handoff: say so below */ }
  if (handoffText != null && !j) out.push("", "HANDOFF.json is present but is not valid JSON.");
  if (j && typeof j === "object") {
    const t = j.timestamp ? Date.parse(j.timestamp) : NaN;
    const age = !Number.isNaN(t) && now >= t ? ` (written ${ago(now - t)})` : "";
    out.push("", "Handoff" + age);
    if (typeof j.next_action === "string" && j.next_action.trim()) {
      out.push("Next: " + summarize(j.next_action, 260));
      const cmd = nextCommand(summarize(j.next_action, 90));
      if (cmd) out.push("Command: " + cmd);
    }
    out.push(...listBlock("Blockers", j.blockers));
    out.push(...listBlock("Needs a person", j.human_actions_pending));
    out.push(...listBlock("Remaining tasks", j.remaining_tasks));
    const files = items(j.uncommitted_files);
    if (files.length) out.push(`Uncommitted at pause: ${files.length} file${files.length === 1 ? "" : "s"}`);
  } else if (handoffText == null) {
    out.push("", "No HANDOFF.json (nothing was paused with /gsd-pause-work).");
  }
  return { isGsd: true, text: out.join("\n") };
}

// Workstream mode keeps one STATE.md per workstream under .planning/workstreams/<name>/. Which one is "the" project is
// GSD's own per-session choice, which a mod cannot see, so: the person's pick in the pane, else the name in
// .planning/active-workstream, else the one that changed most recently.
// cands: [{ name, mtimeMs }] (only workstreams that have a STATE.md) -> { name, index, total, names } | null
export function pickWorkstream(cands, marker = "", choice = "") {
  const list = [...(cands ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return null;
  const newest = [...list].sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))[0];
  const hit = list.find((c) => c.name === choice) ?? list.find((c) => c.name === String(marker).trim()) ?? newest;
  return { name: hit.name, index: list.indexOf(hit) + 1, total: list.length, names: list.map((c) => c.name) };
}
