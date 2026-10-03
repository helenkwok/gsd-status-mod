import { isGsdState, resumeLine, handoffInfo, driftNote } from "./state-line.mjs";

// The command named by the handoff's next_action (see nextCommand) is offered as a dim suggestion: Tab puts it in the
// prompt box and nothing runs until the person presses Enter. No command named, no suggestion.

// Module state: the render hooks only read these, never touch the file system.
let rows = { resume: null, drift: null, handoff: null, command: null };
let suggested = false;

const read = ($, path) => $.fs.read(path).catch(() => null);

// The reflog lives in .git/logs/HEAD; in a linked worktree .git is a file pointing at the real git dir.
async function reflog($) {
  const direct = await read($, ".git/logs/HEAD");
  if (direct != null) return direct;
  const ptr = await read($, ".git");
  const dir = ptr && /^gitdir:\s*(.+)$/m.exec(ptr)?.[1]?.trim();
  return dir ? read($, `${dir}/logs/HEAD`) : null;
}

async function refresh($) {
  const state = await read($, ".planning/STATE.md");
  const isGsd = state != null && isGsdState(state);
  const handoffText = isGsd ? await read($, ".planning/HANDOFF.json") : null;
  const handoff = handoffText == null ? null : handoffInfo(handoffText, await $.clock.now());
  rows = {
    resume: isGsd ? resumeLine(state) : null,
    handoff: handoff?.line ?? null,
    command: handoff?.command ?? null,
    drift: null,
  };
  if (rows.resume && /^state_head:/m.test(state)) {
    const log = await reflog($);
    if (log != null) rows.drift = driftNote(state, log);
  }
  $.ui.invalidate("ui.render"); // render output is cached until invalidated
}

export function register(on) {
  on("session.start", async ($, e, next) => {
    await refresh($);
    // Once per session, and only when the handoff names a command: propose it in the empty prompt box.
    if (rows.command && !suggested) {
      suggested = true;
      await $.prompt.suggest({ text: rows.command }).catch(() => {});
    }
    return next(e);
  });
  on("turn.complete", async ($, e, next) => { await refresh($); return next(e); });

  // The band above the prompt: the GSD line, and the drift warning when STATE.md is behind.
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const below = await next(e); // whatever other mods draw in this band: keep it, add our line on top
    const { resume, drift } = rows;
    if (!resume) return below;
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
