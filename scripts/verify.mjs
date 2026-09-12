#!/usr/bin/env bun
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".md")) files.push(path);
  }
}
for (const dir of ["skills", "agents", "commands"]) walk(join(root, dir));
const skills = new Set();
const agents = new Set(readdirSync(join(root, "agents")).map((name) => name.replace(/\.md$/, "")));
for (const path of files) {
  const text = readFileSync(path, "utf8");
  const label = relative(root, path);
  const fail = (message) => problems.push(`${label}: ${message}`);
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(text)) fail("unresolved conflict");
  if (path.endsWith("SKILL.md") || /^(agents|commands)\//.test(label)) {
    const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    try {
      if (!front) throw new Error("missing frontmatter");
      const data = Bun.YAML.parse(front[1]);
      if (typeof data.description !== "string" || data.description.length < 1 || data.description.length > 1024) fail("invalid description");
      if (path.endsWith("SKILL.md")) {
        const name = data.name;
        if (typeof name !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64 || dirname(path).split("/").at(-1) !== name) fail("invalid skill name");
        if (skills.has(name)) fail("duplicate skill name");
        skills.add(name);
        for (const key of Object.keys(data)) if (!["name", "description", "license", "compatibility", "metadata"].includes(key)) fail(`unsupported skill field ${key}`);
      } else if (label.startsWith("agents/")) {
        if (data.mode !== "subagent") fail("agent must be a subagent");
        if (data.model && !data.model.includes("/")) fail("model needs provider prefix");
      }
      if (/^(agents|commands)\//.test(label) && (typeof data.model !== "string" || !/^[a-z0-9-]+\/.+/.test(data.model))) fail("pstack roles must explicitly pin a provider/model");
    } catch (error) {
      fail(`frontmatter: ${error.message}`);
    }
  }
  if (/\.cursor\/|generalPurpose|run_in_background|cloud_base_branch|allow_multiple|`\/loop`|`\/goal`|disable-model-invocation:/.test(text)) fail("Cursor-only instruction");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || target === "url" || /^(https?:|mailto:|\/)/.test(target) || /[<>*]/.test(target)) continue;
    if (!existsSync(resolve(dirname(path), target))) fail(`broken link ${target}`);
  }
  for (const match of text.matchAll(/`((?:references|playbooks)\/[\w./-]+\.(?:md|ts|mjs|sh))`/g)) {
    const skillRoot = label.startsWith("skills/") ? join(root, "skills", label.split("/")[1]) : null;
    if (!existsSync(resolve(dirname(path), match[1])) && !(skillRoot && existsSync(resolve(skillRoot, match[1])))) fail(`missing reference ${match[1]}`);
  }
  for (const match of text.matchAll(/subagent_type(?::\s*|`:\s*`)["`]?([a-z][a-z-]+)/g)) {
    if (!agents.has(match[1]) && !["general", "explore"].includes(match[1])) fail(`unknown agent ${match[1]}`);
  }
}
const mode = readFileSync(join(root, "skills/poteto-mode/SKILL.md"), "utf8");
for (const name of skills) {
  if (name.startsWith("principle-") && !mode.includes(`**${name}**`)) problems.push(`principle missing from index: ${name}`);
}
for (const name of readdirSync(join(root, "skills/poteto-mode/playbooks"))) {
  if (name.endsWith(".md") && !mode.includes(`playbooks/${name}`)) problems.push(`playbook missing from index: ${name}`);
}
console.log(`${skills.size} skills, ${agents.size} agents, ${readdirSync(join(root, "skills/poteto-mode/playbooks")).length} playbooks`);
for (const problem of problems) console.error(problem);
console.log(`${problems.length} problems`);
process.exitCode = problems.length ? 1 : 0;
