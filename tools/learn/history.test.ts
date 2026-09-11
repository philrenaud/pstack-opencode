import { mkdirSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "bun:test";
import { discoverCatalog } from "./catalog";
import { HistoryStore } from "./history";
import {
  createDb,
  insertPart,
  insertMessage,
  insertProject,
  insertSession,
  makeCatalogFixture,
  makeTempDir,
  readPart,
  sha256File,
  skillPart,
  write,
} from "./test-helpers";

const DAY = 24 * 60 * 60 * 1000;

test("counts only anchored user invocations and keeps them separate from loads", async () => {
  const root = makeTempDir("learn-history-invokes-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, { id: "s1", projectId: "p1", directory: projectPath, created: now - DAY, updated: now });
  const addText = (id: string, text: string, synthetic: boolean | null = null, role: "user" | "assistant" = "user") => {
    insertMessage(db, { id: `msg-${id}`, sessionId: "s1", created: now - 100, role });
    insertPart(db, { id, sessionId: "s1", created: now - 100, updated: now - 100, data: { type: "text", text, synthetic } });
  };
  const howDir = join(root, "skills/how");
  addText("expanded", `# How\n\nInstructions.\n\nBase directory for this skill: ${howDir}\nRelative paths in this skill are relative.\n\nExplain this.`);
  addText("raw", "/how explain this");
  addText("quoted", "Please quote /how explain this");
  addText("foreign", "# How\n\nBase directory for this skill: /tmp/skills/how\n\nTask");
  addText("synthetic", `# How\n\nBase directory for this skill: ${howDir}\n\nTask`, true);
  addText("assistant", "/how no", null, "assistant");
  insertPart(db, { id: "load", sessionId: "s1", created: now - 50, updated: now - 50, data: skillPart("how", "completed", howDir, now - 40) });
  db.close();

  const result = await new HistoryStore(dbPath).refresh(await discoverCatalog(root), opts(dbPath, projectPath));
  const how = observation(result, "skill:how");
  expect(how?.evidence.kind).toBe("observed");
  if (how?.evidence.kind === "observed") {
    expect(how.evidence.count).toEqual({ invokes: 2, loads: 1, reads: 0 });
    expect(how.evidence.recentExamples?.filter((item) => item.kind === "invoke").map((item) => item.action).sort()).toEqual(["/how", "invoke(how)"]);
    expect(how.evidence.recentExamples?.find((item) => item.action === "invoke(how)")?.messageId).toBe("msg-expanded");
  }
});

test("invocations obey project, child-session, and time filters", async () => {
  const root = makeTempDir("learn-history-invoke-scope-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const here = join(root, "here");
  const there = join(root, "there");
  insertProject(db, "p1", here);
  insertProject(db, "p2", there);
  insertSession(db, { id: "parent", projectId: "p1", directory: here, created: now - 40 * DAY, updated: now });
  insertSession(db, { id: "child", projectId: "p1", parentId: "parent", directory: here, created: now - DAY, updated: now });
  insertSession(db, { id: "other", projectId: "p2", directory: there, created: now - DAY, updated: now });
  const add = (id: string, sessionId: string, at: number) => {
    insertMessage(db, { id: `msg-${id}`, sessionId, created: at, role: "user" });
    insertPart(db, { id, sessionId, created: at, updated: at, data: { type: "text", text: "/how task" } });
  };
  add("old", "parent", now - 35 * DAY);
  add("child", "child", now - 200);
  add("other", "other", now - 100);
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const base = await store.refresh(catalog, opts(dbPath, here));
  expect(observation(base, "skill:how")?.evidence.kind).toBe("not-observed");
  const children = await store.refresh(catalog, { ...opts(dbPath, here), includeSubagents: true });
  const how = observation(children, "skill:how");
  expect(how?.evidence.kind === "observed" && how.evidence.count.invokes).toBe(1);
  expect(how?.evidence.kind === "observed" && how.evidence.recentExamples?.[0]?.sessionId).toBe("child");
  store.close();
});

function opts(dbPath: string, cwd: string) {
  return {
    cwd,
    allProjects: false,
    includeSubagents: false,
    window: "30" as const,
    dbPath,
    json: false,
    snapshot: false,
    help: false,
  };
}

function observation(result: Awaited<ReturnType<HistoryStore["refresh"]>>, id: string) {
  if (result.kind !== "available") {
    return undefined;
  }
  return result.observations.find((item) => item.capabilityId === id);
}

test("counts successful skill loads and consultations separately", async () => {
  const root = makeTempDir("learn-history-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();

  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "ok-load",
    sessionId: "s1",
    created: now - 1_000,
    updated: now - 1_000,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 900),
  });
  insertPart(db, {
    id: "bad-load",
    sessionId: "s1",
    created: now - 800,
    updated: now - 800,
    data: skillPart("how", "error", join(root, "skills/how"), now - 700),
  });
  insertPart(db, {
    id: "read-skill",
    sessionId: "s1",
    created: now - 600,
    updated: now - 600,
    data: readPart(join(root, "skills/how/SKILL.md"), "completed", now - 500),
  });
  insertPart(db, {
    id: "prose",
    sessionId: "s1",
    created: now - 400,
    updated: now - 400,
    data: { type: "message", text: "use how skill" },
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, projectPath));
  expect(result.kind).toBe("available");
  const how = observation(result, "skill:how");
  expect(how?.evidence.kind).toBe("observed");
  if (how?.evidence.kind === "observed") {
    expect(how.evidence.count.loads).toBe(1);
    expect(how.evidence.count.reads).toBe(1);
  }
});

test("explicit foreign metadata and upstream clone paths do not count", async () => {
  const root = makeTempDir("learn-history-foreign-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();

  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "foreign-load",
    sessionId: "s1",
    created: now - 200,
    updated: now - 200,
    data: skillPart("how", "completed", "/tmp/clone/skills/how", now - 100),
  });
  insertPart(db, {
    id: "upstream-read",
    sessionId: "s1",
    created: now - 90,
    updated: now - 90,
    data: readPart("/tmp/upstream/skills/how/SKILL.md", "completed", now - 80),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, projectPath));
  const how = observation(result, "skill:how");
  expect(how?.evidence.kind).toBe("not-observed");
});

test("name-only attribution counts with warning", async () => {
  const root = makeTempDir("learn-history-name-only-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "name-only",
    sessionId: "s1",
    created: now - 300,
    updated: now - 300,
    data: skillPart("how", "completed", undefined, now - 250),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, projectPath));
  expect(result.kind).toBe("available");
  const how = observation(result, "skill:how");
  expect(how?.evidence.kind).toBe("observed");
  expect(result.kind === "available" && result.warnings.some((w) => w.includes("name-only attribution"))).toBeTrue();
});

test("child sessions excluded by default and included when toggled", async () => {
  const root = makeTempDir("learn-history-child-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "parent",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertSession(db, {
    id: "child",
    projectId: "p1",
    parentId: "parent",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "child-load",
    sessionId: "child",
    created: now - 100,
    updated: now - 100,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 90),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const noChildren = await store.refresh(catalog, opts(dbPath, projectPath));
  const howA = observation(noChildren, "skill:how");
  expect(howA?.evidence.kind).toBe("not-observed");

  const withChildren = await store.refresh(catalog, {
    ...opts(dbPath, projectPath),
    includeSubagents: true,
  });
  const howB = observation(withChildren, "skill:how");
  expect(howB?.evidence.kind).toBe("observed");
});

test("cross-project scope by explicit project path", async () => {
  const root = makeTempDir("learn-history-scope-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const p1 = join(root, "proj-1");
  const p2 = join(root, "proj-2");
  insertProject(db, "p1", p1);
  insertProject(db, "p2", p2);
  insertSession(db, { id: "s1", projectId: "p1", directory: p1, created: now - DAY, updated: now });
  insertSession(db, { id: "s2", projectId: "p2", directory: p2, created: now - DAY, updated: now });
  insertPart(db, {
    id: "p1-load",
    sessionId: "s1",
    created: now - 110,
    updated: now - 110,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 100),
  });
  insertPart(db, {
    id: "p2-load",
    sessionId: "s2",
    created: now - 110,
    updated: now - 110,
    data: skillPart("architect", "completed", join(root, "skills/architect"), now - 100),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const scoped = await store.refresh(catalog, {
    ...opts(dbPath, p2),
    projectPath: p2,
  });
  expect(observation(scoped, "skill:architect")?.evidence.kind).toBe("observed");
  expect(observation(scoped, "skill:how")?.evidence.kind).toBe("not-observed");
});

test("recent event in recently updated session counts while old event is excluded", async () => {
  const root = makeTempDir("learn-history-window-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - 120 * DAY,
    updated: now,
  });
  insertPart(db, {
    id: "old",
    sessionId: "s1",
    created: now - 60 * DAY,
    updated: now - 60 * DAY,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 60 * DAY),
  });
  insertPart(db, {
    id: "recent",
    sessionId: "s1",
    created: now - DAY,
    updated: now - DAY,
    data: skillPart("how", "completed", join(root, "skills/how"), now - DAY),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, projectPath));
  const how = observation(result, "skill:how");
  expect(how?.evidence.kind).toBe("observed");
  if (how?.evidence.kind === "observed") {
    expect(how.evidence.count.loads).toBe(1);
  }
});

test("missing db and unsupported schema return unavailable", async () => {
  const root = makeTempDir("learn-history-unavailable-");
  makeCatalogFixture(root);
  const missingDb = join(root, "missing.db");
  const catalog = await discoverCatalog(root);
  const missingStore = new HistoryStore(missingDb);
  const missing = await missingStore.refresh(catalog, opts(missingDb, join(root, "project-a")));
  expect(missing.kind).toBe("unavailable");
  if (missing.kind === "unavailable") {
    expect(missing.reason).toBe("db-not-found");
  }

  const badDb = join(root, "bad.db");
  const db = new (await import("bun:sqlite")).Database(badDb, { create: true });
  db.exec("create table nope(id text primary key);");
  db.close();
  const badStore = new HistoryStore(badDb);
  const unsupported = await badStore.refresh(catalog, opts(badDb, join(root, "project-a")));
  expect(unsupported.kind).toBe("unavailable");
  if (unsupported.kind === "unavailable") {
    expect(unsupported.reason).toBe("unsupported-schema");
  }
});

test("refresh after second writer updates counts without double counting", async () => {
  const root = makeTempDir("learn-history-refresh-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "first",
    sessionId: "s1",
    created: now - 500,
    updated: now - 500,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 490),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const first = await store.refresh(catalog, opts(dbPath, projectPath));
  expect(observation(first, "skill:how")?.evidence.kind).toBe("observed");

  const db2 = new (await import("bun:sqlite")).Database(dbPath);
  insertPart(db2, {
    id: "second",
    sessionId: "s1",
    created: now - 100,
    updated: now - 100,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 90),
  });
  db2.query("update session set time_updated = ? where id = 's1'").run(now + 1000);
  db2.close();

  const second = await store.refresh(catalog, opts(dbPath, projectPath));
  const how = observation(second, "skill:how");
  expect(how?.evidence.kind).toBe("observed");
  if (how?.evidence.kind === "observed") {
    expect(how.evidence.count.loads).toBe(2);
  }
});

test("readonly refresh leaves db hash unchanged", async () => {
  const root = makeTempDir("learn-history-readonly-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  db.close();

  const before = sha256File(dbPath);
  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  await store.refresh(catalog, opts(dbPath, projectPath));
  const after = sha256File(dbPath);
  expect(after).toBe(before);
});

test("last seen reflects the newest event regardless of session and row order", async () => {
  const root = makeTempDir("learn-history-order-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  const recent = now - 60_000;
  const older = now - 10 * DAY;

  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s-recent",
    projectId: "p1",
    directory: projectPath,
    created: now - 11 * DAY,
    updated: now,
  });
  insertSession(db, {
    id: "s-older",
    projectId: "p1",
    directory: projectPath,
    created: now - 12 * DAY,
    updated: now - 9 * DAY,
  });
  insertPart(db, {
    id: "recent-load",
    sessionId: "s-recent",
    created: recent,
    updated: recent,
    data: skillPart("how", "completed", join(root, "skills/how"), recent),
  });
  insertPart(db, {
    id: "backdated-load",
    sessionId: "s-recent",
    created: now - 5 * DAY,
    updated: now - 5 * DAY,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 5 * DAY),
  });
  insertPart(db, {
    id: "older-load",
    sessionId: "s-older",
    created: older,
    updated: older,
    data: skillPart("how", "completed", join(root, "skills/how"), older),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, projectPath));
  const how = observation(result, "skill:how");
  expect(how?.evidence.kind).toBe("observed");
  if (how?.evidence.kind === "observed") {
    expect(how.evidence.count.loads).toBe(3);
    expect(how.evidence.lastSeenAt).toBe(new Date(recent).toISOString());
    expect(how.evidence.lastSessionId).toBe("s-recent");
  }
});

test("malformed skill events report unknown rather than not-observed", async () => {
  const root = makeTempDir("learn-history-malformed-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "broken",
    sessionId: "s1",
    created: now - 500,
    updated: now - 500,
    data: {
      type: "tool",
      tool: "skill",
      state: { status: "completed", input: { name: 4711 }, time: { end: now - 400 } },
    },
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, projectPath));
  expect(result.kind).toBe("available");
  expect(observation(result, "skill:how")?.evidence.kind).toBe("unknown");
  expect(
    result.kind === "available" && result.warnings.some((w) => w.includes("could not be parsed")),
  ).toBeTrue();
});

test("unknown future tool shapes are ignored without degrading evidence", async () => {
  const root = makeTempDir("learn-history-future-tool-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "future",
    sessionId: "s1",
    created: now - 500,
    updated: now - 500,
    data: {
      type: "tool",
      tool: "skill-graph",
      state: { status: "completed", input: { name: "how" }, time: { end: now - 400 } },
    },
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, projectPath));
  expect(observation(result, "skill:how")?.evidence.kind).toBe("not-observed");
});

test("global project worktree does not widen scope to unrelated directories", async () => {
  const root = makeTempDir("learn-history-global-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const here = join(root, "project-a");
  const elsewhere = join(root, "somewhere-else");

  insertProject(db, "global", "/");
  insertSession(db, { id: "s-here", projectId: "global", directory: here, created: now - DAY, updated: now });
  insertSession(db, {
    id: "s-elsewhere",
    projectId: "global",
    directory: elsewhere,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "here-load",
    sessionId: "s-here",
    created: now - 300,
    updated: now - 300,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 200),
  });
  insertPart(db, {
    id: "elsewhere-load",
    sessionId: "s-elsewhere",
    created: now - 300,
    updated: now - 300,
    data: skillPart("architect", "completed", join(root, "skills/architect"), now - 200),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const scoped = await store.refresh(catalog, opts(dbPath, here));
  expect(scoped.kind).toBe("available");
  expect(observation(scoped, "skill:how")?.evidence.kind).toBe("observed");
  expect(observation(scoped, "skill:architect")?.evidence.kind).toBe("not-observed");
  if (scoped.kind === "available") {
    expect(scoped.sessionCount).toBe(1);
  }

  const unknownScope = await new HistoryStore(dbPath).refresh(
    catalog,
    opts(dbPath, join(root, "never-visited")),
  );
  expect(unknownScope.kind).toBe("unavailable");
  if (unknownScope.kind === "unavailable") {
    expect(unknownScope.reason).toBe("scope-not-found");
  }
});

test("new part is picked up even when session.time_updated does not change", async () => {
  const root = makeTempDir("learn-history-stale-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "first",
    sessionId: "s1",
    created: now - 500,
    updated: now - 500,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 490),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const first = await store.refresh(catalog, opts(dbPath, projectPath));
  const before = observation(first, "skill:how");
  expect(before?.evidence.kind === "observed" && before.evidence.count.loads).toBe(1);

  const db2 = new (await import("bun:sqlite")).Database(dbPath);
  insertPart(db2, {
    id: "second",
    sessionId: "s1",
    created: now - 100,
    updated: now - 100,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 90),
  });
  db2.close();

  const second = await store.refresh(catalog, opts(dbPath, projectPath));
  const how = observation(second, "skill:how");
  expect(how?.evidence.kind === "observed" && how.evidence.count.loads).toBe(2);
});

test("symlinked catalog path outside the root counts, upstream copy does not", async () => {
  const root = makeTempDir("learn-history-symlink-");
  makeCatalogFixture(root);
  const installedRoot = join(root, "installed");
  mkdirSync(installedRoot, { recursive: true });
  const linkedSkillDir = join(installedRoot, "how");
  symlinkSync(join(root, "skills/how"), linkedSkillDir);

  const upstream = join(root, "upstream/skills/how");
  write(join(upstream, "SKILL.md"), "# copy\n");

  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "linked-load",
    sessionId: "s1",
    created: now - 400,
    updated: now - 400,
    data: skillPart("how", "completed", linkedSkillDir, now - 390),
  });
  insertPart(db, {
    id: "linked-read",
    sessionId: "s1",
    created: now - 380,
    updated: now - 380,
    data: readPart(join(linkedSkillDir, "SKILL.md"), "completed", now - 370),
  });
  insertPart(db, {
    id: "upstream-read",
    sessionId: "s1",
    created: now - 360,
    updated: now - 360,
    data: readPart(join(upstream, "SKILL.md"), "completed", now - 350),
  });
  insertPart(db, {
    id: "upstream-load",
    sessionId: "s1",
    created: now - 340,
    updated: now - 340,
    data: skillPart("how", "completed", upstream, now - 330),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, projectPath));
  const how = observation(result, "skill:how");
  expect(how?.evidence.kind).toBe("observed");
  if (how?.evidence.kind === "observed") {
    expect(how.evidence.count.loads).toBe(1);
    expect(how.evidence.count.reads).toBe(1);
  }
});

test("numeric event times are read as milliseconds, not seconds", async () => {
  const root = makeTempDir("learn-history-millis-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "seconds-shaped",
    sessionId: "s1",
    created: now - 100,
    updated: now - 100,
    data: skillPart("how", "completed", join(root, "skills/how"), Math.floor(now / 1000)),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, projectPath));
  expect(observation(result, "skill:how")?.evidence.kind).toBe("not-observed");
});

test("a failing schema query yields unavailable instead of escaping refresh", async () => {
  const root = makeTempDir("learn-history-query-failed-");
  makeCatalogFixture(root);
  const dbPath = join(root, "broken.db");
  const db = new (await import("bun:sqlite")).Database(dbPath, { create: true });
  db.exec(`
create table project (id text primary key, worktree text not null);
create table session (
  id text primary key,
  project_id text not null,
  parent_id text,
  directory text not null,
  time_created integer not null,
  time_updated integer not null
);
create table part_backing (
  session_id text not null,
  time_created integer not null,
  time_updated integer not null,
  data text not null
);
create view part as select session_id, time_created, time_updated, data from part_backing;
drop table part_backing;
`);
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, join(root, "project-a")));
  expect(result.kind).toBe("unavailable");
  if (result.kind === "unavailable") {
    expect(result.reason).toBe("query-failed");
    expect(result.warnings.length).toBeGreaterThan(0);
  }
});

test("an idle refresh reads no sessions, signatures, or events", async () => {
  const root = makeTempDir("learn-history-idle-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "load",
    sessionId: "s1",
    created: now - 500,
    updated: now - 500,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 490),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const first = await store.refresh(catalog, opts(dbPath, projectPath));
  const firstStats = store.getLastRefreshStats();
  expect(firstStats?.eventLoads).toBe(1);
  expect(firstStats?.sessionQueries).toBe(1);
  expect(firstStats?.scopeResolutions).toBe(1);

  const second = await store.refresh(catalog, opts(dbPath, projectPath));
  const stats = store.getLastRefreshStats();
  expect(stats?.dataVersionChanged).toBeFalse();
  expect(stats?.scopeResolutions).toBe(0);
  expect(stats?.sessionQueries).toBe(0);
  expect(stats?.signatureQueries).toBe(0);
  expect(stats?.eventLoads).toBe(0);
  const firstHow = observation(first, "skill:how");
  expect(firstHow).toBeDefined();
  expect(observation(second, "skill:how")).toEqual(firstHow!);
  store.close();
});

test("an external write re-reads only what changed", async () => {
  const root = makeTempDir("learn-history-external-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, { id: "s1", projectId: "p1", directory: projectPath, created: now - DAY, updated: now });
  insertSession(db, { id: "s2", projectId: "p1", directory: projectPath, created: now - DAY, updated: now });
  insertPart(db, {
    id: "a",
    sessionId: "s1",
    created: now - 500,
    updated: now - 500,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 490),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  await store.refresh(catalog, opts(dbPath, projectPath));

  const writer = new (await import("bun:sqlite")).Database(dbPath);
  insertPart(writer, {
    id: "b",
    sessionId: "s2",
    created: now - 100,
    updated: now - 100,
    data: skillPart("architect", "completed", join(root, "skills/architect"), now - 90),
  });
  writer.close();

  const after = await store.refresh(catalog, opts(dbPath, projectPath));
  const stats = store.getLastRefreshStats();
  expect(stats?.dataVersionChanged).toBeTrue();
  expect(stats?.signatureQueries).toBe(2);
  expect(stats?.eventLoads).toBe(1);
  expect(observation(after, "skill:architect")?.evidence.kind).toBe("observed");
  store.close();
});

test("the rolling cutoff narrows cached results without touching the database", async () => {
  const root = makeTempDir("learn-history-rolling-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - 40 * DAY,
    updated: now,
  });
  insertPart(db, {
    id: "old",
    sessionId: "s1",
    created: now - 20 * DAY,
    updated: now - 20 * DAY,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 20 * DAY),
  });
  insertPart(db, {
    id: "recent",
    sessionId: "s1",
    created: now - DAY,
    updated: now - DAY,
    data: skillPart("how", "completed", join(root, "skills/how"), now - DAY),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const wide = await store.refresh(catalog, opts(dbPath, projectPath));
  const wideHow = observation(wide, "skill:how");
  expect(wideHow?.evidence.kind === "observed" && wideHow.evidence.count.loads).toBe(2);

  const narrow = await store.refresh(catalog, {
    ...opts(dbPath, projectPath),
    window: "7" as const,
  });
  const stats = store.getLastRefreshStats();
  expect(stats?.signatureQueries).toBe(0);
  expect(stats?.eventLoads).toBe(0);
  const narrowHow = observation(narrow, "skill:how");
  expect(narrowHow?.evidence.kind === "observed" && narrowHow.evidence.count.loads).toBe(1);
  store.close();
});

test("catalog changes are re-attributed against cached events", async () => {
  const root = makeTempDir("learn-history-recatalog-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "teach-load",
    sessionId: "s1",
    created: now - 500,
    updated: now - 500,
    data: skillPart("teach", "completed", join(root, "skills/teach"), now - 490),
  });
  db.close();

  const store = new HistoryStore(dbPath);
  const before = await store.refresh(await discoverCatalog(root), opts(dbPath, projectPath));
  expect(observation(before, "skill:teach")).toBeUndefined();

  write(join(root, "skills/teach/SKILL.md"), "---\nname: teach\ndescription: Explain plainly.\n---\n\n# Teach\n");
  const after = await store.refresh(await discoverCatalog(root), opts(dbPath, projectPath));
  const stats = store.getLastRefreshStats();
  expect(stats?.eventLoads).toBe(0);
  expect(observation(after, "skill:teach")?.evidence.kind).toBe("observed");
  store.close();
});

test("a replaced database file is picked up on the next refresh", async () => {
  const root = makeTempDir("learn-history-replaced-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const now = Date.now();
  const projectPath = join(root, "project-a");

  const first = createDb(dbPath);
  insertProject(first, "p1", projectPath);
  insertSession(first, { id: "s1", projectId: "p1", directory: projectPath, created: now - DAY, updated: now });
  insertPart(first, {
    id: "how-load",
    sessionId: "s1",
    created: now - 500,
    updated: now - 500,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 490),
  });
  first.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const original = await store.refresh(catalog, opts(dbPath, projectPath));
  expect(observation(original, "skill:how")?.evidence.kind).toBe("observed");

  const replacementPath = join(root, "replacement.db");
  const replacement = createDb(replacementPath);
  insertProject(replacement, "p1", projectPath);
  insertSession(replacement, { id: "s9", projectId: "p1", directory: projectPath, created: now - DAY, updated: now });
  insertPart(replacement, {
    id: "architect-load",
    sessionId: "s9",
    created: now - 300,
    updated: now - 300,
    data: skillPart("architect", "completed", join(root, "skills/architect"), now - 290),
  });
  replacement.close();
  renameSync(replacementPath, dbPath);

  const swapped = await store.refresh(catalog, opts(dbPath, projectPath));
  expect(observation(swapped, "skill:architect")?.evidence.kind).toBe("observed");
  expect(observation(swapped, "skill:how")?.evidence.kind).toBe("not-observed");
  store.close();
});

test("close releases the handle and refresh reopens on demand", async () => {
  const root = makeTempDir("learn-history-close-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "load",
    sessionId: "s1",
    created: now - 500,
    updated: now - 500,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 490),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  await store.refresh(catalog, opts(dbPath, projectPath));
  store.close();
  store.close();

  const reopened = await store.refresh(catalog, opts(dbPath, projectPath));
  expect(observation(reopened, "skill:how")?.evidence.kind).toBe("observed");
  expect(store.getLastRefreshStats()?.eventLoads).toBe(1);
  store.close();
});

test("observed evidence includes newest recent examples capped to five", async () => {
  const root = makeTempDir("learn-history-examples-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s-new",
    title: "Newest Session",
    projectId: "p1",
    directory: projectPath,
    created: now - 4 * DAY,
    updated: now,
  });
  insertSession(db, {
    id: "s-old",
    title: "Older Session",
    projectId: "p1",
    directory: projectPath,
    created: now - 10 * DAY,
    updated: now - 8 * DAY,
  });
  insertPart(db, {
    id: "e1",
    sessionId: "s-old",
    created: now - 7 * DAY,
    updated: now - 7 * DAY,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 7 * DAY),
  });
  insertPart(db, {
    id: "e2",
    sessionId: "s-new",
    created: now - 6 * DAY,
    updated: now - 6 * DAY,
    data: readPart(join(root, "skills/how/SKILL.md"), "completed", now - 6 * DAY),
  });
  insertPart(db, {
    id: "e3",
    sessionId: "s-new",
    created: now - 5 * DAY,
    updated: now - 5 * DAY,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 5 * DAY),
  });
  insertPart(db, {
    id: "e4",
    sessionId: "s-old",
    created: now - 4 * DAY,
    updated: now - 4 * DAY,
    data: readPart(join(root, "skills/how/SKILL.md"), "completed", now - 4 * DAY),
  });
  insertPart(db, {
    id: "e5",
    sessionId: "s-new",
    created: now - 3 * DAY,
    updated: now - 3 * DAY,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 3 * DAY),
  });
  insertPart(db, {
    id: "e6",
    sessionId: "s-new",
    created: now - 2 * DAY,
    updated: now - 2 * DAY,
    data: readPart(join(root, "skills/how/SKILL.md"), "completed", now - 2 * DAY),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, projectPath));
  const how = observation(result, "skill:how");
  expect(how?.evidence.kind).toBe("observed");
  if (how?.evidence.kind === "observed") {
    expect(how.evidence.recentExamples).toHaveLength(5);
    expect(how.evidence.recentExamples?.[0]?.kind).toBe("read");
    expect(how.evidence.recentExamples?.[0]?.action).toBe(`read(${join(root, "skills/how/SKILL.md")})`);
    expect(how.evidence.recentExamples?.[0]?.sessionTitle).toBe("Newest Session");
    expect(how.evidence.recentExamples?.[0]?.partId).toBe("e6");
    expect(how.evidence.recentExamples?.[0]?.messageId).toBe("msg-e6");
    expect(how.evidence.recentExamples?.[4]?.at).toBe(new Date(now - 6 * DAY).toISOString());
  }
  store.close();
});

test("recent examples fallback to session id when title is missing", async () => {
  const root = makeTempDir("learn-history-examples-title-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const projectPath = join(root, "project-a");
  insertProject(db, "p1", projectPath);
  insertSession(db, {
    id: "s1",
    title: null,
    projectId: "p1",
    directory: projectPath,
    created: now - DAY,
    updated: now,
  });
  insertPart(db, {
    id: "load",
    sessionId: "s1",
    created: now - 100,
    updated: now - 100,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 90),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const result = await store.refresh(catalog, opts(dbPath, projectPath));
  const how = observation(result, "skill:how");
  expect(how?.evidence.kind).toBe("observed");
  if (how?.evidence.kind === "observed") {
    expect(how.evidence.recentExamples?.[0]?.sessionTitle).toBe("s1");
  }
  store.close();
});

test("recent examples respect subagent toggle and scope isolation", async () => {
  const root = makeTempDir("learn-history-examples-scope-");
  makeCatalogFixture(root);
  const dbPath = join(root, "events.db");
  const db = createDb(dbPath);
  const now = Date.now();
  const here = join(root, "project-a");
  const there = join(root, "project-b");
  insertProject(db, "p1", here);
  insertProject(db, "p2", there);
  insertSession(db, { id: "parent", projectId: "p1", directory: here, created: now - DAY, updated: now });
  insertSession(db, {
    id: "child",
    projectId: "p1",
    parentId: "parent",
    directory: here,
    created: now - DAY,
    updated: now,
  });
  insertSession(db, { id: "other", projectId: "p2", directory: there, created: now - DAY, updated: now });
  insertPart(db, {
    id: "parent-load",
    sessionId: "parent",
    created: now - 300,
    updated: now - 300,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 290),
  });
  insertPart(db, {
    id: "child-read",
    sessionId: "child",
    created: now - 200,
    updated: now - 200,
    data: readPart(join(root, "skills/how/SKILL.md"), "completed", now - 190),
  });
  insertPart(db, {
    id: "other-load",
    sessionId: "other",
    created: now - 100,
    updated: now - 100,
    data: skillPart("how", "completed", join(root, "skills/how"), now - 90),
  });
  db.close();

  const catalog = await discoverCatalog(root);
  const store = new HistoryStore(dbPath);
  const base = await store.refresh(catalog, opts(dbPath, here));
  const baseHow = observation(base, "skill:how");
  expect(baseHow?.evidence.kind).toBe("observed");
  if (baseHow?.evidence.kind === "observed") {
    expect(baseHow.evidence.recentExamples).toHaveLength(1);
    expect(baseHow.evidence.recentExamples?.[0]?.kind).toBe("load");
    expect(baseHow.evidence.recentExamples?.[0]?.isSubagent).toBeFalse();
  }

  const withChildren = await store.refresh(catalog, { ...opts(dbPath, here), includeSubagents: true });
  const childHow = observation(withChildren, "skill:how");
  expect(childHow?.evidence.kind).toBe("observed");
  if (childHow?.evidence.kind === "observed") {
    expect(childHow.evidence.recentExamples).toHaveLength(2);
    expect(childHow.evidence.recentExamples?.[0]?.kind).toBe("read");
    expect(childHow.evidence.recentExamples?.[0]?.isSubagent).toBeTrue();
  }
  store.close();
});
