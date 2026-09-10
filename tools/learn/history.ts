import { spawnSync } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { Database } from "bun:sqlite";
import type {
  AvailableHistoryResult,
  Capability,
  CapabilityEvidence,
  CapabilityId,
  CapabilityObservation,
  CatalogResult,
  HistoryResult,
  LearnOptions,
  RecentExample,
  UnavailableHistoryResult,
} from "./types";
import { toIso, WINDOW_DAYS } from "./types";

interface SessionRow {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string | null;
  directory: string;
  timeCreated: number;
  timeUpdated: number;
}

interface PartEvent {
  ts: number;
  kind: "skill-load" | "file-read";
  partId?: string;
  messageId?: string;
  skillName?: string;
  skillDir?: string;
  filePath?: string;
}

interface SessionEvents {
  events: PartEvent[];
  malformed: number;
}

interface SessionCacheEntry extends SessionEvents {
  timeUpdated: number;
  partCount: number;
  partMaxUpdated: number;
  validatedAt: number;
  lastUsed: number;
}

interface ScopeSessionsEntry {
  fetchedCutoff: number;
  dataVersion: number;
  rows: SessionRow[];
}

/** Per-refresh record of the database work that was actually performed. */
export interface RefreshStats {
  scopeResolutions: number;
  sessionQueries: number;
  signatureQueries: number;
  eventLoads: number;
  dataVersionChanged: boolean;
}

interface CanonicalMaps {
  skillBySlug: Map<string, Capability>;
  skillDirToSlug: Map<string, string>;
  readPathToCapability: Map<string, CapabilityId>;
  readPathSuffixes: Set<string>;
}

interface Tally {
  loads: number;
  reads: number;
  lastTs?: number;
  lastTie?: string;
  lastSessionId?: string;
  lastSessionParent?: boolean;
  examples: ExampleStamped[];
}

interface ExampleStamped {
  ts: number;
  tie: string;
  example: RecentExample;
}

type Scope =
  | { kind: "all" }
  | { kind: "project"; projectId: string }
  | { kind: "directory"; root: string };

interface DbInfo {
  path: string;
}

const EXPECTED_SESSION_COLUMNS = [
  "id",
  "project_id",
  "parent_id",
  "directory",
  "time_created",
  "time_updated",
] as const;
const EXPECTED_PART_COLUMNS = ["session_id", "time_created", "time_updated", "data"] as const;
const EXPECTED_PROJECT_COLUMNS = ["id", "worktree"] as const;

const DEGRADED_WARNING =
  "Some skill/read tool events could not be parsed; items without evidence are reported as unknown.";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function fallbackDbPath(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.trim()) {
    return resolve(xdg, "opencode", "opencode.db");
  }
  const home = process.env.HOME ?? "~";
  return resolve(home, ".local", "share", "opencode", "opencode.db");
}

export function discoverDbPath(userSpecified?: string): DbInfo {
  if (userSpecified) {
    return { path: resolve(userSpecified) };
  }
  const command = spawnSync("opencode", ["db", "path"], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (command.status === 0) {
    const out = (command.stdout ?? "").trim();
    if (out) {
      return { path: resolve(out) };
    }
  }
  return { path: fallbackDbPath() };
}

/** Milliseconds are the only unit OpenCode writes; never rescale small numbers. */
function parseMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return Math.floor(asNumber);
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function lastTwoSegments(path: string): string {
  const parent = basename(dirname(path));
  return `${parent}/${basename(path)}`;
}

async function tryRealpath(path: string, cache: Map<string, string>): Promise<string> {
  const known = cache.get(path);
  if (known !== undefined) {
    return known;
  }
  let value = path;
  try {
    value = await realpath(path);
  } catch {
    value = path;
  }
  cache.set(path, value);
  return value;
}

async function buildCanonicalMaps(
  catalog: CatalogResult,
  realpaths: Map<string, string>,
): Promise<CanonicalMaps> {
  const skillBySlug = new Map<string, Capability>();
  const skillDirToSlug = new Map<string, string>();
  const readPathToCapability = new Map<string, CapabilityId>();
  const readPathSuffixes = new Set<string>();
  for (const capability of catalog.capabilities) {
    if (capability.id.startsWith("skill:")) {
      const slug = capability.id.slice("skill:".length);
      skillBySlug.set(slug, capability);
      if (capability.sourceDir) {
        const dir = resolve(capability.sourceDir);
        skillDirToSlug.set(dir, slug);
        skillDirToSlug.set(await tryRealpath(dir, realpaths), slug);
      }
    }
    const sourcePath = resolve(capability.sourcePath);
    readPathToCapability.set(sourcePath, capability.id);
    readPathToCapability.set(await tryRealpath(sourcePath, realpaths), capability.id);
    readPathSuffixes.add(lastTwoSegments(sourcePath));
  }
  return { skillBySlug, skillDirToSlug, readPathToCapability, readPathSuffixes };
}

function ancestors(path: string): string[] {
  const list: string[] = [];
  let current = resolve(path);
  while (true) {
    list.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return list;
}

function isAncestorOf(parent: string, target: string): boolean {
  if (parent === "/") {
    return false;
  }
  if (target === parent) {
    return true;
  }
  return target.startsWith(`${parent}/`);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readColumns(db: Database, table: "session" | "part" | "project"): string[] {
  const rows = db
    .query<{ name: unknown }, []>(`select name from pragma_table_info('${table}')`)
    .all();
  return rows.map((row) => row.name).filter(isString);
}

function hasColumns(columns: string[], expected: readonly string[]): boolean {
  const set = new Set(columns);
  return expected.every((name) => set.has(name));
}

function nowMs(): number {
  return Date.now();
}

function cutoffMs(window: LearnOptions["window"]): number | undefined {
  const days = WINDOW_DAYS[window];
  if (!days) {
    return undefined;
  }
  return nowMs() - days * 24 * 60 * 60 * 1000;
}

const CACHE_IDLE_REFRESHES = 8;

function scopeKey(scope: Scope): string {
  if (scope.kind === "all") {
    return "all";
  }
  if (scope.kind === "project") {
    return `project:${scope.projectId}`;
  }
  return `directory:${scope.root}`;
}

export class HistoryStore {
  private cache = new Map<string, SessionCacheEntry>();
  private scopeSessionCache = new Map<string, ScopeSessionsEntry>();
  private resolvedScopes = new Map<string, Scope | undefined>();
  private resolvedScopesVersion = Number.NaN;
  private dbInfo: DbInfo;
  private db: Database | undefined;
  private generation = "";
  private lastDataVersion = Number.NaN;
  private refreshCounter = 0;
  private stats: RefreshStats | undefined;
  private sessionTitleColumn = false;
  private partIdColumn = false;
  private partMessageIdColumn = false;

  constructor(dbPath?: string) {
    this.dbInfo = discoverDbPath(dbPath);
  }

  getDbPath(): string {
    return this.dbInfo.path;
  }

  /** Database work performed by the most recent refresh. */
  getLastRefreshStats(): RefreshStats | undefined {
    return this.stats;
  }

  /**
   * Release the persistent read handle. The owner of a HistoryStore must call
   * this once it stops refreshing; refresh() reopens on demand afterwards.
   */
  close(): void {
    this.dispose();
  }

  private dispose(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // A already-closed or broken handle needs no further handling.
      }
      this.db = undefined;
    }
    this.cache.clear();
    this.scopeSessionCache.clear();
    this.resolvedScopes.clear();
    this.resolvedScopesVersion = Number.NaN;
    this.generation = "";
    this.lastDataVersion = Number.NaN;
    this.sessionTitleColumn = false;
    this.partIdColumn = false;
    this.partMessageIdColumn = false;
  }

  /**
   * Identity of the file behind `path`, so a replaced or recreated database is
   * never served from a handle pointing at the deleted inode.
   */
  private static async fileGeneration(path: string): Promise<string> {
    try {
      const info = await stat(path);
      return `${info.dev}:${info.ino}`;
    } catch {
      // Unreadable metadata: treat every refresh as a new database.
      return `unknown:${nowMs()}`;
    }
  }

  private async connect(path: string): Promise<Database | undefined> {
    const generation = await HistoryStore.fileGeneration(path);
    if (this.db && generation !== this.generation) {
      this.dispose();
    }
    if (!this.db) {
      try {
        const db = new Database(path, { readonly: true, create: false });
        db.exec("pragma query_only=1");
        this.db = db;
        this.generation = generation;
      } catch {
        this.dispose();
        return undefined;
      }
    }
    return this.db;
  }

  /**
   * Changes whenever any other connection commits to the database, which is
   * exactly the condition that invalidates every cache here. An unreadable
   * value yields NaN, which never compares equal and so forces a full reload.
   */
  private static dataVersion(db: Database): number {
    try {
      const row = db.query<Record<string, unknown>, []>("pragma data_version").get();
      const value = row?.["data_version"];
      return typeof value === "number" ? value : Number.NaN;
    } catch {
      return Number.NaN;
    }
  }

  private evictStaleCacheEntries(): void {
    for (const [id, entry] of this.cache) {
      if (this.refreshCounter - entry.lastUsed > CACHE_IDLE_REFRESHES) {
        this.cache.delete(id);
      }
    }
  }

  private selectSessions(db: Database, scope: Scope, cutoff: number): SessionRow[] {
    const columns = this.sessionTitleColumn
      ? "select id, project_id, parent_id, title as session_title, directory, time_created, time_updated from session"
      : "select id, project_id, parent_id, null as session_title, directory, time_created, time_updated from session";
    const raw =
      scope.kind === "project"
        ? db
            .query<Record<string, unknown>, [string, number]>(
              `${columns} where project_id = ? and time_updated >= ?`,
            )
            .all(scope.projectId, cutoff)
        : db
            .query<Record<string, unknown>, [number]>(`${columns} where time_updated >= ?`)
            .all(cutoff);

    const rows: SessionRow[] = [];
    for (const row of raw) {
      const id = row["id"];
      const projectId = row["project_id"];
      const directory = row["directory"];
      const timeUpdated = parseMillis(row["time_updated"]);
      if (!isString(id) || !isString(projectId) || !isString(directory) || timeUpdated === undefined) {
        continue;
      }
      const parentId = row["parent_id"];
      const title = row["session_title"];
      rows.push({
        id,
        projectId,
        title: isString(title) ? title : null,
        directory,
        parentId: isString(parentId) ? parentId : null,
        timeCreated: parseMillis(row["time_created"]) ?? timeUpdated,
        timeUpdated,
      });
    }
    return rows;
  }

  private async scopeSessions(
    db: Database,
    scope: Scope,
    cutoff: number,
    dataVersion: number,
    realpaths: Map<string, string>,
    stats: RefreshStats,
  ): Promise<SessionRow[]> {
    const key = scopeKey(scope);
    const cached = this.scopeSessionCache.get(key);
    if (cached && cached.dataVersion === dataVersion && cutoff >= cached.fetchedCutoff) {
      return cached.rows;
    }
    stats.sessionQueries += 1;
    const rows: SessionRow[] = [];
    for (const session of this.selectSessions(db, scope, cutoff)) {
      if (scope.kind === "directory") {
        const dir = await tryRealpath(resolve(session.directory), realpaths);
        if (!isAncestorOf(scope.root, dir)) {
          continue;
        }
      }
      rows.push(session);
    }
    this.scopeSessionCache.set(key, { fetchedCutoff: cutoff, dataVersion, rows });
    return rows;
  }

  /**
   * Session directories win over project worktrees, and a `/` worktree (the
   * global non-git project) never claims unrelated directories.
   */
  private async resolveScope(
    db: Database,
    requestedPath: string,
    realpaths: Map<string, string>,
  ): Promise<Scope | undefined> {
    const requested = resolve(requestedPath);
    const targets = new Set([requested, await tryRealpath(requested, realpaths)]);

    const projectRows = db
      .query<Record<string, unknown>, []>("select id, worktree from project")
      .all();
    const worktreeByProject = new Map<string, string>();
    for (const row of projectRows) {
      const id = row["id"];
      const worktree = row["worktree"];
      if (isString(id) && isString(worktree)) {
        worktreeByProject.set(id, resolve(worktree));
      }
    }

    const sessionDirs = db
      .query<Record<string, unknown>, []>("select distinct directory, project_id from session")
      .all();
    let bestDir: { directory: string; projectId: string } | undefined;
    for (const row of sessionDirs) {
      const directory = row["directory"];
      const projectId = row["project_id"];
      if (!isString(directory) || !isString(projectId)) {
        continue;
      }
      const canonicalDir = await tryRealpath(resolve(directory), realpaths);
      const matches = [...targets].some(
        (target) => isAncestorOf(resolve(directory), target) || isAncestorOf(canonicalDir, target),
      );
      if (!matches) {
        continue;
      }
      if (!bestDir || canonicalDir.length > bestDir.directory.length) {
        bestDir = { directory: canonicalDir, projectId };
      }
    }

    if (bestDir) {
      const worktree = worktreeByProject.get(bestDir.projectId);
      if (worktree && worktree !== "/") {
        return { kind: "project", projectId: bestDir.projectId };
      }
      return { kind: "directory", root: bestDir.directory };
    }

    const specific = [...worktreeByProject.entries()]
      .filter(([, worktree]) => worktree !== "/")
      .sort((a, b) => b[1].length - a[1].length);
    for (const [id, worktree] of specific) {
      const canonicalWorktree = await tryRealpath(worktree, realpaths);
      const matches = [...targets].some(
        (target) => isAncestorOf(worktree, target) || isAncestorOf(canonicalWorktree, target),
      );
      if (matches) {
        return { kind: "project", projectId: id };
      }
    }

    for (const candidate of ancestors(requested)) {
      const row = db
        .query<Record<string, unknown>, [string]>(
          "select project_id from session where directory = ? limit 1",
        )
        .get(candidate);
      const projectId = row?.["project_id"];
      if (isString(projectId)) {
        const worktree = worktreeByProject.get(projectId);
        if (worktree && worktree !== "/") {
          return { kind: "project", projectId };
        }
        return { kind: "directory", root: candidate };
      }
    }
    return undefined;
  }

  private partSignature(db: Database, sessionId: string): { count: number; maxUpdated: number } {
    const row = db
      .query<Record<string, unknown>, [string]>(
        "select count(*) as n, coalesce(max(time_updated), 0) as m from part where session_id = ?",
      )
      .get(sessionId);
    const count = row?.["n"];
    const maxUpdated = row?.["m"];
    return {
      count: typeof count === "number" ? count : Number.NaN,
      maxUpdated: typeof maxUpdated === "number" ? maxUpdated : Number.NaN,
    };
  }

  private sessionEvents(
    db: Database,
    session: SessionRow,
    dataVersion: number,
    stats: RefreshStats,
  ): SessionEvents {
    const cached = this.cache.get(session.id);
    if (
      cached &&
      cached.validatedAt === dataVersion &&
      cached.timeUpdated === session.timeUpdated &&
      !Number.isNaN(dataVersion)
    ) {
      cached.lastUsed = this.refreshCounter;
      return cached;
    }

    stats.signatureQueries += 1;
    const signature = this.partSignature(db, session.id);
    if (
      cached &&
      cached.timeUpdated === session.timeUpdated &&
      cached.partCount === signature.count &&
      cached.partMaxUpdated === signature.maxUpdated
    ) {
      cached.validatedAt = dataVersion;
      cached.lastUsed = this.refreshCounter;
      return cached;
    }

    stats.eventLoads += 1;
    const loaded = this.loadSessionEvents(db, session);
    this.cache.set(session.id, {
      timeUpdated: session.timeUpdated,
      partCount: signature.count,
      partMaxUpdated: signature.maxUpdated,
      validatedAt: dataVersion,
      lastUsed: this.refreshCounter,
      events: loaded.events,
      malformed: loaded.malformed,
    });
    return loaded;
  }

  private loadSessionEvents(db: Database, session: SessionRow): SessionEvents {
    const idField = this.partIdColumn ? "id as part_id," : "'' as part_id,";
    const messageIdField = this.partMessageIdColumn
      ? "message_id as message_id,"
      : "'' as message_id,";
    const rows = db
      .query<Record<string, unknown>, [string]>(
        `select ${idField} ${messageIdField} time_created, json_extract(data, '$.tool') as tool, json_extract(data, '$.state.status') as status, json_extract(data, '$.state.input.name') as skill_name, json_extract(data, '$.state.metadata.dir') as skill_dir, json_extract(data, '$.state.input.filePath') as file_path, json_extract(data, '$.state.time.start') as t_start, json_extract(data, '$.state.time.end') as t_end from part where session_id = ? and json_valid(data) and json_extract(data, '$.tool') in ('skill','read')`,
      )
      .all(session.id);

    const events: PartEvent[] = [];
    let malformed = 0;
    for (const row of rows) {
      const tool = row["tool"];
      const status = row["status"];
      if (!isString(tool)) {
        continue;
      }
      if (!isString(status)) {
        malformed += 1;
        continue;
      }
      if (status !== "completed") {
        continue;
      }
      const ts =
        parseMillis(row["t_end"]) ?? parseMillis(row["t_start"]) ?? parseMillis(row["time_created"]);
      if (ts === undefined) {
        malformed += 1;
        continue;
      }
      if (tool === "skill") {
        const name = row["skill_name"];
        if (!isString(name)) {
          malformed += 1;
          continue;
        }
        const event: PartEvent = { ts, kind: "skill-load", skillName: name };
        const partId = row["part_id"];
        if (isString(partId)) {
          event.partId = partId;
        }
        const messageId = row["message_id"];
        if (isString(messageId)) {
          event.messageId = messageId;
        }
        const dir = row["skill_dir"];
        if (isString(dir)) {
          event.skillDir = dir;
        } else if (dir !== null && dir !== undefined) {
          malformed += 1;
          continue;
        }
        events.push(event);
        continue;
      }
      if (tool === "read") {
        const filePath = row["file_path"];
        if (!isString(filePath)) {
          malformed += 1;
          continue;
        }
        const event: PartEvent = { ts, kind: "file-read", filePath };
        const partId = row["part_id"];
        if (isString(partId)) {
          event.partId = partId;
        }
        const messageId = row["message_id"];
        if (isString(messageId)) {
          event.messageId = messageId;
        }
        events.push(event);
      }
      // Any other tool shape is explicitly not evidence.
    }
    return { events, malformed };
  }

  private async matchSkillDir(
    canonical: CanonicalMaps,
    dir: string,
    expectedSlug: string,
    realpaths: Map<string, string>,
  ): Promise<boolean> {
    const direct = canonical.skillDirToSlug.get(dir);
    if (direct !== undefined) {
      return direct === expectedSlug;
    }
    if (basename(dir) !== expectedSlug) {
      return false;
    }
    const resolved = await tryRealpath(dir, realpaths);
    return canonical.skillDirToSlug.get(resolved) === expectedSlug;
  }

  private async matchReadPath(
    canonical: CanonicalMaps,
    path: string,
    realpaths: Map<string, string>,
  ): Promise<CapabilityId | undefined> {
    const direct = canonical.readPathToCapability.get(path);
    if (direct) {
      return direct;
    }
    if (!canonical.readPathSuffixes.has(lastTwoSegments(path))) {
      return undefined;
    }
    const resolved = await tryRealpath(path, realpaths);
    return canonical.readPathToCapability.get(resolved);
  }

  async refresh(catalog: CatalogResult, options: LearnOptions): Promise<HistoryResult> {
    const started = nowMs();
    const warnings: string[] = [];
    const dbPath = this.dbInfo.path;
    this.refreshCounter += 1;
    const stats: RefreshStats = {
      scopeResolutions: 0,
      sessionQueries: 0,
      signatureQueries: 0,
      eventLoads: 0,
      dataVersionChanged: false,
    };
    this.stats = stats;
    const unavailable = (reason: string): UnavailableHistoryResult => ({
      kind: "unavailable",
      reason,
      warnings: [...new Set(warnings)],
      readAt: toIso(nowMs()),
      durationMs: nowMs() - started,
    });

    if (!(await fileExists(dbPath))) {
      this.dispose();
      return unavailable("db-not-found");
    }

    const db = await this.connect(dbPath);
    if (!db) {
      return unavailable("db-open-failed");
    }

    try {
      const dataVersion = HistoryStore.dataVersion(db);
      stats.dataVersionChanged = this.lastDataVersion !== dataVersion;

      if (stats.dataVersionChanged) {
        const sessionColumns = readColumns(db, "session");
        const partColumns = readColumns(db, "part");
        const projectColumns = readColumns(db, "project");
        if (
          !hasColumns(sessionColumns, EXPECTED_SESSION_COLUMNS) ||
          !hasColumns(partColumns, EXPECTED_PART_COLUMNS) ||
          !hasColumns(projectColumns, EXPECTED_PROJECT_COLUMNS)
        ) {
          warnings.push("Database schema is missing columns this reader needs.");
          this.dispose();
          return unavailable("unsupported-schema");
        }
        this.sessionTitleColumn = sessionColumns.includes("title");
        this.partIdColumn = partColumns.includes("id");
        this.partMessageIdColumn = partColumns.includes("message_id");
        this.lastDataVersion = dataVersion;
      }

      const realpaths = new Map<string, string>();
      const cutoff = cutoffMs(options.window) ?? 0;

      if (this.resolvedScopesVersion !== dataVersion) {
        this.resolvedScopes.clear();
        this.resolvedScopesVersion = dataVersion;
      }

      let scope: Scope = { kind: "all" };
      if (!options.allProjects) {
        const scopePath = options.projectPath ? resolve(options.projectPath) : resolve(options.cwd);
        let resolved = this.resolvedScopes.get(scopePath);
        if (!this.resolvedScopes.has(scopePath)) {
          stats.scopeResolutions += 1;
          resolved = await this.resolveScope(db, scopePath, realpaths);
          this.resolvedScopes.set(scopePath, resolved);
        }
        if (!resolved) {
          return unavailable("scope-not-found");
        }
        scope = resolved;
      }

      const inScope = await this.scopeSessions(db, scope, cutoff, dataVersion, realpaths, stats);
      const sessions = inScope.filter((session) => session.timeUpdated >= cutoff);

      if (!options.includeSubagents) {
        warnings.push(
          "Child sessions excluded. Top-level CLI sessions may still include audit activity.",
        );
      }

      const canonical = await buildCanonicalMaps(catalog, realpaths);
      const tallies = new Map<CapabilityId, Tally>();
      for (const capability of catalog.capabilities) {
        tallies.set(capability.id, { loads: 0, reads: 0, examples: [] });
      }

      let sessionCount = 0;
      let oldest: number | undefined;
      let degraded = false;

      for (const session of sessions) {
        if (!options.includeSubagents && session.parentId) {
          continue;
        }
        sessionCount += 1;
        oldest = oldest === undefined ? session.timeCreated : Math.min(oldest, session.timeCreated);

        const loaded = this.sessionEvents(db, session, dataVersion, stats);
        if (loaded.malformed > 0) {
          degraded = true;
        }

        for (const event of loaded.events) {
          if (event.ts < cutoff) {
            continue;
          }
          const record = (id: CapabilityId, field: "loads" | "reads"): void => {
            const tally = tallies.get(id);
            if (!tally) {
              return;
            }
            tally[field] += 1;
            const tie = event.partId ? `part:${event.partId}` : `session:${session.id}:${event.kind}`;
            if (
              tally.lastTs === undefined ||
              event.ts > tally.lastTs ||
              (event.ts === tally.lastTs && tie > (tally.lastTie ?? ""))
            ) {
              tally.lastTs = event.ts;
              tally.lastTie = tie;
              tally.lastSessionId = session.id;
              tally.lastSessionParent = Boolean(session.parentId);
            }
          };

          const appendExample = (id: CapabilityId, kind: "load" | "read", action: string): void => {
            const tally = tallies.get(id);
            if (!tally) {
              return;
            }
            const tie = event.partId ? `part:${event.partId}` : `session:${session.id}:${event.kind}`;
            const example: RecentExample = {
              kind,
              at: toIso(event.ts),
              sessionId: session.id,
              sessionTitle: session.title ?? session.id,
              directory: session.directory,
              isSubagent: Boolean(session.parentId),
              action,
            };
            if (event.partId) {
              example.partId = event.partId;
            }
            if (event.messageId) {
              example.messageId = event.messageId;
            }
            tally.examples.push({
              ts: event.ts,
              tie,
              example,
            });
          };

          if (event.kind === "skill-load" && event.skillName) {
            const capability = canonical.skillBySlug.get(event.skillName);
            if (!capability) {
              continue;
            }
            if (!event.skillDir || event.skillDir === ".") {
              warnings.push(`name-only attribution: ${event.skillName}`);
            } else {
              const dir = isAbsolute(event.skillDir)
                ? resolve(event.skillDir)
                : resolve(session.directory, event.skillDir);
              if (!(await this.matchSkillDir(canonical, dir, event.skillName, realpaths))) {
                continue;
              }
            }
            record(capability.id, "loads");
            appendExample(capability.id, "load", `skill(${event.skillName})`);
          }

          if (event.kind === "file-read" && event.filePath) {
            const path = isAbsolute(event.filePath)
              ? resolve(event.filePath)
              : resolve(session.directory, event.filePath);
            const capabilityId = await this.matchReadPath(canonical, path, realpaths);
            if (!capabilityId) {
              continue;
            }
            record(capabilityId, "reads");
            appendExample(capabilityId, "read", `read(${event.filePath})`);
          }
        }
      }

      if (degraded) {
        warnings.push(DEGRADED_WARNING);
      }

      const observations: CapabilityObservation[] = [...tallies.entries()].map(
        ([capabilityId, tally]) => {
          const count = { loads: tally.loads, reads: tally.reads };
          let evidence: CapabilityEvidence;
          if (tally.lastTs !== undefined && tally.lastSessionId) {
            const recentExamples = tally.examples
              .sort((a, b) => (b.ts - a.ts) || b.tie.localeCompare(a.tie))
              .slice(0, 5)
              .map((item) => item.example);
            evidence = {
              kind: "observed",
              count,
              lastSeenAt: toIso(tally.lastTs),
              lastSessionId: tally.lastSessionId,
              lastSessionParent: Boolean(tally.lastSessionParent),
              recentExamples,
            };
          } else if (degraded) {
            evidence = { kind: "unknown", count };
          } else {
            evidence = { kind: "not-observed", count };
          }
          return { capabilityId, evidence };
        },
      );

      const result: AvailableHistoryResult = {
        kind: "available",
        observations,
        sessionCount,
        readAt: toIso(nowMs()),
        durationMs: nowMs() - started,
        warnings: [...new Set(warnings)],
      };
      if (oldest) {
        result.oldestSessionAt = toIso(oldest);
      }
      this.evictStaleCacheEntries();
      return result;
    } catch {
      this.dispose();
      warnings.push("Reading the OpenCode database failed; evidence is unavailable this refresh.");
      return unavailable("query-failed");
    }
  }
}
