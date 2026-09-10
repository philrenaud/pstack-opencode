import { test, expect } from "bun:test";
import { createInitialState, examplesScrollLimit, filterCapabilities, renderFrame, suggestion } from "./view";
import type { SnapshotResult } from "./types";
import { stringWidth } from "bun";

const snapshot: SnapshotResult = {
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
          count: { loads: 1, reads: 0 },
          lastSeenAt: new Date().toISOString(),
          lastSessionId: "s1",
          lastSessionParent: false,
          recentExamples: [
            {
              kind: "load",
              at: new Date().toISOString(),
              sessionId: "s1",
              sessionTitle: "Session One",
              directory: "/x",
              isSubagent: false,
              action: "skill(how)",
            },
          ],
        },
      },
      { capabilityId: "playbook:feature", evidence: { kind: "not-observed", count: { loads: 0, reads: 0 } } },
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
          count: { loads: 1, reads: 0 },
          lastSeenAt: new Date().toISOString(),
          lastSessionId: "s1",
          lastSessionParent: false,
          recentExamples: [
            {
              kind: "load",
              at: new Date().toISOString(),
              sessionId: "s1",
              sessionTitle: "Session One",
              directory: "/x",
              isSubagent: false,
              action: "skill(how)",
            },
          ],
        },
      },
    { capabilityId: "playbook:feature", evidence: { kind: "not-observed", count: { loads: 0, reads: 0 } } },
  ],
  options: {
    scope: "project",
    window: "30",
    includeSubagents: false,
    projectPath: "/x",
    dbPath: "/db.sqlite",
  },
};

test("render sanitizes external paths and keeps calendar context for evidence", () => {
  const data = structuredClone(snapshot);
  const capability = data.catalog.capabilities[0];
  const observation = data.observations[0];
  if (!capability || observation?.evidence.kind !== "observed") throw new Error("fixture is incomplete");
  capability.sourcePath = "/x/\u001b[2Junsafe\npath/SKILL.md";
  data.catalog.warnings = ["bad\u001b[2Jwarning\nline"];
  observation.evidence.lastSeenAt = "2020-01-02T12:00:00.000Z";
  const frame = renderFrame(data, createInitialState(), 120, 40);
  const text = frame.join("\n");
  expect(text).not.toContain("\u001b");
  expect(text).toContain("2020");
  expect(frame.every((line) => !line.includes("\n") && stringWidth(line) <= 119)).toBe(true);
});

test("filters by search and hide observed", () => {
  const state = createInitialState();
  state.search = "feature";
  let items = filterCapabilities(snapshot, state);
  expect(items).toHaveLength(1);
  expect(items[0]?.capability.id).toBe("playbook:feature");

  state.search = "";
  state.hideObserved = true;
  items = filterCapabilities(snapshot, state);
  expect(items).toHaveLength(1);
  expect(items[0]?.capability.id).toBe("playbook:feature");
});

test("renders compact hint for tiny terminal", () => {
  const state = createInitialState();
  const frame = renderFrame(snapshot, state, 30, 10);
  expect(frame[0]?.includes("resize terminal")).toBeTrue();
});

test("renders a plain, useful wide frame without mutating state", () => {
  const state = createInitialState();
  state.selected = 99;
  const before = structuredClone(state);
  const frame = renderFrame(snapshot, state, 120, 30);
  expect(frame.some((line) => line.includes("Try next"))).toBeTrue();
  expect(frame.some((line) => line.includes("TYPE NAME") && line.includes("LOADS READS"))).toBeTrue();
  expect(frame.some((line) => line.includes("INVOKE Use the feature playbook"))).toBeTrue();
  expect(frame.some((line) => line.includes("Refreshed") && line.includes("in 1ms"))).toBeTrue();
  expect(frame.join("\n")).not.toContain("\u001b[");
  expect(state).toEqual(before);
});

test("unknown evidence is neither not-observed nor suggested", () => {
  const unknownSnapshot: SnapshotResult = {
    ...snapshot,
    history: { kind: "unavailable", reason: "database missing", readAt: new Date().toISOString(), durationMs: 2, warnings: [] },
    observations: snapshot.catalog.capabilities.map((capability) => ({
      capabilityId: capability.id,
      evidence: { kind: "unknown", count: { loads: 0, reads: 0 } },
    })),
  };
  const state = createInitialState();
  state.hideObserved = true;
  expect(filterCapabilities(unknownSnapshot, state)).toHaveLength(0);
  expect(suggestion(unknownSnapshot)).toBeUndefined();
  expect(renderFrame(unknownSnapshot, createInitialState(), 80, 24).join("\n")).toContain("HISTORY UNKNOWN: database missing");
});

test("wraps long invocation without dropping text", () => {
  const longInvocation = "Use /a/very/long/path/without/spaces/to/invoke/the/capability/and-keep-every-character.";
  const longSnapshot: SnapshotResult = {
    ...snapshot,
    catalog: {
      ...snapshot.catalog,
      capabilities: [{ ...snapshot.catalog.capabilities[0]!, invocation: longInvocation }],
    },
    observations: [snapshot.observations[0]!],
  };
  const state = createInitialState();
  state.narrowDetail = true;
  const detail = renderFrame(longSnapshot, state, 80, 24).join("\n").replace(/\s+\n/g, "\n");
  expect(detail.replace(/\s+/g, "")).toContain(longInvocation.replace(/\s+/g, ""));
});

test("wide split view shows wider catalog name column", () => {
  const wideSnapshot: SnapshotResult = {
    ...snapshot,
    catalog: {
      ...snapshot.catalog,
      capabilities: [
        {
          ...snapshot.catalog.capabilities[0]!,
          name: "maintain-verification-skill",
        },
        snapshot.catalog.capabilities[1]!,
      ],
    },
    observations: [snapshot.observations[0]!, snapshot.observations[1]!],
  };
  const frame = renderFrame(wideSnapshot, createInitialState(), 120, 32);
  expect(frame.join("\n")).toContain("maintain-verification-skill");
});

test("enter examples view renders records and consultation footer", () => {
  const state = createInitialState();
  state.focus = "examples";
  const frame = renderFrame(snapshot, state, 120, 30).join("\n");
  expect(frame).toContain("RECENT EXAMPLES");
  expect(frame).toContain("ACTION skill(how)");
  expect(frame).toContain("RESUME opencode -s s1");
  expect(frame).toContain("Consultation only; not proof of completed execution.");
});

test("examples view shows empty and unknown messages", () => {
  const notObservedState = createInitialState();
  notObservedState.focus = "examples";
  notObservedState.selected = 1;
  const notObserved = renderFrame(snapshot, notObservedState, 120, 30).join("\n");
  expect(notObserved).toContain("No recorded examples in this scope and window. Try this invocation:");

  const unknownSnapshot: SnapshotResult = {
    ...snapshot,
    history: {
      kind: "unavailable",
      reason: "database missing",
      readAt: new Date().toISOString(),
      durationMs: 1,
      warnings: [],
    },
    observations: [
      {
        capabilityId: "skill:how",
        evidence: { kind: "unknown", count: { loads: 0, reads: 0 } },
      },
      snapshot.observations[1]!,
    ],
  };
  notObservedState.selected = 0;
  const unknown = renderFrame(unknownSnapshot, notObservedState, 120, 30).join("\n");
  expect(unknown).toContain("Examples unavailable because history is unknown (database missing).");
});

test("examples scroll limit uses only examples content", () => {
  const state = createInitialState();
  state.focus = "examples";
  const limits = examplesScrollLimit(snapshot, state, 120, 14);
  expect(limits).toBeGreaterThan(0);
  const observed = snapshot.observations[0];
  if (!observed || observed.evidence.kind !== "observed") throw new Error("fixture is incomplete");
  const tallSnapshot: SnapshotResult = {
    ...snapshot,
    observations: [
      {
        ...observed,
        evidence: {
          ...observed.evidence,
          recentExamples: Array.from({ length: 5 }, (_, i) => ({
            kind: i % 2 === 0 ? "load" : "read",
            at: new Date(Date.now() - i * 1000).toISOString(),
            sessionId: `s${i}`,
            sessionTitle: `Session ${i}`,
            directory: "/x",
            isSubagent: false,
            action: i % 2 === 0 ? "skill(how)" : "read(/x/skills/how/SKILL.md)",
          })),
        },
      },
      snapshot.observations[1]!,
    ],
  };
  expect(examplesScrollLimit(tallSnapshot, state, 120, 14)).toBeGreaterThan(limits);
});

test("examples wrap long values across visible lines without clipping", () => {
  const data = structuredClone(snapshot);
  const observed = data.observations[0];
  if (!observed || observed.evidence.kind !== "observed") throw new Error("fixture is incomplete");
  observed.evidence.recentExamples = [
    {
      kind: "read",
      at: new Date().toISOString(),
      sessionId: "session-with-a-very-long-identifier-that-should-wrap",
      sessionTitle: "Prompt with emoji 🚀 and unicode 東京 that should remain visible when wrapped",
      directory: "/x/projects/with/a/very/long/path/that/should/not/disappear/when/rendered/in/examples",
      isSubagent: false,
      action: "read(/x/projects/with/a/very/long/path/that/should/not/disappear/when/rendered/in/examples/SKILL.md)",
    },
  ];
  const state = createInitialState();
  state.focus = "examples";
  const limit = examplesScrollLimit(data, state, 58, 24);
  expect(limit).toBeGreaterThan(0);
  const frame = renderFrame(data, state, 58, 24).join("\n");
  expect(frame.replace(/\s+/g, "")).toContain("/x/projects/with/a/very/long/path/that/should/not/disappear/when/rendered/in/examples");
  expect(frame).toContain("東京");
});
