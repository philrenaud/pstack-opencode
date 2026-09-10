import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";

export function makeTempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export function makeCatalogFixture(root: string): void {
  write(
    join(root, "skills/how/SKILL.md"),
    `---
name: how
description: Explain runtime behavior.
---

# How

Walkthroughs.
`,
  );
  write(
    join(root, "skills/architect/SKILL.md"),
    `---
name: architect
description: Design first.
---

# Architect
`,
  );
  write(
    join(root, "skills/principle-model-the-domain/SKILL.md"),
    `---
name: principle-model-the-domain
description: Encode the domain in structure.
---

# Principle
`,
  );
  write(
    join(root, "skills/poteto-mode/SKILL.md"),
    `# Poteto mode

- **Feature.** New behavior. \`playbooks/feature.md\`.
- **Bug fix.** Fix defect. \`playbooks/bug-fix.md\`.
`,
  );
  write(
    join(root, "skills/poteto-mode/playbooks/feature.md"),
    `# Feature

Use this for features.
`,
  );
  write(
    join(root, "skills/poteto-mode/playbooks/bug-fix.md"),
    `# Bug fix

Use this for bug fixes.
`,
  );
}

export function createDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec(`
create table project (
  id text primary key,
  worktree text not null
);
create table session (
  id text primary key,
  project_id text not null,
  parent_id text,
  title text,
  directory text not null,
  time_created integer not null,
  time_updated integer not null
);
create table part (
  id text primary key,
  session_id text not null,
  message_id text not null,
  time_created integer not null,
  time_updated integer not null,
  data text not null
);
create index session_project_time on session(project_id, time_updated);
create index part_session_idx on part(session_id);
`);
  return db;
}

export function sha256File(path: string): string {
  const bytes = readFileSync(path);
  return createHash("sha256").update(bytes).digest("hex");
}

export function insertProject(db: Database, id: string, worktree: string): void {
  db.query("insert into project (id, worktree) values (?, ?)").run(id, worktree);
}

export function insertSession(
  db: Database,
  row: {
    id: string;
    projectId: string;
    parentId?: string | null;
    title?: string | null;
    directory: string;
    created: number;
    updated: number;
  },
): void {
  db.query(
    "insert into session (id, project_id, parent_id, title, directory, time_created, time_updated) values (?, ?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.projectId, row.parentId ?? null, row.title ?? null, row.directory, row.created, row.updated);
}

export function insertPart(
  db: Database,
  row: {
    id: string;
    sessionId: string;
    created: number;
    updated: number;
    data: unknown;
  },
): void {
  db.query(
    "insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)",
  ).run(row.id, `msg-${row.id}`, row.sessionId, row.created, row.updated, JSON.stringify(row.data));
}

export function skillPart(name: string, status: "completed" | "error", dir?: string, ts?: number): unknown {
  return {
    type: "tool",
    tool: "skill",
    state: {
      status,
      input: { name },
      metadata: dir ? { dir } : undefined,
      time: ts ? { start: ts - 100, end: ts } : undefined,
    },
  };
}

export function readPart(filePath: string, status: "completed" | "error", ts?: number): unknown {
  return {
    type: "tool",
    tool: "read",
    state: {
      status,
      input: { filePath },
      time: ts ? { start: ts - 100, end: ts } : undefined,
    },
  };
}
