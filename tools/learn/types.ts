export type CapabilityId = `skill:${string}` | `playbook:${string}`;

export type CapabilityKind = "skill" | "principle" | "playbook";

export interface Capability {
  id: CapabilityId;
  kind: CapabilityKind;
  name: string;
  summary: string;
  sourcePath: string;
  sourceDir?: string;
  invocation: string;
  whyTry: string;
}

export interface CatalogResult {
  capabilities: Capability[];
  warnings: string[];
  root: string;
  generatedAt: string;
}

export type WindowKind = "7" | "30" | "all";

export interface LearnOptions {
  cwd: string;
  projectPath?: string;
  allProjects: boolean;
  includeSubagents: boolean;
  window: WindowKind;
  dbPath?: string;
  catalogRoot?: string;
  json: boolean;
  snapshot: boolean;
  help: boolean;
}

export interface Count {
  invokes: number;
  loads: number;
  reads: number;
}

export interface ObservedEvidence {
  kind: "observed";
  count: Count;
  lastSeenAt: string;
  lastSessionId: string;
  lastSessionParent: boolean;
  recentExamples?: RecentExample[];
}

export interface RecentExample {
  kind: "invoke" | "load" | "read";
  at: string;
  sessionId: string;
  sessionTitle: string;
  directory: string;
  isSubagent: boolean;
  action: string;
  partId?: string;
  messageId?: string;
  skillDir?: string;
  skillName?: string;
}

export interface ContextMessage {
  id: string;
  role: "user" | "assistant";
  at: string;
  text: string;
  relation: "request" | "before" | "invocation" | "after";
  truncated: boolean;
}

export type ExampleContext =
  | {
      kind: "available";
      example: RecentExample;
      messages: ContextMessage[];
      action: string;
      warnings: string[];
    }
  | { kind: "unavailable"; reason: string };

export interface NotObservedEvidence {
  kind: "not-observed";
  count: Count;
}

export interface UnknownEvidence {
  kind: "unknown";
  count: Count;
}

export type CapabilityEvidence =
  | ObservedEvidence
  | NotObservedEvidence
  | UnknownEvidence;

export interface CapabilityObservation {
  capabilityId: CapabilityId;
  evidence: CapabilityEvidence;
}

export interface AvailableHistoryResult {
  kind: "available";
  observations: CapabilityObservation[];
  sessionCount: number;
  oldestSessionAt?: string | undefined;
  readAt: string;
  durationMs: number;
  warnings: string[];
}

export interface UnavailableHistoryResult {
  kind: "unavailable";
  reason: string;
  readAt: string;
  durationMs: number;
  warnings: string[];
}

export type HistoryResult = AvailableHistoryResult | UnavailableHistoryResult;

export interface SnapshotResult {
  catalog: CatalogResult;
  history: HistoryResult;
  observations: CapabilityObservation[];
  options: {
    scope: "project" | "all-projects";
    window: WindowKind;
    includeSubagents: boolean;
    projectPath?: string | undefined;
    dbPath?: string | undefined;
  };
}

export const WINDOW_DAYS: Record<WindowKind, number | undefined> = {
  "7": 7,
  "30": 30,
  all: undefined,
};

export function stripControlAndAnsi(input: string): string {
  return input
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "")
    .trim();
}

export function shortText(input: string, fallback: string): string {
  const clean = stripControlAndAnsi(input);
  if (!clean) {
    return fallback;
  }
  return clean.length > 220 ? `${clean.slice(0, 217)}...` : clean;
}

export function toIso(value: number): string {
  return new Date(value).toISOString();
}

export function parseEventTime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 10_000_000_000) {
      return Math.floor(value * 1000);
    }
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return parseEventTime(asNumber);
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}
