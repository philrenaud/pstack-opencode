import { join } from "node:path";
import { chmodSync, rmSync } from "node:fs";
import { test, expect } from "bun:test";
import { discoverCatalog } from "./catalog";
import { makeTempDir, makeCatalogFixture, write } from "./test-helpers";

test("discovers skills, principles, playbooks and strips control chars", async () => {
  const root = makeTempDir("learn-catalog-");
  makeCatalogFixture(root);
  write(
    join(root, "skills/control/SKILL.md"),
    `---
name: control\u001b[31m-name
description: desc with \u001b[32m ansi
---

# Ctl\u0007 Name
`,
  );

  const catalog = await discoverCatalog(root);
  const ids = catalog.capabilities.map((c) => c.id);
  expect(ids).toContain("skill:how");
  expect(ids).toContain("skill:architect");
  expect(ids).toContain("skill:principle-model-the-domain");
  expect(ids).toContain("playbook:feature");

  const control = catalog.capabilities.find((c) => c.id === "skill:control");
  expect(control?.name.includes("\u001b")).toBeFalse();
  expect(control?.summary.includes("\u001b")).toBeFalse();
});

test("malformed yaml warns and continues", async () => {
  const root = makeTempDir("learn-catalog-yaml-");
  makeCatalogFixture(root);
  write(
    join(root, "skills/bad/SKILL.md"),
    `---
name: bad
description: [unterminated
---

# Bad
`,
  );

  const catalog = await discoverCatalog(root);
  expect(catalog.capabilities.some((c) => c.id === "skill:bad")).toBeTrue();
  expect(catalog.warnings.some((w) => w.includes("Malformed YAML"))).toBeTrue();
});

test("dynamic catalog additions appear automatically", async () => {
  const root = makeTempDir("learn-catalog-dynamic-");
  makeCatalogFixture(root);
  let catalog = await discoverCatalog(root);
  expect(catalog.capabilities.some((c) => c.id === "skill:new-skill")).toBeFalse();

  write(
    join(root, "skills/new-skill/SKILL.md"),
    `---
name: new-skill
description: brand new.
---

# New skill
`,
  );
  catalog = await discoverCatalog(root);
  expect(catalog.capabilities.some((c) => c.id === "skill:new-skill")).toBeTrue();
});

test("first heading ignores fenced markdown headings and accepts h1-h6", async () => {
  const root = makeTempDir("learn-catalog-heading-");
  makeCatalogFixture(root);
  write(
    join(root, "skills/fenced-heading/SKILL.md"),
    "```md\n# Program plan\n```\n\n### Real Heading\n\nSummary text.\n",
  );

  const catalog = await discoverCatalog(root);
  const item = catalog.capabilities.find((c) => c.id === "skill:fenced-heading");
  expect(item?.name).toBe("Real Heading");
});

test("playbook invocations use poteto-mode and curated text", async () => {
  const root = makeTempDir("learn-catalog-invocations-");
  makeCatalogFixture(root);
  write(
    join(root, "skills/poteto-mode/playbooks/custom-flow.md"),
    `### Custom flow\n\nDo custom work.\n`,
  );

  const catalog = await discoverCatalog(root);
  const playbooks = catalog.capabilities.filter((c) => c.kind === "playbook");
  for (const item of playbooks) {
    expect(item.invocation.startsWith("/poteto-mode Use the ")).toBeTrue();
  }
  const bugFix = catalog.capabilities.find((c) => c.id === "playbook:bug-fix");
  expect(bugFix?.invocation).toBe(
    "/poteto-mode Use the bug-fix playbook to fix <bug>. Reproduce it first and verify the fix.",
  );
  const custom = catalog.capabilities.find((c) => c.id === "playbook:custom-flow");
  expect(custom?.invocation).toBe("/poteto-mode Use the custom-flow playbook to complete <task>.");

  const potetoMode = catalog.capabilities.find((c) => c.id === "skill:poteto-mode");
  expect(potetoMode?.invocation).toBe("/poteto-mode <task>.");
});

test("supports CRLF yaml block scalars and warns on malformed yaml", async () => {
  const root = makeTempDir("learn-catalog-crlf-");
  makeCatalogFixture(root);
  write(
    join(root, "skills/crlf/SKILL.md"),
    "---\r\nname: crlf\r\ndescription: |\r\n  line one\r\n  line two\r\n---\r\n\r\n### CRLF heading\r\n",
  );
  write(
    join(root, "skills/yaml-bad/SKILL.md"),
    "---\nname: yaml-bad\ndescription: [unterminated\n---\n\n### Yaml bad\n",
  );

  const catalog = await discoverCatalog(root);
  const crlf = catalog.capabilities.find((c) => c.id === "skill:crlf");
  expect(crlf?.summary.includes("line one")).toBeTrue();
  expect(crlf?.summary.includes("line two")).toBeTrue();
  expect(catalog.warnings.some((w) => w.includes("Malformed YAML in") && w.includes("yaml-bad"))).toBeTrue();
});

test("warns per-file filesystem errors and missing playbooks directory", async () => {
  const root = makeTempDir("learn-catalog-fs-");
  makeCatalogFixture(root);
  const brokenSkillPath = join(root, "skills/broken/SKILL.md");
  write(brokenSkillPath, "# Broken\n");
  chmodSync(brokenSkillPath, 0o000);
  rmSync(join(root, "skills/poteto-mode/playbooks"), { recursive: true, force: true });

  const catalog = await discoverCatalog(root);
  chmodSync(brokenSkillPath, 0o644);
  expect(catalog.capabilities.some((c) => c.id === "skill:how")).toBeTrue();
  expect(catalog.warnings.some((w) => w.includes("Could not process") && w.includes("broken"))).toBeTrue();
  expect(catalog.warnings.some((w) => w.includes("Could not read playbooks directory"))).toBeTrue();
});
