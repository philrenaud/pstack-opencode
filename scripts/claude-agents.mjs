#!/usr/bin/env bun
// Renders the Claude Code agent files in claude/agents/ from the OpenCode
// sources in opencode/agents/. The OpenCode files are the single source of
// truth for role prompts and model tiers; run this after editing them.
// `--check` exits non-zero when claude/agents/ is stale instead of writing.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const sourceDir = join(root, "opencode/agents");
export const targetDir = join(root, "claude/agents");

// Claude Code resolves aliases per plan, so a pin never fails on a plan that
// lacks a model. `best` is Fable when the account has it and Opus otherwise.
const aliases = {
  "claude-fable-5-1": "best",
  "claude-fable-5": "best",
  "claude-opus-5": "opus",
  "claude-sonnet-5": "sonnet",
  "claude-haiku-4-5": "haiku",
};

export function claudeModel(pin) {
  const id = pin.replace(/^[a-z0-9-]+\//, "");
  return aliases[id] ?? id;
}

export function render(name, text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${name}: missing frontmatter`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([a-z-]+):\s*(.*)$/);
    if (pair) fields[pair[1]] = pair[2];
  }
  if (!fields.description || !fields.model) throw new Error(`${name}: needs description and model`);
  const front = [`name: ${name}`, `description: ${fields.description}`, `model: ${claudeModel(fields.model)}`];
  return `---\n${front.join("\n")}\n---\n${match[2]}`;
}

export function expected() {
  const files = new Map();
  for (const file of readdirSync(sourceDir)) {
    if (!file.endsWith(".md")) continue;
    files.set(file, render(file.replace(/\.md$/, ""), readFileSync(join(sourceDir, file), "utf8")));
  }
  return files;
}

export function stale() {
  const problems = [];
  const want = expected();
  for (const [file, text] of want) {
    const path = join(targetDir, file);
    if (!existsSync(path)) problems.push(`claude/agents/${file}: missing, run scripts/claude-agents.mjs`);
    else if (readFileSync(path, "utf8") !== text) problems.push(`claude/agents/${file}: stale, run scripts/claude-agents.mjs`);
  }
  if (existsSync(targetDir)) {
    for (const file of readdirSync(targetDir)) if (file.endsWith(".md") && !want.has(file)) problems.push(`claude/agents/${file}: no OpenCode source`);
  }
  return problems;
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    const problems = stale();
    for (const problem of problems) console.error(problem);
    process.exitCode = problems.length ? 1 : 0;
  } else {
    mkdirSync(targetDir, { recursive: true });
    for (const [file, text] of expected()) writeFileSync(join(targetDir, file), text);
    console.log(`wrote ${expected().size} agents to claude/agents/`);
  }
}
