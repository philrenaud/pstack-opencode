import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { Database } from "bun:sqlite";
import type { ContextMessage, ExampleContext, RecentExample } from "./types";
import { toIso } from "./types";

interface Anchor {
  messageId: string;
  messageCreated: number;
  partCreated: number;
  partId: string;
  parentId: string | null;
  tool: "skill" | "read";
  actionValue: string;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  created: number;
}

interface TextRow {
  id: string;
  created: number;
  text: string;
}

const MAX_MESSAGE_CHARS = 6_000;
const MAX_TOTAL_CHARS = 24_000;
const MAX_TEXT_PARTS_PER_MESSAGE = 20;

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function tableColumns(db: Database, table: string): Set<string> {
  const rows = db
    .query<{ name: unknown }, []>(`select name from pragma_table_info('${table}')`)
    .all();
  return new Set(rows.map((row) => row.name).filter(isString));
}

function hasColumns(db: Database, table: string, expected: readonly string[]): boolean {
  const columns = tableColumns(db, table);
  return expected.every((column) => columns.has(column));
}

function readAnchor(db: Database, example: RecentExample): Anchor | undefined {
  if (!example.partId || !example.messageId) {
    return undefined;
  }
  const row = db
    .query<Record<string, unknown>, [string, string, string]>(
      `select p.id as part_id, p.message_id, p.time_created as part_created,
        m.time_created as message_created, s.parent_id,
        json_extract(p.data, '$.tool') as tool,
        json_extract(p.data, '$.state.status') as status,
        json_extract(p.data, '$.state.input.name') as skill_name,
        json_extract(p.data, '$.state.input.filePath') as file_path
       from part p
       join message m on m.id = p.message_id and m.session_id = p.session_id
       join session s on s.id = p.session_id
       where p.id = ? and p.message_id = ? and p.session_id = ? and json_valid(p.data)`,
    )
    .get(example.partId, example.messageId, example.sessionId);
  if (!row || row["status"] !== "completed") {
    return undefined;
  }
  const partId = row["part_id"];
  const messageId = row["message_id"];
  const messageCreated = row["message_created"];
  const partCreated = row["part_created"];
  const expectedTool = example.kind === "load" ? "skill" : "read";
  const tool = row["tool"];
  const actionValue = expectedTool === "skill" ? row["skill_name"] : row["file_path"];
  if (
    !isString(partId) ||
    !isString(messageId) ||
    !isNumber(messageCreated) ||
    !isNumber(partCreated) ||
    tool !== expectedTool ||
    !isString(actionValue)
  ) {
    return undefined;
  }
  const parentId = row["parent_id"];
  return {
    partId,
    messageId,
    messageCreated,
    partCreated,
    parentId: isString(parentId) ? parentId : null,
    tool: expectedTool,
    actionValue,
  };
}

function readMessages(db: Database, sessionId: string): MessageRow[] {
  const rows = db
    .query<Record<string, unknown>, [string]>(
      `select id, time_created, json_extract(data, '$.role') as role
       from message
       where session_id = ? and json_valid(data)
          and json_extract(data, '$.role') in ('user', 'assistant')
          and (json_extract(data, '$.role') = 'assistant' or exists (
            select 1 from part p where p.message_id = message.id and p.session_id = message.session_id
              and json_valid(p.data) and json_extract(p.data, '$.type') = 'text'
              and coalesce(json_extract(p.data, '$.synthetic'), 0) = 0
              and typeof(json_extract(p.data, '$.text')) = 'text'
          ))
       order by time_created, id`,
    )
    .all(sessionId);
  const messages: MessageRow[] = [];
  for (const row of rows) {
    const id = row["id"];
    const role = row["role"];
    const created = row["time_created"];
    if (isString(id) && (role === "user" || role === "assistant") && isNumber(created)) {
      messages.push({ id, role, created });
    }
  }
  return messages;
}

function readTextParts(db: Database, sessionId: string, messageId: string): TextRow[] {
  const rows = db
    .query<Record<string, unknown>, [string, string, number]>(
      `select id, time_created, json_extract(data, '$.text') as text
       from part
       where session_id = ? and message_id = ? and json_valid(data)
          and json_extract(data, '$.type') = 'text'
          and coalesce(json_extract(data, '$.synthetic'), 0) = 0
         and typeof(json_extract(data, '$.text')) = 'text'
       order by time_created, id
       limit ?`,
    )
    .all(sessionId, messageId, MAX_TEXT_PARTS_PER_MESSAGE + 1);
  const parts: TextRow[] = [];
  for (const row of rows) {
    const id = row["id"];
    const created = row["time_created"];
    const text = row["text"];
    if (isString(id) && isNumber(created) && typeof text === "string") {
      parts.push({ id, created, text });
    }
  }
  return parts;
}

function unavailable(reason: string): ExampleContext {
  return { kind: "unavailable", reason };
}

export async function loadExampleContext(
  dbPath: string,
  example: RecentExample,
): Promise<ExampleContext> {
  if (!example.partId || !example.messageId) {
    return unavailable("Exact context is unavailable because this example has no event IDs.");
  }
  try {
    await access(dbPath, constants.R_OK);
  } catch {
    return unavailable("The OpenCode database is unavailable.");
  }

  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true, create: false });
    db.exec("pragma query_only=1");
    if (
      !hasColumns(db, "session", ["id", "parent_id"]) ||
      !hasColumns(db, "message", ["id", "session_id", "time_created", "data"]) ||
      !hasColumns(db, "part", ["id", "message_id", "session_id", "time_created", "data"])
    ) {
      return unavailable("The OpenCode database schema cannot provide exact context.");
    }

    const anchor = readAnchor(db, example);
    if (!anchor) {
      return unavailable("The exact completed skill/read event could not be found in this session.");
    }
    const action = `${anchor.tool}(${anchor.actionValue})`;
    if (action !== example.action) {
      return unavailable("The exact event no longer matches this example.");
    }
    const all = readMessages(db, example.sessionId);
    const anchorIndex = all.findIndex((message) => message.id === anchor.messageId);
    if (anchorIndex < 0 || all[anchorIndex]?.role !== "assistant") {
      return unavailable("The event's assistant invocation message is unavailable.");
    }

    const warnings: string[] = [];
    if (anchor.parentId) {
      warnings.push("This excerpt is from a nested child session and includes only that session's context.");
    }

    let requestIndex = -1;
    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
      if (all[index]?.role === "user") {
        requestIndex = index;
        break;
      }
    }
    if (requestIndex < 0) {
      warnings.push("No preceding user request was found in this session.");
    }

    const assistantBefore = all
      .slice(requestIndex + 1, anchorIndex)
      .filter((message) => message.role === "assistant");
    if (assistantBefore.length > 2) {
      warnings.push("Earlier assistant context was omitted; only the two messages nearest the event are shown.");
    }
    const before = assistantBefore.slice(-2);

    const after: MessageRow[] = [];
    let stoppedAtUser = false;
    let omittedAfter = false;
    for (let index = anchorIndex + 1; index < all.length; index += 1) {
      const message = all[index];
      if (!message) {
        continue;
      }
      if (message.role === "user") {
        stoppedAtUser = true;
        break;
      }
      if (after.length < 2) {
        after.push(message);
      } else {
        omittedAfter = true;
      }
    }
    if (stoppedAtUser) {
      warnings.push("The excerpt stops before the next user turn.");
    }
    if (omittedAfter) {
      warnings.push("Later assistant context was omitted; only two messages after the event are shown.");
    }

    const selected: Array<{ message: MessageRow; relation: ContextMessage["relation"] }> = [];
    const request = all[requestIndex];
    if (request) {
      selected.push({ message: request, relation: "request" });
    }
    selected.push(...before.map((message) => ({ message, relation: "before" as const })));
    const invocation = all[anchorIndex];
    if (invocation) {
      selected.push({ message: invocation, relation: "invocation" });
    }
    selected.push(...after.map((message) => ({ message, relation: "after" as const })));

    let remaining = MAX_TOTAL_CHARS;
    let globalTruncated = false;
    const messages: ContextMessage[] = [];
    for (const item of selected) {
      const parts = readTextParts(db, example.sessionId, item.message.id);
      if (parts.length > MAX_TEXT_PARTS_PER_MESSAGE) {
        warnings.push(`Text parts after the first ${MAX_TEXT_PARTS_PER_MESSAGE} were omitted from message ${item.message.id}.`);
      }
      let messageRemaining = MAX_MESSAGE_CHARS;
      for (const part of parts.slice(0, MAX_TEXT_PARTS_PER_MESSAGE)) {
        if (remaining <= 0 || messageRemaining <= 0) {
          globalTruncated = true;
          break;
        }
        const allowed = Math.min(messageRemaining, remaining);
        const text = part.text.slice(0, allowed);
        const truncated = text.length < part.text.length;
        const relation =
          item.relation === "invocation" &&
          (part.created > anchor.partCreated ||
            (part.created === anchor.partCreated && part.id > anchor.partId))
            ? "after"
            : item.relation;
        messages.push({
          id: item.message.id,
          role: item.message.role,
          at: toIso(part.created),
          text,
          relation,
          truncated,
        });
        remaining -= text.length;
        messageRemaining -= text.length;
        if (truncated) {
          globalTruncated = true;
        }
      }
    }
    if (globalTruncated) {
      warnings.push("Excerpt text was truncated at 6,000 characters per message or 24,000 characters total.");
    }

    return { kind: "available", example, messages, action, warnings: [...new Set(warnings)] };
  } catch {
    return unavailable("Exact context could not be read from the OpenCode database.");
  } finally {
    db?.close();
  }
}
