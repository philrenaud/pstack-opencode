import { Database } from "bun:sqlite";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { createInteractiveApp } from "./tui";
import { makeTempDir } from "./test-helpers";
import type { HistoryStore } from "./history";
import type { LearnOptions, RecentExample, SnapshotResult } from "./types";

function fakeStore(): HistoryStore {
  return { close: () => {} } as unknown as HistoryStore;
}

function baseOptions(): LearnOptions {
  return {
    cwd: "/project",
    allProjects: false,
    includeSubagents: false,
    window: "30",
    json: false,
    snapshot: false,
    help: false,
  };
}

function createFixtureDb(): string {
  const dbPath = join(makeTempDir("learn-tui-"), "events.db");
  const db = new Database(dbPath, { create: true });
  db.exec(`
    create table session (id text primary key, parent_id text);
    create table message (id text primary key, session_id text not null, time_created integer not null, data text not null);
    create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, data text not null);
  `);
  db.query("insert into session values (?, ?)").run("session-a", null);
  db.query("insert into message values (?, ?, ?, ?)").run(
    "user-request",
    "session-a",
    1_000,
    JSON.stringify({ role: "user" }),
  );
  db.query("insert into part values (?, ?, ?, ?, ?)").run(
    "request-text",
    "user-request",
    "session-a",
    1_001,
    JSON.stringify({ type: "text", text: "Explain this exact code." }),
  );
  db.query("insert into message values (?, ?, ?, ?)").run(
    "assistant-anchor",
    "session-a",
    2_000,
    JSON.stringify({ role: "assistant" }),
  );
  db.query("insert into part values (?, ?, ?, ?, ?)").run(
    "anchor",
    "assistant-anchor",
    "session-a",
    2_001,
    JSON.stringify({ type: "tool", tool: "skill", state: { status: "completed", input: { name: "how" } } }),
  );
  db.close();
  return dbPath;
}

function makeSnapshot(dbPath: string, withIds = true): SnapshotResult {
  const recentExamples: RecentExample[] = [
    {
      kind: "load",
      at: new Date(2_000).toISOString(),
      sessionId: "session-a",
      sessionTitle: "Session One",
      directory: "/project",
      isSubagent: false,
      action: "skill(how)",
      ...(withIds ? { partId: "anchor", messageId: "assistant-anchor" } : {}),
    },
  ];
  return {
    catalog: {
      capabilities: [
        {
          id: "skill:how",
          kind: "skill",
          name: "How",
          summary: "Explain runtime behavior.",
          sourcePath: "/x/skills/how/SKILL.md",
          sourceDir: "/x/skills/how",
          invocation: "Use the how skill to understand behavior.",
          whyTry: "It explains runtime.",
        },
        {
          id: "playbook:feature",
          kind: "playbook",
          name: "Feature",
          summary: "Implement a feature.",
          sourcePath: "/x/skills/poteto-mode/playbooks/feature.md",
          invocation: "Use the feature playbook to build behavior.",
          whyTry: "It structures feature work.",
        },
      ],
      warnings: [],
      root: "/x",
      generatedAt: new Date().toISOString(),
    },
    history: {
      kind: "available",
      observations: [
        {
          capabilityId: "skill:how",
          evidence: {
            kind: "observed",
            count: { invokes: 0, loads: 1, reads: 0 },
            lastSeenAt: new Date().toISOString(),
            lastSessionId: "session-a",
            lastSessionParent: false,
            recentExamples,
          },
        },
        { capabilityId: "playbook:feature", evidence: { kind: "not-observed", count: { invokes: 0, loads: 0, reads: 0 } } },
      ],
      sessionCount: 1,
      oldestSessionAt: new Date().toISOString(),
      readAt: new Date().toISOString(),
      durationMs: 1,
      warnings: [],
    },
    observations: [
      {
        capabilityId: "skill:how",
        evidence: {
          kind: "observed",
          count: { invokes: 0, loads: 1, reads: 0 },
          lastSeenAt: new Date().toISOString(),
          lastSessionId: "session-a",
          lastSessionParent: false,
          recentExamples,
        },
      },
      { capabilityId: "playbook:feature", evidence: { kind: "not-observed", count: { invokes: 0, loads: 0, reads: 0 } } },
    ],
    options: {
      scope: "project",
      window: "30",
      includeSubagents: false,
      projectPath: "/project",
      dbPath,
    },
  };
}

let activeSetup: TestRendererSetup | undefined;

afterEach(async () => {
  if (activeSetup) {
    activeSetup.renderer.destroy();
    activeSetup = undefined;
  }
});

async function bootstrap(snapshot: SnapshotResult, dimensions = { width: 120, height: 40 }) {
  const testRenderer = await createTestRenderer(dimensions);
  activeSetup = testRenderer;
  const buildSnapshotStub = async () => snapshot;
  const app = await createInteractiveApp(testRenderer.renderer, baseOptions(), fakeStore(), snapshot, buildSnapshotStub, {
    listenForSignals: false,
  });
  await testRenderer.renderOnce();
  return { setup: testRenderer, app };
}

function makeLargeSnapshot(dbPath: string): SnapshotResult {
  const snapshot = makeSnapshot(dbPath);
  snapshot.catalog.capabilities = Array.from({ length: 70 }, (_, index) => ({
    id: `skill:catalog-capability-${String(index).padStart(2, "0")}`,
    kind: "skill" as const,
    name: `catalog-capability-${String(index).padStart(2, "0")}`,
    summary: `Capability ${index}.`,
    sourcePath: `/x/skills/catalog-capability-${index}/SKILL.md`,
    sourceDir: `/x/skills/catalog-capability-${index}`,
    invocation: `Use catalog capability ${index}.`,
    whyTry: `Try capability ${index}.`,
  }));
  snapshot.observations = snapshot.catalog.capabilities.map((capability) => ({
    capabilityId: capability.id,
    evidence: { kind: "not-observed" as const, count: { invokes: 0, loads: 0, reads: 0 } },
  }));
  if (snapshot.history.kind === "available") snapshot.history.observations = snapshot.observations;
  return snapshot;
}

function makeColumnSnapshot(dbPath: string): SnapshotResult {
  const snapshot = makeSnapshot(dbPath);
  const names = [
    "short",
    "principle-migrate-callers-then-delete-legacy-apis",
    "medium-capability",
    "separate-before-serializing-shared-state",
    ...Array.from({ length: 24 }, (_, index) => `filler-${String(index).padStart(2, "0")}`),
  ];
  snapshot.catalog.capabilities = names.map((name, index) => ({
    id: `skill:${name}`,
    kind: "principle" as const,
    name,
    summary: `Capability ${index}.`,
    sourcePath: `/x/principles/${name}/SKILL.md`,
    sourceDir: `/x/principles/${name}`,
    invocation: `Use ${name}.`,
    whyTry: `Try ${name}.`,
  }));
  snapshot.observations = snapshot.catalog.capabilities.map((capability) => ({
    capabilityId: capability.id,
    evidence: {
      kind: "observed" as const,
      count: { invokes: 0, loads: 12, reads: 345 },
      lastSeenAt: new Date().toISOString(),
      lastSessionId: "session-a",
      lastSessionParent: false,
      recentExamples: [],
    },
  }));
  if (snapshot.history.kind === "available") snapshot.history.observations = snapshot.observations;
  return snapshot;
}

function leftPane(frame: string, width = 58): string {
  const lines = frame.split("\n");
  const first = lines.findIndex((line) => line.includes("Catalog"));
  const last = lines.findIndex((line, index) => index > first && line.startsWith("╰"));
  return lines.slice(first, last + 1).map((line) => line.slice(0, width)).join("\n");
}

function catalogLines(frame: string): string[] {
  return leftPane(frame, frame.split("\n")[0]?.length ?? 0).split("\n");
}

function expectAlignedCatalogColumns(frame: string): void {
  const lines = catalogLines(frame);
  const header = lines.find((line) => line.includes("CAPABILITY") && line.includes("INVOKE"));
  const rows = lines.filter((line) => line.includes("PR") && /\s0\s+12\s+345\s/.test(line));
  if (!header) throw new Error("catalog header was not rendered");
  expect(rows.length).toBeGreaterThan(0);
  const starts = [header.indexOf("INVOKE"), header.indexOf("LOAD"), header.indexOf("READ")];
  for (const row of rows) {
    expect([row.indexOf("0", starts[0]), row.indexOf("12", starts[1]), row.indexOf("345", starts[2])]).toEqual(starts);
  }
}

test("selection scrolls the left catalog viewport beyond one screen", async () => {
  const { setup, app } = await bootstrap(makeLargeSnapshot(createFixtureDb()), { width: 120, height: 24 });

  for (let index = 0; index < 18; index += 1) setup.mockInput.pressArrow("down");
  setup.mockInput.pressKey("\u001b[6~");
  await setup.flush();

  const pane = leftPane(setup.captureCharFrame());
  expect(pane).toContain("catalog-capability-30");
  expect(pane).not.toContain("catalog-capability-00");
  app.shutdown();
});

test("End, Home, and PageUp keep the selected catalog row visible", async () => {
  const { setup, app } = await bootstrap(makeLargeSnapshot(createFixtureDb()), { width: 120, height: 24 });

  setup.mockInput.pressKey("\u001b[F");
  await setup.flush();
  let pane = leftPane(setup.captureCharFrame());
  expect(pane).toContain("› SK  catalog-capability-69");
  expect(pane).not.toContain("catalog-capability-00");

  setup.mockInput.pressKey("\u001b[5~");
  await setup.flush();
  pane = leftPane(setup.captureCharFrame());
  expect(pane).toContain("› SK  catalog-capability-57");

  setup.mockInput.pressKey("\u001b[H");
  await setup.flush();
  pane = leftPane(setup.captureCharFrame());
  expect(pane).toContain("› SK  catalog-capability-00");
  app.shutdown();
});

test("filter reset and narrow resize restore a visible selected row", async () => {
  const { setup, app } = await bootstrap(makeLargeSnapshot(createFixtureDb()), { width: 120, height: 24 });
  setup.mockInput.pressKey("\u001b[F");
  await setup.flush();

  await setup.mockInput.typeText("/capability-03");
  setup.mockInput.pressEnter();
  await setup.flush();
  expect(leftPane(setup.captureCharFrame())).toContain("› SK  catalog-capability-03");

  setup.mockInput.pressEscape();
  await setup.flush();
  expect(leftPane(setup.captureCharFrame())).toContain("› SK  catalog-capability-00");

  setup.mockInput.pressKey("\u001b[F");
  await setup.flush();
  setup.resize(70, 18);
  await setup.flush();
  const pane = leftPane(setup.captureCharFrame(), 70);
  expect(pane).toContain("› SK  catalog-capability-69");
  expect(pane).not.toContain("catalog-capability-00");
  expect(pane).toContain("TYPE CAPABILITY");
  app.shutdown();
});

test("idle redraw preserves catalog scroll position", async () => {
  const snapshot = makeLargeSnapshot(createFixtureDb());
  const setup = await createTestRenderer({ width: 120, height: 24 });
  activeSetup = setup;
  const app = await createInteractiveApp(setup.renderer, baseOptions(), fakeStore(), snapshot, async () => snapshot, {
    refreshIntervalMs: 5,
    listenForSignals: false,
  });
  setup.mockInput.pressKey("\u001b[F");
  await setup.flush();
  await Bun.sleep(20);
  await setup.flush();
  const pane = leftPane(setup.captureCharFrame());
  expect(pane).toContain("› SK  catalog-capability-69");
  expect(pane).not.toContain("catalog-capability-00");
  app.shutdown();
});

test("initial load renders catalog with header, chips, and footer help", async () => {
  const dbPath = createFixtureDb();
  const snapshot = makeSnapshot(dbPath);
  const { setup, app } = await bootstrap(snapshot);
  const frame = setup.captureCharFrame();
  expect(frame).toContain("pstack learn");
  expect(frame).toContain("How");
  expect(frame).toContain("Feature");
  expect(frame).toContain("Try next:");
  expect(frame).toContain("help");
  app.shutdown();
});

test("Enter opens recent examples, second Enter loads exact context and Escape returns", async () => {
  const dbPath = createFixtureDb();
  const snapshot = makeSnapshot(dbPath);
  const { setup, app } = await bootstrap(snapshot);

  setup.mockInput.pressEnter();
  await setup.flush();
  let frame = setup.captureCharFrame();
  expect(frame).toContain("RECENT EXAMPLES");
  expect(frame).toContain("exact conversation context for the selected example");
  expect(app.getState().focus).toBe("examples");

  setup.mockInput.pressEnter();
  frame = await setup.waitForFrame((current) => current.includes("Explain this exact code."));
  expect(frame).toContain("EXACT CONTEXT");
  expect(frame).toContain("Explain this exact code.");
  expect(frame).toContain("TOOL EVENT skill(how)");
  expect(frame.indexOf("Explain this exact code.")).toBeLessThan(frame.indexOf("TOOL EVENT skill(how)"));
  expect(frame).toContain("consultation is not");
  expect(frame).toContain("proof of completion.");
  expect(frame).toContain("completion.");
  expect(app.getState().focus).toBe("context");

  setup.mockInput.pressEscape();
  await setup.flush();
  expect(app.getState().focus).toBe("examples");

  app.shutdown();
});

test("invocation example opens the exact user task with an invocation marker", async () => {
  const dbPath = join(makeTempDir("learn-tui-invoke-"), "events.db");
  const db = new Database(dbPath, { create: true });
  db.exec(`
    create table session (id text primary key, parent_id text);
    create table message (id text primary key, session_id text not null, time_created integer not null, data text not null);
    create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, data text not null);
  `);
  db.query("insert into session values (?, ?)").run("session-a", null);
  db.query("insert into message values (?, ?, ?, ?)").run("invoke-user", "session-a", 1_000, JSON.stringify({ role: "user" }));
  db.query("insert into part values (?, ?, ?, ?, ?)").run(
    "invoke-part", "invoke-user", "session-a", 1_001,
    JSON.stringify({ type: "text", text: "# How\n\nInstructions.\n\nBase directory for this skill: /x/skills/how\nRelative paths in this skill are relative.\n\nExplain the renderer." }),
  );
  db.close();
  const snapshot = makeSnapshot(dbPath);
  const observed = snapshot.observations[0];
  if (!observed || observed.evidence.kind !== "observed") throw new Error("fixture is incomplete");
  observed.evidence.count = { invokes: 1, loads: 0, reads: 0 };
  observed.evidence.recentExamples = [{
    kind: "invoke", at: new Date(1_001).toISOString(), sessionId: "session-a",
    sessionTitle: "Session One", directory: "/project", isSubagent: false,
    action: "invoke(how)", partId: "invoke-part", messageId: "invoke-user", skillDir: "/x/skills/how",
  }];
  if (snapshot.history.kind === "available") snapshot.history.observations = snapshot.observations;
  const { setup, app } = await bootstrap(snapshot);
  setup.mockInput.pressEnter();
  await setup.flush();
  setup.mockInput.pressEnter();
  const frame = await setup.waitForFrame((current) => current.includes("Explain the renderer."));
  expect(frame).toContain("INVOCATION invoke(how)");
  expect(frame).not.toContain("Instructions.");
  expect(frame).toContain("Expanded skill instructions omitted; original task");
  expect(frame).toContain("shown.");
  app.shutdown();
});

test("examples without ids show unavailable context instead of crashing", async () => {
  const dbPath = createFixtureDb();
  const snapshot = makeSnapshot(dbPath, false);
  const { setup, app } = await bootstrap(snapshot);

  setup.mockInput.pressEnter();
  await setup.flush();
  setup.mockInput.pressEnter();
  const frame = await setup.waitForFrame((current) => current.includes("EXACT CONTEXT"));
  expect(frame).toContain("example has no");
  expect(frame).toContain("event IDs.");
  expect(app.getState().focus).toBe("context");

  app.shutdown();
});

test("resize collapses to a single pane below the split threshold", async () => {
  const dbPath = createFixtureDb();
  const snapshot = makeSnapshot(dbPath);
  const { setup, app } = await bootstrap(snapshot);

  setup.resize(70, 30);
  await setup.flush();
  let frame = setup.captureCharFrame();
  expect(frame).toContain("How");
  expect(frame).not.toContain("RECENT EXAMPLES");

  setup.mockInput.pressArrow("right");
  await setup.flush();
  frame = setup.captureCharFrame();
  expect(frame).toContain("INVOKE");

  app.shutdown();
});

test("search filters the catalog and clears on Escape", async () => {
  const dbPath = createFixtureDb();
  const snapshot = makeSnapshot(dbPath);
  const { setup, app } = await bootstrap(snapshot);

  setup.mockInput.typeText("/feature");
  await setup.flush();
  setup.mockInput.pressEnter();
  await setup.flush();
  let frame = setup.captureCharFrame();
  expect(frame).toContain("Feature");
  expect(leftPane(frame)).not.toContain("How");

  setup.mockInput.pressEscape();
  await setup.flush();
  frame = setup.captureCharFrame();
  expect(frame).toContain("How");

  app.shutdown();
});

test("help overlay opens with ? and closes with Escape", async () => {
  const dbPath = createFixtureDb();
  const snapshot = makeSnapshot(dbPath);
  const { setup, app } = await bootstrap(snapshot);

  setup.mockInput.pressKey("?");
  await setup.flush();
  let frame = setup.captureCharFrame();
  expect(frame).toContain("HELP");
  expect(frame).toContain("Navigation");
  expect(frame).toContain("Metadata proves consultation");

  setup.mockInput.pressEscape();
  await setup.flush();
  frame = setup.captureCharFrame();
  expect(frame).not.toContain("Metadata proves consultation");

  app.shutdown();
});

test("tiny viewport renders resize hint instead of clipping the footer", async () => {
  const { setup, app } = await bootstrap(makeSnapshot(createFixtureDb()));
  setup.resize(30, 10);
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("resize terminal to 40x12");
  app.shutdown();
});

test("wide catalog renders a long capability name in full", async () => {
  const snapshot = makeSnapshot(createFixtureDb());
  snapshot.catalog.capabilities[0]!.name = "maintain-verification-skill";
  const { setup, app } = await bootstrap(snapshot);
  expect(setup.captureCharFrame()).toContain("maintain-verification-skill");
  app.shutdown();
});

test("catalog columns stay aligned across long names, resize, and scrolling", async () => {
  const snapshot = makeColumnSnapshot(createFixtureDb());
  const { setup, app } = await bootstrap(snapshot, { width: 80, height: 18 });

  for (const width of [80, 100, 120, 160]) {
    setup.resize(width, 18);
    await setup.flush();
    expectAlignedCatalogColumns(setup.captureCharFrame());
  }

  setup.resize(100, 18);
  setup.mockInput.pressKey("\u001b[F");
  await setup.flush();
  const scrolled = setup.captureCharFrame();
  expectAlignedCatalogColumns(scrolled);
  expect(catalogLines(scrolled).some((line) => line.includes("filler-23"))).toBe(true);
  expect(catalogLines(scrolled).some((line) => line.includes("principle-migrate-callers-then-delete-legacy-apis"))).toBe(false);

  setup.mockInput.pressKey("\u001b[H");
  setup.mockInput.pressArrow("down");
  await setup.flush();
  const longNameFrame = setup.captureCharFrame();
  expectAlignedCatalogColumns(longNameFrame);
  expect(catalogLines(longNameFrame).some((line) => line.includes("principle-migrate-callers-then-delete-legacy-apis"))).toBe(false);
  expect(longNameFrame).toContain("principle-migrate-callers");

  setup.mockInput.pressArrow("right");
  await setup.flush();
  const detailFrame = setup.captureCharFrame();
  const detailLines = detailFrame.split("\n");
  const detailStart = detailLines.find((line) => line.includes("How to invoke"))?.indexOf("╭─How") ?? -1;
  expect(detailStart).toBeGreaterThan(0);
  expect(detailLines.map((line) => line.slice(detailStart)).join("").replace(/[│\s]/g, "")).toContain(
    "principle-migrate-callers-then-delete-legacy-apis",
  );
  app.shutdown();
});

test("automatic refresh is serialized and stops after shutdown", async () => {
  const snapshot = makeSnapshot(createFixtureDb());
  const setup = await createTestRenderer({ width: 120, height: 40 });
  activeSetup = setup;
  let calls = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const app = await createInteractiveApp(setup.renderer, baseOptions(), fakeStore(), snapshot, async () => {
    calls += 1;
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await Bun.sleep(12);
    concurrent -= 1;
    return snapshot;
  }, { refreshIntervalMs: 5, listenForSignals: false });
  await Bun.sleep(35);
  app.shutdown();
  await app.closed;
  const callsAtShutdown = calls;
  await Bun.sleep(20);
  expect(maxConcurrent).toBe(1);
  expect(calls).toBe(callsAtShutdown);
});

test("clean shutdown destroys the renderer and resolves without dangling handles", async () => {
  const dbPath = createFixtureDb();
  const snapshot = makeSnapshot(dbPath);
  const { setup, app } = await bootstrap(snapshot);
  app.shutdown();
  await app.closed;
  expect(setup.renderer.isDestroyed).toBe(true);
});
