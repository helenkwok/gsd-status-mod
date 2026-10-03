# gsd-status-mod

A Claude Code **mod** (needs Claude Code 2.1.287+) for a GSD project. It adds three things, each showing what the
GSD statusline does not:

    GSD · stopped: PAUSED 2026-09-09 after the schema review · 9/14 phases  ⚠ ~124 commits since STATE.md   <- above the prompt
    ❯ /gsd-execute-phase 2                                                                                          <- dim suggestion, Tab to take
    ⏵⏵ auto mode on (shift+tab to cycle) · next: Run /gsd-execute-phase 2 · handoff 5d ago                          <- end of the line under the prompt

- **`GSD ·` line** (above the prompt): shown only for a GSD project (a `.planning/STATE.md` whose frontmatter has
  `gsd_state_version`). `stopped_at` cut to its first sentence, plus phases done. It never repeats `status` or the plan
  counts, which the GSD statusline already shows, and it shows no age: STATE.md's `last_updated` is touched without the
  content changing.
- **`⚠ ~N commits since STATE.md`**: on that line, when the commit in `state_head` is 5 or more commits behind this
  clone's HEAD, so you know STATE.md is stale. Counted from the git reflog, so approximate (it undercounts: 124 against
  217 from `git rev-list` on one repo); hidden when `state_head` is absent or not in the reflog.
- **`next:` hint** (end of the line under the prompt): `next_action` from `.planning/HANDOFF.json`, with the handoff's
  own age. It is added as a dim tail, so the engine's line and its pills stay, and it is hidden while you type or while a
  turn runs. GSD deletes the file after a resume, so it goes away when it is no longer needed.
- **Tab suggestion** (the empty prompt box, once at session start): only when the text shown in the `next:` hint names a
  command. It offers that command, plus a phase number or version if one follows (`/gsd-execute-phase 2`), so it always
  matches the hint beside it. Prose-only actions (`Nothing is pending`) and actions that say to go elsewhere (`Open a
  session in ~/other-project and run ...`) get no suggestion. Tab only fills the box; nothing runs until you press Enter.
  The engine proposes its own suggestion after each turn, so ours shows at session start only.

Everything follows a `.planning` symlink, draws nothing when there is nothing to show, and refreshes at session start
and after each turn, not mid-turn.

It deliberately does not show plan usage (5-hour / weekly limits): several mods already do, for example
`quota-meter` and `limit-watch`.

## Screenshots

All three are from a made-up demo project (`acme-portal`), in a terminal at least 16 rows tall. The `◐ medium · /effort`
row, the `Sonnet 5.5 │ v1.0 · paused │ acme-portal` statusline and the `auto mode on` text are Claude Code's and the
GSD statusline's own; what this plugin adds is the cyan and yellow line above the prompt, the dim text in the prompt
box, and `· next: … · handoff 2d ago` at the end of the last row.

**A handoff that names a command.** The `GSD ·` line, the drift warning (`~8 commits since STATE.md`), the dim
suggestion in the prompt box (Tab to take it), and the same command in the `next:` hint beside it.

![Handoff naming a command: GSD line with drift warning, /gsd-execute-phase 4 suggested in the prompt, next: hint on the last row](docs/screenshots/handoff-with-command.png)

**A handoff that names no command.** The hint still shows the next action, but no suggestion is made, so the prompt box keeps
Claude Code's own `Try "…"` text.

![Handoff with prose only: next: Nothing is pending, and the prompt box keeps its own placeholder](docs/screenshots/handoff-prose-only.png)

**Not a GSD project.** A `.planning/STATE.md` without `gsd_state_version` is ignored: nothing is added.

![A folder with a lookalike STATE.md: nothing from the plugin](docs/screenshots/not-a-gsd-project.png)

## What it can touch (reach)

Only `$.fs.read` (`.planning/STATE.md`, `.planning/HANDOFF.json`, and the git reflog `.git/logs/HEAD`, or the worktree's
git dir named in a `.git` file), `$.clock.now`, `$.ui.invalidate`, `$.ui.resolve` and `$.prompt.suggest` (a dim suggestion
in the empty prompt box: it cannot send anything). It does not hook
tool calls, prompts, permissions or compaction, writes no files, runs no processes and makes no network calls. Check it
yourself: `claude plugin validate .` prints the `$` calls the module makes.

## Compatibility with other mods

Tested on Claude Code 2.1.288 with `quota-meter` and `limit-watch` loaded together with this plugin: all three load
without errors and each draws in its own place (they use the pinned status line and a pane; this uses the `AbovePrompt`
band).

The `AbovePrompt` band and the hint line are shared. This plugin keeps whatever other mods draw there: it draws what is
below it in the chain and puts its line on top, and it appends its hint tail after another mod's tail. A mod that answers without calling `next` hides every mod after it in load order; if
such a mod loads before this one, its band is the only one shown, and that is the other mod's behaviour.

## Install it (once)

    claude plugin marketplace add helenkwok/gsd-status-mod
    claude plugin install gsd-status-mod@helenkwok-mods

After that it loads in every session, with no flag. In a project that is not a GSD project it draws nothing. Update with
`claude plugin update gsd-status-mod@helenkwok-mods`; remove with `claude plugin uninstall gsd-status-mod@helenkwok-mods`.
Add `--scope project` to install it for one project only.

## Try it without installing

Needs Claude Code 2.1.287 or later (`claude --version`) and Node 20+ only if you want to run the tests. There is nothing to
build or install: the plugin is loaded from its folder for one session.

    git clone https://github.com/helenkwok/gsd-status-mod ~/gsd-status-mod
    cd <a GSD project>        # start from the project root: it reads .planning/STATE.md relative to the cwd
    claude --plugin-dir ~/gsd-status-mod

To check the plugin itself: `cd ~/gsd-status-mod`, then `claude plugin validate .` and
`node --test tests/state-line.test.mjs`.

## Not handled yet

The band above the prompt is not drawn in a very short terminal window: it appeared at 16 rows and above and not at 13 (the
engine drops it). The hint tail and the suggestion are unaffected.

Workstream-mode `STATE.md`, walking up from a subdirectory, and Windows (untested). Background:
open-gsd/gsd-core#5174 (a maintainer asked to revisit in-tree support in November 2026; this plugin is the out-of-tree route).
