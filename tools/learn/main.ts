import { resolve } from "node:path";
import { discoverCatalog } from "./catalog";
import { HistoryStore } from "./history";
import type {
  CapabilityId,
  CapabilityObservation,
  HistoryResult,
  LearnOptions,
  SnapshotResult,
  SortKey,
  WindowKind,
} from "./types";
import { createInitialState, filterCapabilities, renderSnapshotText } from "./view";

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
  --sort KEY             name|invokes|loads|reads|usage|last-used
  --ascending            sort ascending
  --descending           sort descending
  --help                 show this help

Keys:
  q/Ctrl-C exit, j/k or arrows navigate, / search, Esc back, Tab category,
  u not-observed filter, n suggested item, w window, s project/all, a subagents, r refresh,
  Enter recent examples, Enter again exact context, p print invocation and exit, c copy invocation,
  left/right focus list/detail, PgUp/PgDn/Home/End or ctrl-d/u scroll content.
  o cycle sort, v reverse, l last used newest, 1-6 select a sort column.
`;

const SORT_KEYS: readonly SortKey[] = ["name", "invokes", "loads", "reads", "usage", "last-used"];

function isSortKey(value: string): value is SortKey {
  return value === "name" || value === "invokes" || value === "loads" || value === "reads" || value === "usage" || value === "last-used";
}

function defaultOptions(): LearnOptions {
  return {
    cwd: process.cwd(),
    allProjects: false,
    includeSubagents: false,
    window: "30",
    json: false,
    snapshot: false,
    help: false,
    sortKey: "name",
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
    if (arg === "--sort") {
      const value = argv[++i];
      if (!value || !isSortKey(value)) throw new Error(`--sort must be one of: ${SORT_KEYS.join(", ")}`);
      out.sortKey = value;
      continue;
    }
    if (arg === "--ascending" || arg === "--descending") {
      out.sortDirection = arg === "--ascending" ? "asc" : "desc";
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

function selectedSort(options: LearnOptions): { sortKey: SortKey; sortDirection: "asc" | "desc" } {
  const sortKey = options.sortKey ?? "name";
  return {
    sortKey,
    sortDirection: options.sortDirection ?? (sortKey === "name" ? "asc" : "desc"),
  };
}

function observationsFromHistory(history: HistoryResult, capabilityIds: CapabilityId[]): CapabilityObservation[] {
  if (history.kind === "available") {
    return history.observations;
  }
  return capabilityIds.map((capabilityId) => ({
    capabilityId,
    evidence: { kind: "unknown", count: { invokes: 0, loads: 0, reads: 0 } },
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
      ...selectedSort(options),
    },
  };
}

function printHelp(exitCode = 0): never {
  process.stdout.write(HELP_TEXT);
  process.exit(exitCode);
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
    const state = createInitialState();
    const sort = selectedSort(options);
    state.sortKey = sort.sortKey;
    state.sortDirection = sort.sortDirection;
    const ordered = filterCapabilities(snapshot, state);
    const observationById = new Map(snapshot.observations.map((item) => [item.capabilityId, item]));
    const output = {
      ...snapshot,
      catalog: { ...snapshot.catalog, capabilities: ordered.map((item) => item.capability) },
      observations: ordered.flatMap((item) => {
        const observation = observationById.get(item.capability.id);
        return observation ? [observation] : [];
      }),
    };
    await new Promise<void>((resolveWrite, rejectWrite) => process.stdout.write(`${JSON.stringify(output, null, 2)}\n`, (error) => error ? rejectWrite(error) : resolveWrite()));
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

  const { runInteractive } = await import("./tui");
  await runInteractive(options, store, snapshot, buildSnapshot);
}

if (import.meta.main) {
  void main().catch((error: unknown) => {
    process.stderr.write(`learn: ${error instanceof Error ? error.message : "unexpected failure"}\n`);
    process.exitCode = 1;
  });
}
