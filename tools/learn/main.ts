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
import { renderSnapshotText } from "./view";

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
  q/Ctrl-C exit, j/k or arrows navigate, / search, Esc back, Tab category,
  u not-observed filter, n suggested item, w window, s project/all, a subagents, r refresh,
  Enter recent examples, Enter again exact context, p print invocation and exit, c copy invocation,
  left/right focus list/detail, PgUp/PgDn/Home/End or ctrl-d/u scroll content.
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

  const { runInteractive } = await import("./tui");
  await runInteractive(options, store, snapshot, buildSnapshot);
}

if (import.meta.main) {
  void main().catch((error: unknown) => {
    process.stderr.write(`learn: ${error instanceof Error ? error.message : "unexpected failure"}\n`);
    process.exitCode = 1;
  });
}
