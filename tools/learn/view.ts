import { basename } from "node:path";
import { stringWidth } from "bun";
import type { Capability, CapabilityObservation, HistoryResult, SnapshotResult, SortDirection, SortKey, WindowKind } from "./types";
import { stripControlAndAnsi } from "./types";

export type CategoryTab = "all" | "skills" | "playbooks" | "principles";
export type FocusPane = "list" | "detail" | "examples" | "context";

export interface UiState {
  selected: number;
  listOffset: number;
  detailOffset: number;
  category: CategoryTab;
  hideObserved: boolean;
  search: string;
  searching: boolean;
  focus: FocusPane;
  examplesReturnFocus: "list" | "detail";
  narrowDetail: boolean;
  help: boolean;
  allProjects: boolean;
  includeSubagents: boolean;
  window: WindowKind;
  status?: string;
  examplesOffset: number;
  exampleIndex: number;
  sortKey: SortKey;
  sortDirection: SortDirection;
}

export interface CapWithObservation {
  capability: Capability;
  observation: CapabilityObservation | undefined;
}

const TRY_NEXT_ORDER: ReadonlyArray<string> = [
  "skill:how", "skill:architect", "skill:figure-it-out", "skill:swarm", "skill:interrogate",
  "skill:show-me-your-work", "skill:create-verification-skill", "playbook:investigation",
  "playbook:feature", "playbook:bug-fix", "playbook:prototype", "playbook:refactoring",
  "playbook:perf-issue", "playbook:runtime-forensics", "playbook:trace-forensics",
  "playbook:multi-phase-plan", "playbook:autonomous-run", "playbook:orchestrate",
  "playbook:babysit", "playbook:shipping",
];

export function createInitialState(): UiState {
  return {
    selected: 0, listOffset: 0, detailOffset: 0, category: "all", hideObserved: false,
    search: "", searching: false, focus: "list", examplesReturnFocus: "list", narrowDetail: false, help: false,
    allProjects: false, includeSubagents: false, window: "30",
    examplesOffset: 0, exampleIndex: 0, sortKey: "name", sortDirection: "asc",
  };
}

export function recentExamplesFor(item: CapWithObservation | undefined): import("./types").RecentExample[] {
  if (item?.observation?.evidence.kind === "observed") {
    return item.observation.evidence.recentExamples ?? [];
  }
  return [];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function isSplitLayout(width: number): boolean {
  return width >= 100;
}

export function listVisibleRows(height: number): number {
  return Math.max(1, Math.floor((height - 9) / 2));
}

function paneDimensions(width: number, height: number): {
  lineWidth: number;
  split: boolean;
  bodyHeight: number;
  leftWidth: number;
  rightWidth: number;
} {
  const lineWidth = Math.max(0, width - 1);
  const split = isSplitLayout(width);
  const bodyHeight = Math.max(1, height - 8);
  if (!split) {
    return { lineWidth, split, bodyHeight, leftWidth: lineWidth, rightWidth: lineWidth };
  }
  const leftWidth = Math.min(clamp(Math.floor(lineWidth * 0.48), 43, 64), Math.max(43, lineWidth - 41));
  return {
    lineWidth,
    split,
    bodyHeight,
    leftWidth,
    rightWidth: lineWidth - leftWidth - 1,
  };
}

function kindMatches(tab: CategoryTab, kind: Capability["kind"]): boolean {
  return tab === "all" || (tab === "skills" && kind === "skill") ||
    (tab === "playbooks" && kind === "playbook") || (tab === "principles" && kind === "principle");
}

function searchable(capability: Capability): string {
  return `${capability.name} ${capability.summary} ${capability.invocation}`.toLowerCase();
}

export function filterCapabilities(snapshot: SnapshotResult, state: UiState): CapWithObservation[] {
  const byId = new Map(snapshot.observations.map((observation) => [observation.capabilityId, observation]));
  const query = state.search.trim().toLowerCase();
  const filtered = snapshot.catalog.capabilities
    .map((capability) => ({ capability, observation: byId.get(capability.id) }))
    .filter(({ capability, observation }) => kindMatches(state.category, capability.kind) &&
      (!state.hideObserved || observation?.evidence.kind === "not-observed") &&
      (!query || searchable(capability).includes(query)));
  return sortCapabilities(filtered, state.sortKey, state.sortDirection);
}

export function totalObservations(item: CapWithObservation): number | undefined {
  if (item.observation?.evidence.kind === "unknown" || !item.observation) return undefined;
  const { invokes, loads, reads } = item.observation.evidence.count;
  return invokes + loads + reads;
}

function numericSortValue(item: CapWithObservation, key: Exclude<SortKey, "name" | "last-used">): number | undefined {
  if (item.observation?.evidence.kind === "unknown" || !item.observation) return undefined;
  if (key === "usage") return totalObservations(item);
  return item.observation.evidence.count[key];
}

function lastUsedValue(item: CapWithObservation): number | undefined {
  if (item.observation?.evidence.kind !== "observed") return undefined;
  const value = Date.parse(item.observation.evidence.lastSeenAt);
  return Number.isNaN(value) ? undefined : value;
}

function tieBreak(a: CapWithObservation, b: CapWithObservation): number {
  return a.capability.name.localeCompare(b.capability.name) || a.capability.id.localeCompare(b.capability.id);
}

export function sortCapabilities(items: readonly CapWithObservation[], key: SortKey, direction: SortDirection): CapWithObservation[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (key === "name") return multiplier * tieBreak(a, b);
    const aValue = key === "last-used" ? lastUsedValue(a) : numericSortValue(a, key);
    const bValue = key === "last-used" ? lastUsedValue(b) : numericSortValue(b, key);
    if (aValue === undefined || bValue === undefined) {
      if (aValue === undefined && bValue === undefined) return tieBreak(a, b);
      return aValue === undefined ? 1 : -1;
    }
    return aValue === bValue ? tieBreak(a, b) : multiplier * (aValue - bValue);
  });
}

export function observationBarWidth(total: number | undefined, maximum: number, width: number): number | undefined {
  if (total === undefined) return undefined;
  if (total <= 0 || maximum <= 0 || width <= 0) return 0;
  return Math.max(1, Math.min(width, Math.round((total / maximum) * width)));
}

export function sortLabel(key: SortKey): string {
  return key === "last-used" ? "Last used" : key === "usage" ? "Usage" : key[0]!.toUpperCase() + key.slice(1);
}

function columnLabel(label: string, key: SortKey, state: UiState): string {
  return `${label}${state.sortKey === key ? state.sortDirection === "asc" ? "↑" : "↓" : ""}`;
}

export function suggestion(snapshot: SnapshotResult): Capability | undefined {
  const byId = new Map(snapshot.observations.map((observation) => [observation.capabilityId, observation]));
  const eligible = (capability: Capability): boolean => byId.get(capability.id)?.evidence.kind === "not-observed";
  for (const id of TRY_NEXT_ORDER) {
    const capability = snapshot.catalog.capabilities.find((item) => item.id === id);
    if (capability && eligible(capability)) return capability;
  }
  return snapshot.catalog.capabilities
    .filter((capability) => capability.kind !== "principle" && eligible(capability))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
}

function clip(text: string, width: number): string {
  if (width <= 0) return "";
  let result = "";
  for (const character of text) {
    if (stringWidth(result + character) > width) break;
    result += character;
  }
  return result;
}

function fit(text: string, width: number): string {
  const safe = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
  const result = clip(safe, Math.max(0, width));
  return result + " ".repeat(Math.max(0, width - stringWidth(result)));
}

function wrap(text: string, width: number): string[] {
  if (width < 1 || !text) return [""];
  const lines: string[] = [];
  let remaining = stripControlAndAnsi(text).replace(/[\r\n\t]/g, " ").trim();
  while (remaining) {
    if (stringWidth(remaining) <= width) {
      lines.push(remaining);
      break;
    }
    const candidate = clip(remaining, width);
    const breakAt = candidate.lastIndexOf(" ");
    const take = breakAt > 0 ? candidate.slice(0, breakAt) : candidate;
    lines.push(take);
    remaining = remaining.slice(take.length).trimStart();
  }
  return lines.length ? lines : [""];
}

function counts(observation?: CapabilityObservation): { invokes: string; loads: string; reads: string; status: string } {
  if (observation?.evidence.kind === "observed") {
    return { invokes: String(observation.evidence.count.invokes), loads: String(observation.evidence.count.loads), reads: String(observation.evidence.count.reads), status: "observed" };
  }
  if (observation?.evidence.kind === "not-observed") return { invokes: "0", loads: "0", reads: "0", status: "not observed" };
  return { invokes: "-", loads: "-", reads: "-", status: "unknown" };
}

function typeBadge(kind: Capability["kind"]): string {
  return kind === "skill" ? "SK" : kind === "playbook" ? "PB" : "PR";
}

function detailLines(item: CapWithObservation, width: number): string[] {
  const contentWidth = Math.max(1, width - 1);
  const add = (label: string, text: string) => {
    const prefix = `${label} `;
    const wrapped = wrap(text, Math.max(1, contentWidth - stringWidth(prefix)));
    lines.push(prefix + (wrapped.shift() ?? ""), ...wrapped.map((line) => " ".repeat(stringWidth(prefix)) + line));
  };
  const lines: string[] = [`[${typeBadge(item.capability.kind)}] ${item.capability.name}`, ""];
  add("INVOKE", item.capability.invocation);
  lines.push("");
  add("WHY", item.capability.whyTry);
  lines.push("");
  add("ABOUT", item.capability.summary);
  const evidence = counts(item.observation);
  lines.push("", `EVIDENCE  ${evidence.status}  invokes ${evidence.invokes}  loads ${evidence.loads}  reads ${evidence.reads}`);
  if (item.observation?.evidence.kind === "observed") {
    lines.push(`LAST USED ${new Date(item.observation.evidence.lastSeenAt).toLocaleString()}`);
  }
  lines.push("");
  add("SOURCE", item.capability.sourcePath);
  return lines;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function scopeLabel(snapshot: SnapshotResult, state: UiState): string {
  if (state.allProjects) return "all projects";
  return basename(snapshot.options.projectPath ?? "current project") || "current project";
}

function evidenceSummary(snapshot: SnapshotResult): string {
  let observed = 0, notObserved = 0, unknown = 0, invokes = 0, loads = 0, reads = 0;
  for (const observation of snapshot.observations) {
    if (observation.evidence.kind === "observed") {
      observed += 1; invokes += observation.evidence.count.invokes; loads += observation.evidence.count.loads; reads += observation.evidence.count.reads;
    } else if (observation.evidence.kind === "not-observed") notObserved += 1;
    else unknown += 1;
  }
  return `${observed} observed (${invokes} invokes, ${loads} loads, ${reads} reads)  ${notObserved} not observed  ${unknown} unknown`;
}

function helpLines(snapshot: SnapshotResult): string[] {
  return [
    "HELP", "", "Navigation", "  j/k or arrows  select       PgUp/PgDn/Home/End  move", "  Enter          examples     Esc                 back/close", "  left/right      focus pane   Ctrl-D/Ctrl-U       half page", "", "Explore", "  / search   Tab category   u show only not observed   n try next", "", "Sort", "  o cycle columns   v reverse   l last used newest", "  1 name  2 invokes  3 loads  4 reads  5 usage  6 last used", "  Bars: total observations · relative to filtered maximum", "", "Evidence", "  invokes = explicit slash requests or recognized expanded requests", "  loads = successful skill tool loads", "  reads = opened exact SKILL.md/playbook path", "  not observed = zero matching evidence in this scope and window", "  unknown = history unavailable; it is never treated as not observed", "", "Scope and actions", "  w window   s project/all   a include subagents   r refresh", "  c copy invocation (never runs it)   p print invocation and exit", "  q or Ctrl-C exit   ? or Esc close help", "", `Database: ${snapshot.options.dbPath ?? "not found"}`, "Evidence types are independent and do not sum to executions.",
  ];
}

export function renderSnapshotText(snapshot: SnapshotResult, width: number, height: number): string[] {
  const state = createInitialState();
  state.allProjects = snapshot.options.scope === "all-projects";
  state.includeSubagents = snapshot.options.includeSubagents;
  state.window = snapshot.options.window;
  state.sortKey = snapshot.options.sortKey ?? "name";
  state.sortDirection = snapshot.options.sortDirection ?? "asc";
  return renderFrame(snapshot, state, width, height);
}

export function detailScrollLimit(snapshot: SnapshotResult, state: UiState, width: number, height: number): number {
  const filtered = filterCapabilities(snapshot, state);
  const selected = filtered[Math.min(state.selected, Math.max(0, filtered.length - 1))];
  if (!selected) return 0;
  const dims = paneDimensions(width, height);
  const paneWidth = dims.split ? dims.rightWidth : dims.lineWidth;
  const visible = dims.split ? listVisibleRows(height) : dims.bodyHeight;
  return Math.max(0, detailLines(selected, paneWidth).length - visible);
}

function exampleType(kind: import("./types").RecentExample["kind"]): string {
  return kind;
}

function examplesLines(item: CapWithObservation, history: HistoryResult, width: number): string[] {
  const contentWidth = Math.max(1, width);
  const lines: string[] = ["RECENT EXAMPLES", ""];
  const add = (label: string, text: string) => {
    const prefix = `${label} `;
    const wrapped = wrap(text, Math.max(1, contentWidth - stringWidth(prefix)));
    lines.push(prefix + (wrapped.shift() ?? ""), ...wrapped.map((line) => " ".repeat(stringWidth(prefix)) + line));
  };
  const addWrapped = (text: string) => lines.push(...wrap(text, contentWidth));
  add("INVOKE", item.capability.invocation);
  lines.push("");
  if (item.observation?.evidence.kind === "observed") {
    const examples = item.observation.evidence.recentExamples ?? [];
    if (examples.length === 0) {
      addWrapped("No recorded examples in this scope and window. Try this invocation:");
      addWrapped(item.capability.invocation);
    } else {
      for (const sample of examples.slice(0, 5)) {
        add("DATE", new Date(sample.at).toLocaleString());
        add("TYPE", exampleType(sample.kind));
        add("CONTEXT", sample.sessionTitle);
        add("PROJECT", sample.directory);
        add("ACTION", sample.action);
        add("SESSION", sample.sessionId);
        add("RESUME", `opencode -s ${sample.sessionId}`);
        lines.push("");
      }
    }
    addWrapped("invoke = explicit or expanded user request; load = successful skill tool load; read = exact file consultation.");
    addWrapped("Consultation only; not proof of completed execution.");
    return lines;
  }
  if (item.observation?.evidence.kind === "not-observed") {
    addWrapped("No recorded examples in this scope and window. Try this invocation:");
    addWrapped(item.capability.invocation);
    lines.push("");
    addWrapped("Consultation only; not proof of completed execution.");
    return lines;
  }
  const reason = history.kind === "unavailable" ? history.reason : "unknown";
  addWrapped(`Examples unavailable because history is unknown (${reason}).`);
  lines.push("");
  addWrapped("Consultation only; not proof of completed execution.");
  return lines;
}

export function examplesScrollLimit(snapshot: SnapshotResult, state: UiState, width: number, height: number): number {
  const filtered = filterCapabilities(snapshot, state);
  const selected = filtered[Math.min(state.selected, Math.max(0, filtered.length - 1))];
  if (!selected) return 0;
  const dims = paneDimensions(width, height);
  return Math.max(0, examplesLines(selected, snapshot.history, dims.lineWidth).length - dims.bodyHeight);
}

export function renderFrame(snapshot: SnapshotResult, state: UiState, width: number, height: number): string[] {
  const dims = paneDimensions(width, height);
  const { lineWidth } = dims;
  if (width < 40 || height < 12) return [fit("resize terminal to 40x12. q quits.", lineWidth)];
  if (state.help) return helpLines(snapshot).slice(0, height).map((line) => fit(line, lineWidth));

  const filtered = filterCapabilities(snapshot, state);
  const selectedIndex = Math.min(state.selected, Math.max(0, filtered.length - 1));
  const selected = filtered[selectedIndex];
  const history = snapshot.history;
  const refreshed = `${formatTime(history.readAt)} in ${history.durationMs}ms`;
  const sessions = history.kind === "available" ? String(history.sessionCount) : "unknown";
  const rows = [
    fit("pstack learn", lineWidth),
    fit(`${scopeLabel(snapshot, state)}  |  ${state.window === "all" ? "all time" : `${state.window} days`}  |  subagents ${state.includeSubagents ? "included" : "excluded"}  |  ${snapshot.catalog.capabilities.length} capabilities`, lineWidth),
    fit(`[${state.category}]  ${evidenceSummary(snapshot)}  sessions ${sessions}`, lineWidth),
  ];
  if (history.kind === "unavailable") rows.push(fit(`HISTORY UNKNOWN: ${history.reason}`, lineWidth));
  else if (history.warnings.length || snapshot.catalog.warnings.length) rows.push(fit(`WARNING: ${[...history.warnings, ...snapshot.catalog.warnings][0]}`, lineWidth));
  else rows.push(fit("Evidence: invokes are user requests; loads and reads are separate consultation evidence.", lineWidth));

  if (state.focus === "examples") {
    const detail = selected ? examplesLines(selected, snapshot.history, lineWidth) : ["No matching capabilities."];
    for (let index = 0; index < dims.bodyHeight; index++) {
      rows.push(fit(detail[state.examplesOffset + index] ?? "", lineWidth));
    }
  } else if (!dims.split && state.narrowDetail) {
    const detail = selected ? detailLines(selected, lineWidth) : ["No matching capabilities."];
    for (let index = 0; index < dims.bodyHeight; index++) rows.push(fit(detail[state.detailOffset + index] ?? "", lineWidth));
  } else if (!dims.split) {
    const primary = state.sortKey === "usage" ? columnLabel("USAGE", "usage", state) : state.sortKey === "last-used" ? columnLabel("LAST USED", "last-used", state) : columnLabel("NAME", "name", state);
    rows.push(fit(`   TYPE ${primary.padEnd(34)} ${columnLabel("INVOKE", "invokes", state).padEnd(7)} ${columnLabel("LOAD", "loads", state).padEnd(5)} ${columnLabel("READ", "reads", state)}`, lineWidth));
    const visible = filtered.slice(state.listOffset, state.listOffset + listVisibleRows(height));
    const maximum = Math.max(0, ...filtered.map((item) => totalObservations(item) ?? 0));
    for (let index = 0; index < listVisibleRows(height); index++) {
      const item = visible[index];
      if (!item) { rows.push(fit("", lineWidth), fit("", lineWidth)); continue; }
      const absolute = state.listOffset + index;
      const evidence = counts(item.observation);
      const nameWidth = Math.max(8, lineWidth - 26);
      rows.push(fit(`${absolute === selectedIndex ? ">" : " "}  ${typeBadge(item.capability.kind)}  ${fit(item.capability.name, nameWidth)} ${evidence.invokes.padStart(6)} ${evidence.loads.padStart(4)} ${evidence.reads.padStart(4)}`, lineWidth));
      const barWidth = observationBarWidth(totalObservations(item), maximum, nameWidth);
      rows.push(fit(`      ${barWidth === undefined ? "? unknown" : "━".repeat(barWidth)}`, lineWidth));
    }
  } else {
    const primary = state.sortKey === "usage" ? columnLabel("USAGE", "usage", state) : state.sortKey === "last-used" ? columnLabel("LAST USED", "last-used", state) : columnLabel("NAME", "name", state);
    rows.push(`${fit(`   TYPE ${primary.padEnd(21)} ${columnLabel("INVOKE", "invokes", state)} ${columnLabel("LOAD", "loads", state)} ${columnLabel("READ", "reads", state)}`, dims.leftWidth)} ${fit("DETAIL", dims.rightWidth)}`);
    const visible = filtered.slice(state.listOffset, state.listOffset + listVisibleRows(height));
    const detail = selected ? detailLines(selected, dims.rightWidth) : ["No matching capabilities."];
    const maximum = Math.max(0, ...filtered.map((item) => totalObservations(item) ?? 0));
    for (let index = 0; index < listVisibleRows(height); index++) {
      const item = visible[index];
      let left = "";
      if (item) {
        const absolute = state.listOffset + index;
        const evidence = counts(item.observation);
        left = `${absolute === selectedIndex ? ">" : " "}  ${typeBadge(item.capability.kind)}  ${fit(item.capability.name, Math.max(8, dims.leftWidth - 24))} ${evidence.invokes.padStart(6)} ${evidence.loads.padStart(4)} ${evidence.reads.padStart(4)}`;
      }
      rows.push(`${fit(left, dims.leftWidth)} ${fit(detail[state.detailOffset + index * 2] ?? "", dims.rightWidth)}`);
      const itemTotal = item ? totalObservations(item) : 0;
      const barWidth = item ? observationBarWidth(itemTotal, maximum, Math.max(8, dims.leftWidth - 24)) : 0;
      rows.push(`${fit(item ? `      ${barWidth === undefined ? "? unknown" : "━".repeat(barWidth)}` : "", dims.leftWidth)} ${fit(detail[state.detailOffset + index * 2 + 1] ?? "", dims.rightWidth)}`);
    }
  }

  const next = suggestion(snapshot);
  rows.push(fit(next ? `Try next: ${next.name}. ${next.whyTry}` : "Try next: no not-observed workflow or playbook in this window.", lineWidth));
  const search = state.searching ? `Search /${state.search}` : state.search ? `Search: ${state.search}` : "? help  / search";
  rows.push(fit(`${search}  |  Sort ${sortLabel(state.sortKey)} ${state.sortDirection === "asc" ? "↑" : "↓"}  o cycle v reverse l recent  1-6 columns`, lineWidth));
  rows.push(fit(`Refreshed ${refreshed}${state.status ? `  |  ${state.status}` : ""}`, lineWidth));
  return rows.slice(0, height);
}

export function historyWarnings(history: HistoryResult): string[] {
  return history.warnings;
}
