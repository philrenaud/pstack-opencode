import readline from "node:readline";
import { resolve } from "node:path";
import { discoverCatalog } from "./catalog";
import { HistoryStore } from "./history";
import type {
  CapabilityId,
  CapabilityObservation,
  HistoryResult,
  LearnOptions,
  SnapshotResult,
  WindowKind,
} from "./types";
import {
  applyCopy,
  createInitialState,
  detailScrollLimit,
  examplesScrollLimit,
  filterCapabilities,
  isSplitLayout,
  listVisibleRows,
  renderFrame,
  renderSnapshotText,
  styleFrame,
  suggestion,
} from "./view";

const HELP_TEXT = `learn

Usage:
  learn [options]

Options:
  --project PATH         scope to project path
  --all-projects         include all local projects
  --window 7|30|all      evidence window (default 30)
  --include-subagents    include child sessions
  --db PATH              explicit opencode sqlite path
  --catalog ROOT         explicit catalog root
  --json                 print JSON snapshot
  --snapshot             print one terminal snapshot and exit
  --help                 show this help

Keys:
  q/Ctrl-C exit, arrows/jk navigate, / search, Esc back, Tab category,
  u not-observed filter, n suggested item, w window, s project/all, a subagents, r refresh,
  Enter recent examples, p print invocation and exit, c copy invocation,
  left/right focus list/detail, PgUp/PgDn/Home/End or ctrl-d/u scroll.
`;

function defaultOptions(): LearnOptions {
  return {
    cwd: process.cwd(),
    allProjects: false,
    includeSubagents: false,
    window: "30",
    json: false,
    snapshot: false,
    help: false,
  };
}

function parseArgs(argv: string[]): LearnOptions {
  const out = defaultOptions();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") {
      out.help = true;
      continue;
    }
    if (arg === "--all-projects") {
      out.allProjects = true;
      continue;
    }
    if (arg === "--include-subagents") {
      out.includeSubagents = true;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (arg === "--snapshot") {
      out.snapshot = true;
      continue;
    }
    if (arg === "--project") {
      const value = argv[++i];
      if (!value) {
        throw new Error("Missing value for --project");
      }
      out.projectPath = resolve(value);
      continue;
    }
    if (arg === "--db") {
      const value = argv[++i];
      if (!value) {
        throw new Error("Missing value for --db");
      }
      out.dbPath = resolve(value);
      continue;
    }
    if (arg === "--catalog") {
      const value = argv[++i];
      if (!value) {
        throw new Error("Missing value for --catalog");
      }
      out.catalogRoot = resolve(value);
      continue;
    }
    if (arg === "--window") {
      const value = argv[++i];
      if (value !== "7" && value !== "30" && value !== "all") {
        throw new Error("--window must be 7, 30, or all");
      }
      out.window = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function observationsFromHistory(history: HistoryResult, capabilityIds: CapabilityId[]): CapabilityObservation[] {
  if (history.kind === "available") {
    return history.observations;
  }
  return capabilityIds.map((capabilityId) => ({
    capabilityId,
    evidence: { kind: "unknown", count: { loads: 0, reads: 0 } },
  }));
}

async function buildSnapshot(options: LearnOptions, store: HistoryStore): Promise<SnapshotResult> {
  const catalog = await discoverCatalog(options.catalogRoot);
  const history = await store.refresh(catalog, options);
  const observations = observationsFromHistory(history, catalog.capabilities.map((item) => item.id));
  return {
    catalog,
    history,
    observations,
    options: {
      scope: options.allProjects ? "all-projects" : "project",
      window: options.window,
      includeSubagents: options.includeSubagents,
      projectPath: options.projectPath ?? options.cwd,
      dbPath: store.getDbPath(),
    },
  };
}

function printHelp(exitCode = 0): never {
  process.stdout.write(HELP_TEXT);
  process.exit(exitCode);
}

function windowCycle(current: WindowKind): WindowKind {
  if (current === "7") {
    return "30";
  }
  if (current === "30") {
    return "all";
  }
  return "7";
}

async function runTui(options: LearnOptions, store: HistoryStore, initialSnapshot: SnapshotResult): Promise<void> {
  const state = createInitialState();
  state.allProjects = options.allProjects;
  state.includeSubagents = options.includeSubagents;
  state.window = options.window;
  let snapshot = initialSnapshot;
  const refreshMs = 15_000;
  const originalRaw = process.stdin.isRaw;
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let queue = Promise.resolve();
  let finish!: () => void;
  const finished = new Promise<void>((resolveFinished) => { finish = resolveFinished; });

  const redraw = () => {
    if (stopped) return;
    const envWidth = Number.parseInt(process.env.COLUMNS ?? "", 10);
    const envHeight = Number.parseInt(process.env.LINES ?? "", 10);
    const width = process.stdout.columns ?? (Number.isFinite(envWidth) && envWidth > 0 ? envWidth : 120);
    const height = process.stdout.rows ?? (Number.isFinite(envHeight) && envHeight > 0 ? envHeight : 30);
    if (isSplitLayout(width)) state.narrowDetail = false;
    process.stdout.write(`\u001b[H${styleFrame(renderFrame(snapshot, state, width, height), width, process.env.NO_COLOR === undefined && process.stdout.isTTY).join("\n")}\u001b[J`);
  };
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    store.close();
    if (interval) clearInterval(interval);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.stdout.off("resize", redraw);
    process.stdin.off("keypress", onKeypress);
    process.stdin.pause();
    if (process.stdin.isTTY) process.stdin.setRawMode(originalRaw ?? false);
    process.stdout.write("\u001b[0m\u001b[?25h\u001b[?7h\u001b[?1049l");
    finish();
  };
  const fail = (error: unknown) => {
    cleanup();
    process.stderr.write(`learn: ${error instanceof Error ? error.message : "interactive operation failed"}\n`);
    process.exitCode = 1;
  };
  const onSignal = () => cleanup();
  const enqueue = (operation: () => Promise<void> | void) => {
    queue = queue.then(operation).catch(fail);
  };
  const ensureVisible = () => {
    const items = filterCapabilities(snapshot, state);
    state.selected = Math.max(0, Math.min(state.selected, items.length - 1));
    const visibleRows = listVisibleRows(process.stdout.rows ?? 30);
    if (state.selected < state.listOffset) state.listOffset = state.selected;
    if (state.selected >= state.listOffset + visibleRows) state.listOffset = state.selected - visibleRows + 1;
    state.listOffset = Math.max(0, Math.min(state.listOffset, Math.max(0, items.length - visibleRows)));
    state.detailOffset = Math.min(state.detailOffset, detailScrollLimit(snapshot, state, process.stdout.columns ?? 120, process.stdout.rows ?? 30));
    state.examplesOffset = Math.min(state.examplesOffset, examplesScrollLimit(snapshot, state, process.stdout.columns ?? 120, process.stdout.rows ?? 30));
  };
  const refresh = async () => {
    if (stopped) return;
    const before = filterCapabilities(snapshot, state)[state.selected]?.capability.id;
    const next = await buildSnapshot({ ...options, allProjects: state.allProjects, includeSubagents: state.includeSubagents, window: state.window }, store);
    if (stopped) return;
    snapshot = next;
    const selectedIndex = before ? filterCapabilities(snapshot, state).findIndex((item) => item.capability.id === before) : -1;
    if (selectedIndex >= 0) state.selected = selectedIndex;
    ensureVisible();
    redraw();
  };
  const resetSelection = () => { state.selected = 0; state.listOffset = 0; state.detailOffset = 0; state.examplesOffset = 0; };
  const move = (index: number) => {
    const count = filterCapabilities(snapshot, state).length;
    const next = Math.max(0, Math.min(index, count - 1));
    if (next !== state.selected) state.detailOffset = 0;
    state.selected = next;
  };
  const onKeypress = (str: string, key: readline.Key) => enqueue(async () => {
    if (key.ctrl && key.name === "c") { cleanup(); return; }
    if (state.searching) {
      if (key.name === "escape") { state.searching = false; state.search = ""; resetSelection(); }
      else if (key.name === "return") state.searching = false;
      else if (key.name === "backspace") { state.search = state.search.slice(0, -1); resetSelection(); }
      else if (str.length === 1 && !key.ctrl && !key.meta) { state.search += str; resetSelection(); }
      redraw(); return;
    }
    if (state.help) {
      if (key.name === "escape" || str === "?" || key.name === "q") state.help = false;
      redraw(); return;
    }
    if (key.name === "q") { cleanup(); return; }
    if (str === "/") { state.searching = true; state.search = ""; redraw(); return; }
    if (str === "?") { state.help = true; redraw(); return; }
    if (key.name === "escape") {
      if (state.focus === "examples") {
        state.focus = state.examplesReturnFocus;
      } else if (state.narrowDetail) { state.narrowDetail = false; state.focus = "list"; state.detailOffset = 0; }
      else { state.search = ""; resetSelection(); }
      redraw(); return;
    }
    if (key.name === "tab") {
      state.category = state.category === "all" ? "skills" : state.category === "skills" ? "playbooks" : state.category === "playbooks" ? "principles" : "all";
      resetSelection(); redraw(); return;
    }
    if (!key.ctrl && key.name === "u") { state.hideObserved = !state.hideObserved; resetSelection(); redraw(); return; }
    if (key.name === "w") { state.window = windowCycle(state.window); await refresh(); return; }
    if (key.name === "s") { state.allProjects = !state.allProjects; await refresh(); return; }
    if (key.name === "a") { state.includeSubagents = !state.includeSubagents; await refresh(); return; }
    if (key.name === "r") { await refresh(); return; }
    const items = filterCapabilities(snapshot, state);
    if (key.name === "n") {
      const next = suggestion(snapshot);
      if (next) {
        state.category = "all"; state.hideObserved = false; state.search = "";
        state.selected = filterCapabilities(snapshot, state).findIndex((item) => item.capability.id === next.id);
        state.detailOffset = 0;
      }
    }
    const page = Math.max(1, (process.stdout.rows ?? 30) - 9);
    const detailActive = state.narrowDetail || state.focus === "detail";
    const examplesActive = state.focus === "examples";
    const scrollDetail = (delta: number) => {
      state.detailOffset = Math.max(0, Math.min(state.detailOffset + delta, detailScrollLimit(snapshot, state, process.stdout.columns ?? 120, process.stdout.rows ?? 30)));
    };
    const scrollExamples = (delta: number) => {
      state.examplesOffset = Math.max(0, Math.min(state.examplesOffset + delta, examplesScrollLimit(snapshot, state, process.stdout.columns ?? 120, process.stdout.rows ?? 30)));
    };
    if (key.name === "down" || key.name === "j") examplesActive ? scrollExamples(1) : move(state.selected + 1);
    if (key.name === "up" || key.name === "k") examplesActive ? scrollExamples(-1) : move(state.selected - 1);
    if (key.name === "home") examplesActive ? scrollExamples(-Infinity) : (detailActive ? scrollDetail(-Infinity) : move(0));
    if (key.name === "end") examplesActive ? scrollExamples(Infinity) : (detailActive ? scrollDetail(Infinity) : move(items.length - 1));
    if (key.name === "pagedown" || (key.ctrl && key.name === "d")) examplesActive ? scrollExamples(page) : (detailActive ? scrollDetail(page) : move(state.selected + page));
    if (key.name === "pageup" || (key.ctrl && key.name === "u")) examplesActive ? scrollExamples(-page) : (detailActive ? scrollDetail(-page) : move(state.selected - page));
    if (key.name === "left") { state.focus = "list"; state.narrowDetail = false; }
    if (key.name === "right") { state.focus = "detail"; if (!isSplitLayout(process.stdout.columns ?? 120)) state.narrowDetail = true; }
    if (key.name === "return") {
      if (state.focus !== "examples") {
        state.examplesReturnFocus = state.narrowDetail || state.focus === "detail" ? "detail" : "list";
        state.focus = "examples";
        state.examplesOffset = 0;
      }
    }
    const current = filterCapabilities(snapshot, state)[state.selected];
    if (key.name === "p" && current) { const invocation = current.capability.invocation.replace(/[\x00-\x1f\x7f-\x9f]/g, ""); cleanup(); process.stdout.write(`${invocation}\n`); return; }
    if (key.name === "c" && current) state.status = applyCopy(current.capability.invocation);
    ensureVisible(); redraw();
  });

  process.stdout.write("\u001b[?1049h\u001b[?25l\u001b[?7l");
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.resume();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.stdout.on("resize", redraw);
  process.stdin.on("keypress", onKeypress);
  interval = setInterval(() => enqueue(refresh), refreshMs);
  redraw();
  try {
    await finished;
  } finally {
    cleanup();
  }
}

export { parseArgs, buildSnapshot, HELP_TEXT };

async function main(): Promise<void> {
  let options: LearnOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "argument parsing failed"}\n\n`);
    printHelp(1);
  }

  if (options.help) {
    printHelp(0);
  }

  const store = new HistoryStore(options.dbPath);
  const snapshot = await buildSnapshot(options, store);

  if (options.json) {
    store.close();
    await new Promise<void>((resolveWrite, rejectWrite) => process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`, (error) => error ? rejectWrite(error) : resolveWrite()));
    return;
  }

  if (options.snapshot) {
    const envWidth = Number.parseInt(process.env.COLUMNS ?? "", 10);
    const envHeight = Number.parseInt(process.env.LINES ?? "", 10);
    const width = process.stdout.columns ?? (Number.isFinite(envWidth) && envWidth > 0 ? envWidth : 120);
    const height = process.stdout.rows ?? (Number.isFinite(envHeight) && envHeight > 0 ? envHeight : 30);
    const lines = renderSnapshotText(snapshot, width, height);
    store.close();
    await new Promise<void>((resolveWrite, rejectWrite) => process.stdout.write(`${lines.join("\n")}\n`, (error) => error ? rejectWrite(error) : resolveWrite()));
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    store.close();
    process.stderr.write("learn requires a TTY unless --json or --snapshot is used.\n\n");
    process.stdout.write(HELP_TEXT);
    process.exit(1);
  }

  await runTui(options, store, snapshot);
}

if (import.meta.main) {
  void main().catch((error: unknown) => {
    process.stderr.write(`learn: ${error instanceof Error ? error.message : "unexpected failure"}\n`);
    process.exitCode = 1;
  });
}
