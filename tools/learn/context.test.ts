import { Database } from "bun:sqlite";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { loadExampleContext } from "./context";
import { makeTempDir, sha256File } from "./test-helpers";
import type { RecentExample } from "./types";

function createContextDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec(`
    create table session (
      id text primary key,
      parent_id text
    );
    create table message (
      id text primary key,
      session_id text not null,
      time_created integer not null,
      data text not null
    );
    create table part (
      id text primary key,
      message_id text not null,
      session_id text not null,
      time_created integer not null,
      data text not null
    );
  `);
  return db;
}

function insertMessage(
  db: Database,
  row: { id: string; sessionId: string; role: "user" | "assistant"; at: number },
): void {
  db.query("insert into message values (?, ?, ?, ?)").run(
    row.id,
    row.sessionId,
    row.at,
    JSON.stringify({ role: row.role }),
  );
}

function insertText(
  db: Database,
  row: { id: string; messageId: string; sessionId: string; at: number; text: string },
): void {
  db.query("insert into part values (?, ?, ?, ?, ?)").run(
    row.id,
    row.messageId,
    row.sessionId,
    row.at,
    JSON.stringify({ type: "text", text: row.text }),
  );
}

function insertSkill(
  db: Database,
  row: { id: string; messageId: string; sessionId: string; at: number; name?: string; status?: string },
): void {
  db.query("insert into part values (?, ?, ?, ?, ?)").run(
    row.id,
    row.messageId,
    row.sessionId,
    row.at,
    JSON.stringify({
      type: "tool",
      tool: "skill",
      state: { status: row.status ?? "completed", input: { name: row.name ?? "how" } },
    }),
  );
}

function example(overrides: Partial<RecentExample> = {}): RecentExample {
  return {
    kind: "load",
    at: new Date(3_000).toISOString(),
    sessionId: "session-a",
    sessionTitle: "Example",
    directory: "/project",
    isSubagent: false,
    action: "skill(how)",
    partId: "anchor",
    messageId: "assistant-anchor",
    ...overrides,
  };
}

test("loads original text around the exact completed event and stops at the next user", async () => {
  const dbPath = join(makeTempDir("learn-context-"), "events.db");
  const db = createContextDb(dbPath);
  db.query("insert into session values (?, ?)").run("session-a", null);

  insertMessage(db, { id: "user-request", sessionId: "session-a", role: "user", at: 1_000 });
  insertText(db, {
    id: "request-text",
    messageId: "user-request",
    sessionId: "session-a",
    at: 1_001,
    text: "Explain this exact code.",
  });
  insertMessage(db, { id: "assistant-before", sessionId: "session-a", role: "assistant", at: 2_000 });
  insertText(db, {
    id: "before-text",
    messageId: "assistant-before",
    sessionId: "session-a",
    at: 2_001,
    text: "I will inspect it first.",
  });
  insertMessage(db, { id: "assistant-anchor", sessionId: "session-a", role: "assistant", at: 3_000 });
  insertText(db, {
    id: "lead-in",
    messageId: "assistant-anchor",
    sessionId: "session-a",
    at: 3_001,
    text: "Loading the relevant instructions.",
  });
  insertSkill(db, {
    id: "anchor",
    messageId: "assistant-anchor",
    sessionId: "session-a",
    at: 3_002,
  });
  insertText(db, {
    id: "same-message-after",
    messageId: "assistant-anchor",
    sessionId: "session-a",
    at: 3_003,
    text: "The instructions are loaded.",
  });
  insertMessage(db, { id: "assistant-after", sessionId: "session-a", role: "assistant", at: 4_000 });
  insertText(db, {
    id: "after-text",
    messageId: "assistant-after",
    sessionId: "session-a",
    at: 4_001,
    text: "Here is the explanation.",
  });
  insertMessage(db, { id: "future-user", sessionId: "session-a", role: "user", at: 5_000 });
  insertText(db, {
    id: "future-user-text",
    messageId: "future-user",
    sessionId: "session-a",
    at: 5_001,
    text: "Unrelated next request.",
  });
  insertMessage(db, { id: "future-assistant", sessionId: "session-a", role: "assistant", at: 6_000 });
  insertText(db, {
    id: "future-assistant-text",
    messageId: "future-assistant",
    sessionId: "session-a",
    at: 6_001,
    text: "Unrelated answer.",
  });
  db.close();

  const beforeHash = sha256File(dbPath);
  const result = await loadExampleContext(dbPath, example());
  expect(sha256File(dbPath)).toBe(beforeHash);
  expect(result.kind).toBe("available");
  if (result.kind === "available") {
    expect(result.action).toBe("skill(how)");
    expect(result.messages.map((message) => message.text)).toEqual([
      "Explain this exact code.",
      "I will inspect it first.",
      "Loading the relevant instructions.",
      "The instructions are loaded.",
      "Here is the explanation.",
    ]);
    expect(result.messages.map((message) => message.relation)).toEqual([
      "request",
      "before",
      "invocation",
      "after",
      "after",
    ]);
    expect(result.warnings.some((warning) => warning.includes("next user turn"))).toBeTrue();
  }
});

test("nested context stays in its child session and identifies the nested boundary", async () => {
  const dbPath = join(makeTempDir("learn-context-child-"), "events.db");
  const db = createContextDb(dbPath);
  db.query("insert into session values (?, ?)").run("parent", null);
  db.query("insert into session values (?, ?)").run("child", "parent");
  insertMessage(db, { id: "parent-user", sessionId: "parent", role: "user", at: 500 });
  insertText(db, {
    id: "parent-secret",
    messageId: "parent-user",
    sessionId: "parent",
    at: 501,
    text: "Parent text must not leak.",
  });
  insertMessage(db, { id: "child-user", sessionId: "child", role: "user", at: 1_000 });
  insertText(db, {
    id: "child-prompt",
    messageId: "child-user",
    sessionId: "child",
    at: 1_001,
    text: "Task prompt for this child.",
  });
  insertMessage(db, { id: "child-assistant", sessionId: "child", role: "assistant", at: 2_000 });
  insertSkill(db, {
    id: "child-anchor",
    messageId: "child-assistant",
    sessionId: "child",
    at: 2_001,
  });
  db.close();

  const result = await loadExampleContext(
    dbPath,
    example({
      sessionId: "child",
      isSubagent: true,
      partId: "child-anchor",
      messageId: "child-assistant",
    }),
  );
  expect(result.kind).toBe("available");
  if (result.kind === "available") {
    expect(result.messages.map((message) => message.text)).toEqual(["Task prompt for this child."]);
    expect(result.warnings.some((warning) => warning.includes("nested child session"))).toBeTrue();
  }
});

test("missing or mismatched IDs and incomplete events are unavailable", async () => {
  const dbPath = join(makeTempDir("learn-context-missing-"), "events.db");
  const db = createContextDb(dbPath);
  db.query("insert into session values (?, ?)").run("session-a", null);
  insertMessage(db, { id: "assistant-anchor", sessionId: "session-a", role: "assistant", at: 1_000 });
  insertSkill(db, {
    id: "anchor",
    messageId: "assistant-anchor",
    sessionId: "session-a",
    at: 1_001,
    status: "running",
  });
  db.close();

  const withoutIds: RecentExample = {
    kind: "load",
    at: new Date(3_000).toISOString(),
    sessionId: "session-a",
    sessionTitle: "Old example",
    directory: "/project",
    isSubagent: false,
    action: "skill(how)",
  };
  expect((await loadExampleContext(dbPath, withoutIds)).kind).toBe("unavailable");
  expect((await loadExampleContext(dbPath, example({ messageId: "wrong-message" }))).kind).toBe(
    "unavailable",
  );
  expect((await loadExampleContext(dbPath, example())).kind).toBe("unavailable");
});

test("reports per-part and total truncation without changing original text", async () => {
  const dbPath = join(makeTempDir("learn-context-truncate-"), "events.db");
  const db = createContextDb(dbPath);
  db.query("insert into session values (?, ?)").run("session-a", null);
  insertMessage(db, { id: "user-request", sessionId: "session-a", role: "user", at: 1_000 });
  insertText(db, {
    id: "long-request",
    messageId: "user-request",
    sessionId: "session-a",
    at: 1_001,
    text: "x".repeat(7_000),
  });
  insertMessage(db, { id: "assistant-anchor", sessionId: "session-a", role: "assistant", at: 2_000 });
  insertSkill(db, {
    id: "anchor",
    messageId: "assistant-anchor",
    sessionId: "session-a",
    at: 2_001,
  });
  db.close();

  const result = await loadExampleContext(dbPath, example());
  expect(result.kind).toBe("available");
  if (result.kind === "available") {
    expect(result.messages[0]?.text).toBe("x".repeat(6_000));
    expect(result.messages[0]?.truncated).toBeTrue();
    expect(result.warnings.some((warning) => warning.includes("truncated"))).toBeTrue();
  }
});
