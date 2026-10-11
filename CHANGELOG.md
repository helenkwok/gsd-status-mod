# Changelog

One entry per release, newest first. Versions follow `.claude-plugin/plugin.json`; a test checks that the two agree.

## 0.8.0 (2026-10-11)

- A reply that names `.planning` markdown files gets a line under it, `open in the GSD reader`, with one link per file
  that exists: `.planning/...` paths, paths relative to `.planning`, absolute and Windows paths into it, and a bare file
  name when exactly one file has it. The reply is drawn as written. Fullscreen terminal only. Claude Code leaves paths in
  replies as plain text ([anthropics/claude-code#79839](https://github.com/anthropics/claude-code/issues/79839)).

## 0.7.1 (2026-10-11)

Nothing is out of reach any more: every list shows in full when opened.

- Reader: a folder lists every entry (was 40, then a `+N more` that could not be opened); long folders end with
  `↑ back to top`. The contents list has every heading (was 30).
- Agents: `f` shows every agent (was at most 12); running agents past the cap get a button; an opened agent shows its
  whole description (was two lines).
- Session log: opened, it shows all 40 entries it keeps (was 24).
- Work streams: an open stream adds `▸ all N in the reader`, which opens its folder.
- `/gsd-status`: blockers, needs-a-person and remaining tasks in full (was five each).

## 0.7.0 (2026-10-04)

- Pace box: how long the rest of the phase should take, and how far it should take the 5-hour window, measured per
  executor so single executors and parallel waves both count. A `next` line shows what the next wave adds.
- Timeline view (`g`): one bar per agent over the latest working stretch.
- Toasts (the `toasts` option, on by default): an agent over twice its typical time, the phase getting tight against
  the window, drift appearing.
- Reader: a contents list that jumps to a heading; a line under Read, Write and Edit rows of a `.planning` file that
  opens it in the reader.

## 0.6.1 (2026-10-04)

- The reader follows a symlink only to somewhere still under `.planning`'s own real path.
- A `state_head` shorter than 7 characters is ignored.
- CI: the tests run on every push and pull request.

## 0.6.0 (2026-10-03)

- Run history: each finished agent leaves one numbers-only record (the last 300 per project). A running agent's clock
  shows the typical time for its kind; `t` opens three trend charts.

## 0.5.0 (2026-10-03)

- Pace box: plans left, waves and the widest wave, agent time by type, and how parallel the executors ran.

## 0.4.2 (2026-10-03)

- Reader: `t: ↑ back to top` at the end of a file.

## 0.4.1 (2026-10-03)

- Reader: `d: ⌂ dashboard` returns to the dashboard from any depth.

## 0.4.0 (2026-10-03)

- Markdown reader for `.planning` (`o`): a folder browser and the file, drawn by Claude Code's own `Markdown` element,
  with the YAML header hidden and relative links between files working.

## 0.3.1 (2026-10-03)

- Workstream mode counts the project-wide folders at `.planning/` too.

## 0.3.0 (2026-10-03)

- GSD workstream mode: reads `.planning/workstreams/<name>/`; `w` switches between workstreams.

## 0.2.2 (2026-10-03)

- The pane works from a linked git worktree, reading the main checkout's `.planning`.

## 0.2.1 (2026-10-03)

- Paths resolve from the session root, so a Bash `cd` no longer loses the project.

## 0.2.0 (2026-10-03)

- The live pane: context, cost and limits, the roadmap, an agent tree with forks, work streams and a session log.
  `/gsd-board` and the `openOnStart` option.

## 0.1.0 (2026-10-03)

- The `GSD ·` line above the prompt with a drift warning, the handoff's `next:` hint, a Tab suggestion, and `/gsd-status`.
