// The data shapes the hooks pass between them. Types only: nothing here exists at run time.
import type { FsEntry } from "claude-code";

// A finished agent's numbers, as history.ts keeps them (see there). quota and width are absent in older runs.
export type Run = [endedAt: number, type: string, phase: string, durationMs: number, turns: number, inTokens: number, outTokens: number, model: string, quota?: number, width?: number];

// An agent as the pane sees it: what $.agent.list() answers, plus when this module first saw it and when it ended.
export type Agent = { id: string; type?: string; description?: string; status: string; since?: number | null; endedAt?: number | null; parentId?: string; isFork?: boolean };
export type TreeAgent = Agent & { depth: number };

// One rate-limit window ("five_hour", "seven_day", ...) and the session's figures, as readUsage makes them.
export type Limit = { kind: string; pct: number; resetsAt?: string | null };
export type Usage = { pct: number | null; tokens: number | null; window: number | null; costUsd: number | null; limits: Limit[] };

// STATE.md's frontmatter: top-level values, and one level of nested keys (progress:).
export type Fields = Record<string, string>;
export type Frontmatter = { [key: string]: string | Fields | undefined; progress?: Fields };

// HANDOFF.json as GSD writes it on pause; the lists come as strings or objects (see items()).
export type Handoff = { next_action?: string; timestamp?: string; blockers?: unknown; human_actions_pending?: unknown; remaining_tasks?: unknown; uncommitted_files?: unknown };

export type Plan = { id: string; wave: number; done: boolean };
export type PlanShape = { total: number; open: number; waves: number; widest: number; byWave: [number, Plan[]][] };

export type Stage = "planning" | "executing" | "checking" | "other";

// A work stream's directory listing, each entry tagged with the folder it came from when there are two.
export type Entry = FsEntry & { from?: string };
export type StreamInfo = { count: number; newest: string; recent: string[]; paths?: string[] };
export type Stream = StreamInfo & { name: string };

export type Workstream = { name: string; index: number; total: number; names: string[] };

// The markdown reader: a folder listing or one file.
export type Reader = { path: string; isFile: boolean; entries?: FsEntry[]; text?: string };

// Which of the pane's parts the person has opened.
export type Expand = { agents: Set<string>; finished: boolean; blockers: boolean; log: boolean; roadmap: boolean; pace: boolean; trends: boolean; timeline: boolean; toc: boolean; streams?: Set<string> };

export type LogRow = { at: number; kind: string; text: string };
export type Turn = { startedAt: number; edits: number; errors: number };
export type Receipt = { durationMs: number; edits: number; errors: number; commits: number; costDelta: number | null };

// What the pane draws, as data (see panel.ts). A segment is [text, color, flags].
export type Segment = [text: string, color: string | null, flags?: string];
export type Button = { key: string; label: string; color: string | null; hotkey?: string };
export type Toggle = { key: string; open?: boolean; hotkey?: string };
export type Control = { segs?: Segment[]; toggle?: Toggle; button?: Button; md?: string; key?: string };
export type Line = Segment[] | Control;
export type Panel = { id: string; color: string; title: Segment[]; right: Segment[] | null; lines: Line[] };
export type Model = { header: Segment[]; panels: Panel[] };

export type PanelInput = {
  history?: Run[]; plans?: Plan[]; reader?: Reader | null; roadmap?: string | null; state?: string | null; usage?: Usage | null;
  isRunning?: boolean; turn?: Turn | null; receipt?: Receipt | null; agents?: Agent[]; streams?: Stream[]; handoff?: Handoff | null;
  log?: LogRow[]; workstream?: Workstream | null; expand?: Partial<Expand>; now?: number;
};
