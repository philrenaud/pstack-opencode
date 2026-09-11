import { resolve } from "node:path";

export interface InvocationCandidate {
  prefix: string;
  footer: string | undefined;
}

export interface KnownSkill {
  slug: string;
  name: string;
  sourceDir: string;
}

export interface RecognizedInvocation {
  slug: string;
  form: "raw" | "expanded";
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function recognizeInvocation(
  candidate: InvocationCandidate,
  skills: readonly KnownSkill[],
): RecognizedInvocation | undefined {
  const raw = candidate.prefix.match(/^\/([a-z0-9][a-z0-9-]*)(?=\s|$)/);
  if (raw?.[1] && skills.some((skill) => skill.slug === raw[1])) {
    return { slug: raw[1], form: "raw" };
  }

  const heading = candidate.prefix.match(/^#\s+([^\r\n]+)\r?\n/);
  if (!heading?.[1] || !candidate.footer) return undefined;
  const baseDirectory = candidate.footer.match(
    /(?:^|\n)Base directory for this skill:\s*([^\r\n]+)(?:\r?\n|$)/,
  )?.[1];
  if (!baseDirectory) return undefined;
  const directory = resolve(baseDirectory.trim());
  const normalizedHeading = normalizedName(heading[1]);
  const skill = skills.find(
    (item) => resolve(item.sourceDir) === directory &&
      (normalizedName(item.name) === normalizedHeading || normalizedName(item.slug) === normalizedHeading),
  );
  return skill ? { slug: skill.slug, form: "expanded" } : undefined;
}

export function stripExpandedInvocation(text: string, skill: KnownSkill): string | undefined {
  const recognized = recognizeInvocation({ prefix: text.slice(0, 256), footer: text }, [skill]);
  if (recognized?.form !== "expanded") return undefined;
  const footerStart = text.indexOf("\nBase directory for this skill:");
  const relativeStart = text.indexOf("\nRelative paths in this skill", footerStart);
  const taskStart = text.indexOf("\n\n", relativeStart);
  if (footerStart < 0 || relativeStart < 0 || taskStart < 0) return undefined;
  const task = text.slice(taskStart + 2).trim();
  return task || undefined;
}
