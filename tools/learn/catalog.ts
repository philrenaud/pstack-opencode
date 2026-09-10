import { readdir, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { file } from "bun";
import {
  type Capability,
  type CatalogResult,
  shortText,
  stripControlAndAnsi,
} from "./types";

const CURATED_SKILL_INVOCATIONS: Record<string, { invocation: string; whyTry: string }> = {
  architect: {
    invocation: "Use the architect skill to sketch types, signatures, and structure before implementation.",
    whyTry: "It settles shape decisions before code churn starts.",
  },
  arena: {
    invocation: "Use the arena skill to run competing candidates and graft the strongest parts.",
    whyTry: "It compares approaches under the same task quickly.",
  },
  "automate-me": {
    invocation: "Use the automate-me skill to capture your working preferences into a reusable skill.",
    whyTry: "It turns repeated guidance into durable automation.",
  },
  "blast-radius": {
    invocation: "Use the blast-radius skill to check what a change could break and prove safety with real runs.",
    whyTry: "It finds impact outside the current diff.",
  },
  bro: {
    invocation: "Use bro to restate your last answer in plain language.",
    whyTry: "It removes jargon so intent is easy to validate.",
  },
  "create-verification-skill": {
    invocation: "Use the create-verification-skill skill to generate a project-local verification workflow.",
    whyTry: "It gives you a repeatable proof path for behavior.",
  },
  "figure-it-out": {
    invocation: "Use the figure-it-out skill to design an auditable playbook for large or ambiguous work.",
    whyTry: "It adds structure when no narrower workflow fits.",
  },
  how: {
    invocation: "Use the how skill to understand runtime flow, ownership, and subsystem behavior.",
    whyTry: "It prevents changes based on wrong mental models.",
  },
  interrogate: {
    invocation: "Use the interrogate skill for adversarial multi-model review before shipping.",
    whyTry: "It pressure tests blind spots in design and implementation.",
  },
  "maintain-verification-skill": {
    invocation: "Use the maintain-verification-skill skill to audit and correct an existing verify skill.",
    whyTry: "It keeps verification coverage aligned with real features.",
  },
  "no-comments": {
    invocation: "Use the no-comments skill to remove weak comments and preserve only non-obvious why comments.",
    whyTry: "It tightens reader focus around executable truth.",
  },
  "poteto-mode": {
    invocation: "/poteto-mode <task>.",
    whyTry: "It enforces consistent high-discipline defaults.",
  },
  recall: {
    invocation: "Use the recall skill to reconstruct recent context before resuming work.",
    whyTry: "It restores continuity without guessing.",
  },
  reflect: {
    invocation: "Use the reflect skill to review the transcript and route learnings into concrete skill edits.",
    whyTry: "It converts mistakes into durable process improvements.",
  },
  "setup-pstack": {
    invocation: "Use the setup-pstack skill to configure pstack model routing by role.",
    whyTry: "It aligns model choices with task types.",
  },
  "show-me-your-work": {
    invocation: "Use the show-me-your-work skill to keep a decision trail for long-running or unattended work.",
    whyTry: "It leaves auditable evidence for later review.",
  },
  swarm: {
    invocation: "Use the swarm skill to fan out parallel workers and return one consolidated report.",
    whyTry: "It accelerates broad coverage tasks.",
  },
  tdd: {
    invocation: "Use the tdd skill when a failing test or cheap local regression test should drive the fix.",
    whyTry: "It pins behavior before implementation changes.",
  },
  teach: {
    invocation: "Use the teach skill to explain a subsystem or change so a teammate can truly understand it.",
    whyTry: "It clarifies both behavior and rationale.",
  },
  "technical-writing": {
    invocation: "Use the technical-writing skill for docs, RFCs, readmes, PR descriptions, and commit messages.",
    whyTry: "It improves clarity and consistency in written artifacts.",
  },
  "typescript-best-practices": {
    invocation: "Use the typescript-best-practices skill when editing TypeScript and shaping domain-safe types.",
    whyTry: "It catches unsafe typing patterns early.",
  },
  unslop: {
    invocation: "Use the unslop skill to remove weak AI prose patterns from any writing surface.",
    whyTry: "It makes output easier for humans to trust.",
  },
  why: {
    invocation: "Use the why skill to gather evidence-backed rationale for design choices and regressions.",
    whyTry: "It grounds decisions in traceable evidence.",
  },
};

const CURATED_PLAYBOOKS: Record<string, { invocation: string; whyTry: string }> = {
  "autonomous-run": {
    invocation:
      "/poteto-mode Use the autonomous-run playbook to complete <task> until <completion-predicate> is true.",
    whyTry: "It keeps unattended execution structured and resumable.",
  },
  "autopilot-full": {
    invocation:
      "/poteto-mode Use the autopilot-full playbook to ship <queue>. You have full authority to push, open PRs, and merge after checks pass.",
    whyTry: "It coordinates one-owner-per-PR execution at scale.",
  },
  "autopilot-stack": {
    invocation:
      "/poteto-mode Use the autopilot-stack playbook to build and open <stack>. I remain merge owner unless I grant full merge authority.",
    whyTry: "It builds a merge-ready stack while preserving operator-controlled landing.",
  },
  "authoring-a-skill": {
    invocation: "/poteto-mode Use the authoring-a-skill playbook to draft or revise <skill>/SKILL.md.",
    whyTry: "It keeps skill behavior explicit and reusable.",
  },
  babysit: {
    invocation:
      "/poteto-mode Use the babysit playbook to get <pr-or-stack> merge-ready by resolving checks, review threads, and conflicts.",
    whyTry: "It keeps merge-frontier work deterministic.",
  },
  "bug-fix": {
    invocation: "/poteto-mode Use the bug-fix playbook to fix <bug>. Reproduce it first and verify the fix.",
    whyTry: "It avoids patching symptoms without proof.",
  },
  eval: {
    invocation: "/poteto-mode Use the eval playbook to compare <candidate-a> vs <candidate-b> on <metric>.",
    whyTry: "It validates process changes before promotion.",
  },
  feature: {
    invocation: "/poteto-mode Use the feature playbook to implement <feature> from a named data shape.",
    whyTry: "It keeps implementation tied to explicit domain modeling.",
  },
  hillclimb: {
    invocation: "/poteto-mode Use the hillclimb playbook to improve <metric> from <baseline> to <target>.",
    whyTry: "It turns optimization into a controlled loop.",
  },
  investigation: {
    invocation: "/poteto-mode Use the investigation playbook to answer <question> with citations and no code changes.",
    whyTry: "It prevents coding when evidence alone can decide.",
  },
  "multi-phase-plan": {
    invocation: "/poteto-mode Use the multi-phase-plan playbook to sequence <initiative> into verifiable phases.",
    whyTry: "It aligns dependencies, verification, and handoff structure.",
  },
  "opening-a-pr": {
    invocation: "/poteto-mode Use the opening-a-pr playbook to prepare and open <pr> with a review-ready description.",
    whyTry: "It standardizes final handoff quality.",
  },
  orchestrate: {
    invocation:
      "/poteto-mode Use the orchestrate playbook to run <program> with explicit worker loops and checkpoints.",
    whyTry: "It manages large programs with explicit control loops.",
  },
  "pause-safely": {
    invocation: "/poteto-mode Use the pause-safely playbook to checkpoint <in-flight-work> for resume tomorrow.",
    whyTry: "It prevents state loss during interruptions.",
  },
  "perf-issue": {
    invocation:
      "/poteto-mode Use the perf-issue playbook to diagnose <slow-path> and improve it from <baseline> to <target>.",
    whyTry: "It keeps performance fixes tied to baseline and outcome.",
  },
  prototype: {
    invocation: "/poteto-mode Use the prototype playbook to compare <option-a> and <option-b> with throwaway experiments.",
    whyTry: "It replaces speculation with cheap observed evidence.",
  },
  refactoring: {
    invocation:
      "/poteto-mode Use the refactoring playbook to restructure <module> without changing behavior and prove parity.",
    whyTry: "It improves structure without drifting contract.",
  },
  "runtime-forensics": {
    invocation: "/poteto-mode Use the runtime-forensics playbook to diagnose live symptom <symptom> with instrumentation.",
    whyTry: "It isolates runtime pathologies with direct observation.",
  },
  "session-pickup": {
    invocation: "/poteto-mode Use the session-pickup playbook to resume <work-item> from the last handoff.",
    whyTry: "It restores context and ownership safely.",
  },
  shipping: {
    invocation:
      "/poteto-mode Use the shipping playbook to independently verify <stack> is green and land it safely.",
    whyTry: "It separates merge readiness from merge safety.",
  },
  "trace-forensics": {
    invocation:
      "/poteto-mode Use the trace-forensics playbook to analyze <trace-artifact> and report the root cause.",
    whyTry: "It extracts root causes from fixed datasets.",
  },
  "visual-parity": {
    invocation:
      "/poteto-mode Use the visual-parity playbook to make <new-ui> match <reference-ui> with pixel-level checks.",
    whyTry: "It keeps UI migrations aligned with observed output.",
  },
  "worktree-cleanup": {
    invocation:
      "/poteto-mode Use the worktree-cleanup playbook to prune stale worktrees and simulators and reclaim disk.",
    whyTry: "It reduces local environment drift and storage pressure.",
  },
};

function defaultCatalogRoot(): string {
  return resolve(import.meta.dir, "../..");
}

function getFrontmatter(text: string): { yaml?: string; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { body: text };
  }
  const yaml = match[1];
  if (typeof yaml !== "string") {
    return { body: text };
  }
  return {
    yaml,
    body: text.slice(match[0].length),
  };
}

function parseSimpleYamlObject(yaml: string): Record<string, unknown> {
  const parsed: unknown = (Bun as unknown as { YAML: { parse: (input: string) => unknown } }).YAML.parse(yaml);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("yaml-root-not-object");
  }
  return parsed as Record<string, unknown>;
}

function firstHeading(body: string): string | undefined {
  let inFence = false;
  let fenceChar: "`" | "~" | undefined;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    const fence = line.match(/^(```+|~~~+)/);
    if (fence) {
      const marker = fence[1]?.[0];
      if (!inFence && (marker === "`" || marker === "~")) {
        inFence = true;
        fenceChar = marker;
      } else if (inFence && marker === fenceChar) {
        inFence = false;
        fenceChar = undefined;
      }
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match?.[1]) {
      return stripControlAndAnsi(match[1]);
    }
  }
  return undefined;
}

function firstParagraph(body: string): string | undefined {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const collected: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("#") || line.startsWith("- ")) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }
    collected.push(line);
    if (collected.join(" ").length > 260) {
      break;
    }
  }
  if (collected.length === 0) {
    return undefined;
  }
  return stripControlAndAnsi(collected.join(" "));
}

async function readCatalogFile(path: string): Promise<string> {
  return await file(path).text();
}

async function canonicalPath(path: string): Promise<string> {
  if (!(await file(path).exists())) {
    return resolve(path);
  }
  return await realpath(path);
}

function parseIndexSummaries(skillBody: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = skillBody.split(/\r?\n/);
  const regex = /`playbooks\/([^`]+)\.md`/;
  for (const line of lines) {
    const found = line.match(regex);
    if (!found?.[1]) {
      continue;
    }
    const slug = found[1];
    const clean = line
      .replace(/^\s*[-*]\s*/, "")
      .replace(/`playbooks\/[^`]+\.md`\.?/, "")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .replace(/([.!?])\s+\./g, "$1")
      .trim();
    const summary = stripControlAndAnsi(clean);
    if (summary) {
      out.set(slug, shortText(summary, ""));
    }
  }
  return out;
}

function genericSkillInvocation(name: string): string {
  return `Use the ${name} skill to <task>.`;
}

function genericPlaybookInvocation(name: string): string {
  return `/poteto-mode Use the ${name} playbook to complete <task>.`;
}

export async function discoverCatalog(catalogRoot?: string): Promise<CatalogResult> {
  const warnings: string[] = [];
  const root = catalogRoot ? resolve(catalogRoot) : defaultCatalogRoot();
  const capabilities: Capability[] = [];
  const skillsDir = join(root, "skills");
  let skillEntries: Array<{ isDirectory: () => boolean; name: string }> = [];
  try {
    skillEntries = await readdir(skillsDir, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read skills directory ${skillsDir}: ${message}`);
  }

  let playbookIndex = new Map<string, string>();
  const potetoSkillPath = join(skillsDir, "poteto-mode", "SKILL.md");
  try {
    const potetoText = await readCatalogFile(potetoSkillPath);
    playbookIndex = parseIndexSummaries(potetoText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Could not read ${potetoSkillPath} for playbook summary index: ${message}.`);
  }

  for (const entry of skillEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const slug = entry.name;
    const skillPath = join(skillsDir, slug, "SKILL.md");
    try {
      if (!(await file(skillPath).exists())) {
        continue;
      }
      const skillStats = await stat(skillPath);
      if (!skillStats.isFile()) {
        throw new Error("not-a-file");
      }
      const sourcePath = await canonicalPath(skillPath);
      const text = await readCatalogFile(skillPath);
      const parsed = getFrontmatter(text);
      let yamlName: string | undefined;
      let yamlDescription: string | undefined;
      if (parsed.yaml) {
        try {
          const parsedYaml = parseSimpleYamlObject(parsed.yaml);
          if (typeof parsedYaml.name === "string") {
            yamlName = stripControlAndAnsi(parsedYaml.name);
          }
          if (typeof parsedYaml.description === "string") {
            yamlDescription = stripControlAndAnsi(parsedYaml.description);
          }
        } catch {
          warnings.push(`Malformed YAML in ${skillPath}.`);
        }
      }
      const heading = firstHeading(parsed.body);
      const summary = shortText(yamlDescription ?? firstParagraph(parsed.body) ?? "", `${slug} skill metadata discovered.`);
      const kind = slug.startsWith("principle-") ? "principle" : "skill";
      const title = yamlName ?? heading ?? slug;
      const curated = CURATED_SKILL_INVOCATIONS[slug];
      const invocation =
        kind === "principle"
          ? `Use the ${title} principle when reviewing <code or design>.`
          : curated?.invocation ?? genericSkillInvocation(title);
      capabilities.push({
        id: `skill:${slug}`,
        kind,
        name: title,
        summary,
        sourcePath,
        sourceDir: dirname(sourcePath),
        invocation,
        whyTry:
          kind === "principle"
            ? `This principle gives a reusable review lens for ${title.toLowerCase()}.`
            : curated?.whyTry ?? "It gives you a reusable workflow for similar tasks.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Could not process ${skillPath}: ${message}.`);
    }
  }

  const playbooksDir = join(skillsDir, "poteto-mode", "playbooks");
  let playbookEntries: Array<{ isFile: () => boolean; name: string }> = [];
  try {
    playbookEntries = await readdir(playbooksDir, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Could not read playbooks directory ${playbooksDir}: ${message}.`);
  }

  for (const entry of playbookEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const slug = entry.name.slice(0, -3);
    const playbookPath = join(playbooksDir, entry.name);
    try {
      const sourcePath = await canonicalPath(playbookPath);
      const text = await readCatalogFile(playbookPath);
      const heading = firstHeading(text) ?? slug;
      const fallbackSummary = firstParagraph(text) ?? `${heading} playbook.`;
      const summary = shortText(playbookIndex.get(slug) ?? fallbackSummary, `${heading} playbook.`);
      const curated = CURATED_PLAYBOOKS[slug];
      capabilities.push({
        id: `playbook:${slug}`,
        kind: "playbook",
        name: heading,
        summary,
        sourcePath,
        invocation: curated?.invocation ?? genericPlaybookInvocation(slug),
        whyTry: curated?.whyTry ?? "It gives a deterministic sequence for this task class.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Could not process ${playbookPath}: ${message}.`);
    }
  }

  capabilities.sort((a, b) => a.name.localeCompare(b.name));
  return {
    capabilities,
    warnings,
    root,
    generatedAt: new Date().toISOString(),
  };
}
