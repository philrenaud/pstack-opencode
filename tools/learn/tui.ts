import { spawnSync } from "node:child_process";
import {
  BoxRenderable,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  bg,
  bold,
  createCliRenderer,
  fg,
  type CliRenderer,
  CliRenderEvents,
  type KeyEvent,
  type TextChunk,
} from "@opentui/core";
import { loadExampleContext } from "./context";
import type { HistoryStore } from "./history";
import type {
  Capability,
  ExampleContext,
  LearnOptions,
  RecentExample,
  SnapshotResult,
  WindowKind,
} from "./types";
import { stripControlAndAnsi } from "./types";
import {
  createInitialState,
  filterCapabilities,
  isSplitLayout,
  recentExamplesFor,
  suggestion,
  type CapWithObservation,
  type UiState,
} from "./view";

interface Theme {
  bg: string;
  panel: string;
  border: string;
  borderFocus: string;
  text: string;
  dim: string;
  accent: string;
  accentBg: string;
  chipBg: string;
  chipText: string;
  warn: string;
  danger: string;
}

function buildTheme(monochrome: boolean): Theme {
  if (monochrome) {
    return {
      bg: "#000000",
      panel: "#000000",
      border: "#7a7a7a",
      borderFocus: "#ffffff",
      text: "#e6e6e6",
      dim: "#9a9a9a",
      accent: "#ffffff",
      accentBg: "#2a2a2a",
      chipBg: "#1c1c1c",
      chipText: "#e6e6e6",
      warn: "#cfcfcf",
      danger: "#ffffff",
    };
  }
  return {
    bg: "#0a0e13",
    panel: "#0f151b",
    border: "#22343c",
    borderFocus: "#2dd4bf",
    text: "#dbe6ea",
    dim: "#748088",
    accent: "#2dd4bf",
    accentBg: "#123935",
    chipBg: "#101c22",
    chipText: "#9fb3ba",
    warn: "#e0b34d",
    danger: "#e07070",
  };
}

function safe(text: string): string {
  return stripControlAndAnsi(text).replace(/\r/g, "");
}

function inlineSafe(text: string): string {
  return safe(text).replace(/[\n\t]/g, " ");
}

function plain(text: string): TextChunk {
  return { __isChunk: true, text: text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "") };
}

function styled(rows: TextChunk[][]): StyledText {
  const flat: TextChunk[] = [];
  rows.forEach((row, index) => {
    if (index > 0) flat.push(plain("\n"));
    flat.push(...(row.length ? row : [plain("")]));
  });
  return new StyledText(flat);
}

function typeBadge(kind: Capability["kind"]): string {
  return kind === "skill" ? "SK" : kind === "playbook" ? "PB" : "PR";
}

function exampleKey(example: RecentExample): string {
  return `${example.sessionId}:${example.partId ?? ""}:${example.messageId ?? ""}:${example.at}:${example.action}`;
}

interface ContextPaneState {
  status: "idle" | "loading" | "available" | "unavailable";
  key: string | undefined;
  data: ExampleContext | undefined;
  reason: string | undefined;
}

function windowCycle(current: WindowKind): WindowKind {
  if (current === "7") return "30";
  if (current === "30") return "all";
  return "7";
}

function relationLabel(relation: import("./types").ContextMessage["relation"]): string {
  if (relation === "request") return "REQUEST";
  if (relation === "before") return "LEAD-IN";
  if (relation === "invocation") return "EVENT";
  return "AFTER";
}

function formatClock(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export async function runInteractive(
  options: LearnOptions,
  store: HistoryStore,
  initialSnapshot: SnapshotResult,
  buildSnapshot: (options: LearnOptions, store: HistoryStore) => Promise<SnapshotResult>,
): Promise<void> {
  const monochrome = process.env.NO_COLOR !== undefined;
  const theme = buildTheme(monochrome);

  let renderer: CliRenderer | undefined;
  let appCreated = false;
  try {
    renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30, backgroundColor: theme.bg });
    const app = await createInteractiveApp(renderer, options, store, initialSnapshot, buildSnapshot);
    appCreated = true;
    await app.closed;
  } finally {
    if (renderer && !renderer.isDestroyed) renderer.destroy();
    if (!appCreated) store.close();
  }
}

export async function createInteractiveApp(
  renderer: CliRenderer,
  options: LearnOptions,
  store: HistoryStore,
  initialSnapshot: SnapshotResult,
  buildSnapshot: (options: LearnOptions, store: HistoryStore) => Promise<SnapshotResult>,
  runtime: { refreshIntervalMs?: number; listenForSignals?: boolean } = {},
): Promise<{ shutdown: () => void; getState: () => Readonly<UiState>; closed: Promise<void> }> {
  const monochrome = process.env.NO_COLOR !== undefined;
  const theme = buildTheme(monochrome);

  let snapshot = initialSnapshot;
  const state: UiState = createInitialState();
  state.allProjects = options.allProjects;
  state.includeSubagents = options.includeSubagents;
  state.window = options.window;

  const contextPane: ContextPaneState = { status: "idle", key: undefined, data: undefined, reason: undefined };
  let contextRequestSeq = 0;
  let pinnedExampleKey: string | undefined;

  // ---- layout ----
  const root = new BoxRenderable(renderer, {
    id: "root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: theme.bg,
  });
  renderer.root.add(root);

  const header = new BoxRenderable(renderer, {
    id: "header",
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 0,
    paddingBottom: 0,
    width: "100%",
    height: 4,
    flexShrink: 0,
    backgroundColor: theme.bg,
  });
  const headerText = new TextRenderable(renderer, { id: "header-text", content: "", width: "100%", height: 2 });
  const chipsRow = new BoxRenderable(renderer, {
    id: "chips",
    flexDirection: "row",
    columnGap: 1,
    width: "100%",
    height: 1,
    backgroundColor: theme.bg,
  });
  const evidenceText = new TextRenderable(renderer, { id: "evidence", content: "", width: "100%", height: 1 });
  header.add(headerText);
  header.add(chipsRow);
  header.add(evidenceText);
  root.add(header);

  const body = new BoxRenderable(renderer, {
    id: "body",
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    columnGap: 1,
    backgroundColor: theme.bg,
  });
  root.add(body);

  const leftPane = new BoxRenderable(renderer, {
    id: "left-pane",
    flexDirection: "column",
    border: true,
    borderStyle: "rounded",
    borderColor: theme.border,
    focusedBorderColor: theme.borderFocus,
    backgroundColor: theme.panel,
    width: 58,
    paddingLeft: 1,
    paddingRight: 1,
    title: "Catalog 0/0",
    titleColor: theme.dim,
  });
  const listHeader = new TextRenderable(renderer, {
    id: "list-header",
    content: "",
    height: 1,
    width: "100%",
  });
  const listScroll = new ScrollBoxRenderable(renderer, {
    id: "list-scroll",
    flexGrow: 1,
    backgroundColor: theme.panel,
    paddingLeft: 1,
    paddingRight: 1,
    scrollY: true,
    scrollX: false,
  });
  leftPane.add(listHeader);
  leftPane.add(listScroll);
  body.add(leftPane);

  const rightPane = new BoxRenderable(renderer, {
    id: "right-pane",
    flexDirection: "column",
    flexGrow: 1,
    border: true,
    borderStyle: "rounded",
    borderColor: theme.border,
    focusedBorderColor: theme.borderFocus,
    backgroundColor: theme.panel,
    title: "How to invoke",
    titleColor: theme.dim,
  });
  const rightScroll = new ScrollBoxRenderable(renderer, {
    id: "right-scroll",
    flexGrow: 1,
    backgroundColor: theme.panel,
    scrollY: true,
    scrollX: false,
  });
  const rightText = new TextRenderable(renderer, {
    id: "right-text",
    content: "",
    wrapMode: "word",
    fg: theme.text,
  });
  rightScroll.add(rightText);
  rightPane.add(rightScroll);
  body.add(rightPane);

  const footer = new BoxRenderable(renderer, {
    id: "footer",
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
    width: "100%",
    backgroundColor: theme.bg,
    flexShrink: 0,
  });
  const footerText = new TextRenderable(renderer, { id: "footer-text", content: "", width: "100%", height: 3 });
  footer.add(footerText);
  root.add(footer);

  const tinyText = new TextRenderable(renderer, {
    id: "resize-hint",
    content: "resize terminal to 40x12. q quits.",
    width: "100%",
    height: 1,
    fg: theme.warn,
    visible: false,
  });
  root.add(tinyText);

  interface CatalogRow {
    box: BoxRenderable;
    marker: TextRenderable;
    type: TextRenderable;
    name: TextRenderable;
    loads: TextRenderable;
    reads: TextRenderable;
  }

  const rowBoxes: CatalogRow[] = [];
  let rowIds: string[] = [];
  const rightCards: BoxRenderable[] = [];
  let rightCardKeys: string[] = [];
  let selectedRowId: string | undefined;
  let selectedExampleCardId: string | undefined;
  let listRevealPending = false;
  let rightRevealPending = false;

  function clearRows(): void {
    for (const row of rowBoxes.splice(0)) {
      listScroll.remove(row.box);
      row.box.destroyRecursively();
    }
    rowIds = [];
  }

  function afterLayout(action: () => void): void {
    renderer.once(CliRenderEvents.FRAME, () => {
      if (!stopped) action();
    });
  }

  function revealSelectedRowAfterLayout(): void {
    if (listRevealPending) return;
    listRevealPending = true;
    afterLayout(() => {
      listRevealPending = false;
      if (selectedRowId) listScroll.scrollChildIntoView(selectedRowId);
    });
  }

  function revealSelectedExampleAfterLayout(cardId: string): void {
    if (rightRevealPending) return;
    rightRevealPending = true;
    afterLayout(() => {
      rightRevealPending = false;
      rightScroll.scrollChildIntoView(cardId);
    });
  }


  function clearRightCards(): void {
    for (const card of rightCards.splice(0)) {
      rightScroll.remove(card);
      card.destroyRecursively();
    }
    rightCardKeys = [];
  }

  function ensureVisible(count: number): void {
    state.selected = Math.max(0, Math.min(state.selected, count - 1));
  }

  function currentFiltered(): CapWithObservation[] {
    return filterCapabilities(snapshot, state);
  }

  function currentExamples(item: CapWithObservation | undefined): RecentExample[] {
    return recentExamplesFor(item);
  }

  function closeContext(): void {
    contextPane.status = "idle";
    contextPane.data = undefined;
    contextPane.key = undefined;
    pinnedExampleKey = undefined;
  }

  function renderHeader(): void {
    const scope = state.allProjects
      ? "all projects"
      : (snapshot.options.projectPath ?? "current project").split("/").pop() || "current project";
    const windowLabel = state.window === "all" ? "all time" : `${state.window} days`;
    headerText.content = styled([
      [bold(fg(theme.accent)("pstack learn")) as TextChunk, fg(theme.dim)("  your pstack field guide") as TextChunk],
      [
        plain(`${scope}  ·  ${windowLabel}  ·  subagents ${state.includeSubagents ? "on" : "off"}  ·  `),
        fg(theme.dim)(`${snapshot.catalog.capabilities.length} capabilities`) as TextChunk,
      ],
    ]);
    chipsRow.getChildren().forEach((child) => {
      chipsRow.remove(child);
      child.destroyRecursively();
    });
    const tabs: Array<{ id: UiState["category"]; label: string }> = [
      { id: "all", label: "All" },
      { id: "skills", label: "Skills" },
      { id: "playbooks", label: "Playbooks" },
      { id: "principles", label: "Principles" },
    ];
    for (const tab of tabs) {
      const active = state.category === tab.id;
      const chip = new BoxRenderable(renderer, {
        paddingLeft: 1,
        paddingRight: 1,
        height: 1,
        backgroundColor: active ? theme.accentBg : theme.chipBg,
      });
      chip.add(
        new TextRenderable(renderer, {
          content: styled([[fg(active ? theme.accent : theme.chipText)(tab.label) as TextChunk]]),
          height: 1,
        }),
      );
      chipsRow.add(chip);
    }
    let observed = 0;
    let notObserved = 0;
    let unknown = 0;
    let loads = 0;
    let reads = 0;
    for (const observation of snapshot.observations) {
      if (observation.evidence.kind === "observed") {
        observed += 1;
        loads += observation.evidence.count.loads;
        reads += observation.evidence.count.reads;
      } else if (observation.evidence.kind === "not-observed") notObserved += 1;
      else unknown += 1;
    }
    const historyLine =
      snapshot.history.kind === "unavailable"
        ? `HISTORY UNKNOWN: ${snapshot.history.reason}`
        : `${observed} observed (${loads} loads, ${reads} reads)  ·  ${notObserved} not observed  ·  ${unknown} unknown`;
    evidenceText.content = styled([[fg(snapshot.history.kind === "unavailable" ? theme.warn : theme.dim)(inlineSafe(historyLine)) as TextChunk]]);
  }

  function renderList(): void {
    const filtered = currentFiltered();
    ensureVisible(filtered.length);
    const nextRowIds = filtered.map((item) => item.capability.id);
    const identitiesChanged = nextRowIds.length !== rowIds.length || nextRowIds.some((id, index) => id !== rowIds[index]);
    if (identitiesChanged) {
      clearRows();
      for (const [index, item] of filtered.entries()) {
        const box = new BoxRenderable(renderer, {
          id: `catalog-row-${item.capability.id}`,
          flexDirection: "row",
          backgroundColor: theme.panel,
          height: 1,
        });
        const marker = new TextRenderable(renderer, { content: "", width: 2, height: 1 });
        const type = new TextRenderable(renderer, { content: "", width: 4, height: 1 });
        const name = new TextRenderable(renderer, { content: "", flexGrow: 1, minWidth: 34, height: 1, wrapMode: "none" });
        const loads = new TextRenderable(renderer, { content: "", width: 5, height: 1, wrapMode: "none" });
        const reads = new TextRenderable(renderer, { content: "", width: 5, height: 1, wrapMode: "none" });
        box.add(marker);
        box.add(type);
        box.add(name);
        box.add(loads);
        box.add(reads);
        listScroll.add(box);
        rowBoxes.push({ box, marker, type, name, loads, reads });
      }
      rowIds = nextRowIds;
    }
    filtered.forEach((item, index) => {
      const row = rowBoxes[index];
      if (!row) return;
      const isSelected = index === state.selected && state.focus !== "context";
      const evidence = item.observation;
      const loads = evidence?.evidence.kind === "observed" ? String(evidence.evidence.count.loads) : evidence?.evidence.kind === "not-observed" ? "0" : "—";
      const reads = evidence?.evidence.kind === "observed" ? String(evidence.evidence.count.reads) : evidence?.evidence.kind === "not-observed" ? "0" : "—";
      const nameColor = isSelected ? theme.accent : theme.text;
      const evidenceColor = evidence?.evidence.kind === "unknown" ? theme.warn : evidence?.evidence.kind === "observed" ? theme.accent : theme.dim;
      row.box.backgroundColor = isSelected ? theme.accentBg : theme.panel;
      row.marker.content = styled([[fg(isSelected ? theme.accent : theme.dim)(isSelected ? "› " : "  ") as TextChunk]]);
      row.type.content = styled([[fg(theme.dim)(typeBadge(item.capability.kind)) as TextChunk]]);
      row.name.content = styled([[fg(nameColor)(inlineSafe(item.capability.name)) as TextChunk]]);
      row.loads.content = styled([[fg(evidenceColor)(loads) as TextChunk]]);
      row.reads.content = styled([[fg(evidenceColor)(reads) as TextChunk]]);
    });
    const nextSelectedRowId = rowBoxes[state.selected]?.box.id;
    if (identitiesChanged || nextSelectedRowId !== selectedRowId) revealSelectedRowAfterLayout();
    selectedRowId = nextSelectedRowId;
    listHeader.content = styled([[fg(theme.dim)(" TYPE CAPABILITY                         LOAD READ") as TextChunk]]);
    leftPane.title = `Catalog ${filtered.length}/${snapshot.catalog.capabilities.length}`;
    leftPane.borderColor = state.focus === "list" ? theme.borderFocus : theme.border;
  }

  function detailContent(item: CapWithObservation | undefined): StyledText {
    if (!item) return styled([[fg(theme.dim)("No matching capabilities.") as TextChunk]]);
    const rows: TextChunk[][] = [];
    rows.push([bold(fg(theme.accent)(safe(`[${typeBadge(item.capability.kind)}] ${item.capability.name}`))) as TextChunk]);
    rows.push([]);
    rows.push([bold(fg(theme.accent)("HOW TO INVOKE")) as TextChunk]);
    rows.push([plain(item.capability.invocation)]);
    rows.push([]);
    rows.push([fg(theme.dim)("WHY ") as TextChunk, plain(item.capability.whyTry)]);
    rows.push([]);
    rows.push([fg(theme.dim)("ABOUT ") as TextChunk, plain(item.capability.summary)]);
    rows.push([]);
    const evidence = item.observation;
    if (evidence?.evidence.kind === "observed") {
      rows.push([
        fg(theme.dim)("EVIDENCE ") as TextChunk,
        plain(`observed  loads ${evidence.evidence.count.loads}  reads ${evidence.evidence.count.reads}`),
      ]);
      rows.push([fg(theme.dim)("LAST SEEN ") as TextChunk, plain(new Date(evidence.evidence.lastSeenAt).toLocaleString())]);
    } else if (evidence?.evidence.kind === "not-observed") {
      rows.push([fg(theme.dim)("EVIDENCE ") as TextChunk, plain("not observed in this scope and window")]);
    } else {
      rows.push([fg(theme.warn)("EVIDENCE ") as TextChunk, plain("unknown; history unavailable")]);
    }
    rows.push([]);
    rows.push([fg(theme.dim)("SOURCE ") as TextChunk, plain(item.capability.sourcePath)]);
    rows.push([]);
    rows.push([fg(theme.dim)("Enter: recent examples for this capability.") as TextChunk]);
    return styled(rows);
  }

  function examplesContent(item: CapWithObservation | undefined): StyledText {
    if (!item) return styled([[fg(theme.dim)("No matching capabilities.") as TextChunk]]);
    const rows: TextChunk[][] = [];
    rows.push([bold(fg(theme.accent)("RECENT EXAMPLES")) as TextChunk]);
    rows.push([fg(theme.dim)(safe(item.capability.invocation)) as TextChunk]);
    rows.push([]);
    if (item.observation?.evidence.kind === "unknown") {
      const reason = snapshot.history.kind === "unavailable" ? snapshot.history.reason : "unknown";
      rows.push([fg(theme.warn)(safe(`Examples unavailable because history is unknown (${reason}).`)) as TextChunk]);
      rows.push([]);
      rows.push([fg(theme.dim)("Consultation only; not proof of completed execution.") as TextChunk]);
      return styled(rows);
    }
    const examples = currentExamples(item);
    if (examples.length === 0) {
      rows.push([fg(theme.dim)("No recorded examples in this scope and window. Try this invocation:") as TextChunk]);
      rows.push([plain(item.capability.invocation)]);
      rows.push([]);
      rows.push([fg(theme.dim)("Consultation only; not proof of completed execution.") as TextChunk]);
      return styled(rows);
    }
    state.exampleIndex = Math.max(0, Math.min(state.exampleIndex, examples.length - 1));
    examples.forEach((example, index) => {
      const isSelected = index === state.exampleIndex;
      const marker = isSelected ? fg(theme.accent)("▸ ") : fg(theme.dim)("  ");
      rows.push([
        marker as TextChunk,
        bold(fg(isSelected ? theme.accent : theme.text)(new Date(example.at).toLocaleString())) as TextChunk,
        plain(`  ${example.kind === "load" ? "load" : "read"}`),
        example.partId && example.messageId ? plain("") : (fg(theme.dim)("  (no exact id)") as TextChunk),
      ]);
      rows.push([plain("    "), fg(theme.dim)(example.sessionTitle) as TextChunk]);
      rows.push([plain("    "), fg(theme.dim)(example.directory) as TextChunk]);
      rows.push([plain("    action "), plain(example.action)]);
      rows.push([plain("    session "), plain(example.sessionId)]);
      rows.push([]);
    });
    rows.push([fg(theme.dim)("load = successful skill tool load; read = opened exact SKILL.md/playbook.") as TextChunk]);
    rows.push([fg(theme.dim)("Consultation only; not proof of completed execution.") as TextChunk]);
    rows.push([]);
    rows.push([fg(theme.accent)("Enter: exact conversation context for the selected example.") as TextChunk]);
    return styled(rows);
  }

  function contextContent(): StyledText {
    const rows: TextChunk[][] = [];
    rows.push([bold(fg(theme.accent)("EXACT CONTEXT")) as TextChunk]);
    rows.push([fg(theme.dim)("Original excerpts around this event; consultation is not proof of completion.") as TextChunk]);
    rows.push([]);
    if (contextPane.status === "loading") {
      rows.push([fg(theme.dim)("Loading exact context…") as TextChunk]);
      return styled(rows);
    }
    if (contextPane.status === "unavailable") {
      rows.push([fg(theme.warn)(contextPane.reason ?? "Exact context is unavailable.") as TextChunk]);
      return styled(rows);
    }
    const data = contextPane.data;
    if (contextPane.status !== "available" || !data || data.kind !== "available") {
      rows.push([fg(theme.dim)("No context loaded.") as TextChunk]);
      return styled(rows);
    }
    rows.push([fg(theme.dim)(`Session: ${inlineSafe(data.example.sessionTitle)}`)]);
    rows.push([fg(theme.dim)(`Project: ${inlineSafe(data.example.directory)}`)]);
    rows.push([]);
    let eventRendered = false;
    for (const message of data.messages) {
      if (!eventRendered && message.relation === "after") {
        rows.push([bg(theme.accentBg)(fg(theme.accent)(safe(` TOOL EVENT ${data.action} `))) as TextChunk]);
        rows.push([]);
        eventRendered = true;
      }
      const label = message.relation === "invocation" ? "LEAD-IN" : relationLabel(message.relation);
      const roleColor = message.role === "user" ? theme.accent : theme.text;
      rows.push([
        fg(theme.dim)(`${label} `) as TextChunk,
        fg(roleColor)(`${message.role}`) as TextChunk,
        plain(`  ${formatClock(message.at)}`),
        message.truncated ? (fg(theme.warn)("  truncated") as TextChunk) : plain(""),
      ]);
      const text = stripControlAndAnsi(message.text) || "(empty)";
      rows.push([plain(text)]);
      rows.push([]);
    }
    if (!eventRendered) {
      rows.push([bg(theme.accentBg)(fg(theme.accent)(safe(` TOOL EVENT ${data.action} `))) as TextChunk]);
      rows.push([]);
    }
    if (data.warnings.length) {
      for (const warning of data.warnings) {
        rows.push([fg(theme.warn)(inlineSafe(`WARNING: ${warning}`)) as TextChunk]);
      }
      rows.push([]);
    }
    rows.push([fg(theme.dim)(`Resume: opencode -s ${data.example.sessionId}`) as TextChunk]);
    return styled(rows);
  }

  function renderRight(): void {
    rightText.visible = true;
    const filtered = currentFiltered();
    const selected = filtered[state.selected];
    if (state.focus === "context") {
      clearRightCards();
      rightPane.title = "Exact context";
      rightText.content = contextContent();
    } else if (state.focus === "examples") {
      rightPane.title = "Recent examples";
      const examples = currentExamples(selected);
      if (!selected || examples.length === 0 || selected.observation?.evidence.kind === "unknown") {
        clearRightCards();
        rightText.content = examplesContent(selected);
      } else {
        rightText.visible = false;
        state.exampleIndex = Math.max(0, Math.min(state.exampleIndex, examples.length - 1));
        const cardKeys = ["intro", ...examples.map(exampleKey), "outro"];
        const cardsChanged = cardKeys.length !== rightCardKeys.length || cardKeys.some((key, index) => key !== rightCardKeys[index]);
        if (cardsChanged) {
          clearRightCards();
          const intro = new BoxRenderable(renderer, { id: "examples-intro", flexDirection: "column" });
          intro.add(new TextRenderable(renderer, {
            content: styled([
              [bold(fg(theme.accent)("RECENT EXAMPLES")) as TextChunk],
              [fg(theme.dim)(inlineSafe(selected.capability.invocation)) as TextChunk],
            ]),
            wrapMode: "word",
          }));
          rightScroll.add(intro);
          rightCards.push(intro);
          examples.forEach((example, index) => {
            const card = new BoxRenderable(renderer, {
              id: `example-card-${index}`,
              flexDirection: "column",
              paddingLeft: 1,
              paddingRight: 1,
              marginTop: 1,
              backgroundColor: theme.panel,
            });
            card.add(new TextRenderable(renderer, {
              content: "",
              wrapMode: "word",
            }));
            rightScroll.add(card);
            rightCards.push(card);
          });
          const outro = new BoxRenderable(renderer, { id: "examples-outro", flexDirection: "column", marginTop: 1 });
          outro.add(new TextRenderable(renderer, {
            content: styled([
              [fg(theme.dim)("Consultation only; not proof of completed execution.") as TextChunk],
              [fg(theme.accent)("Enter: exact conversation context for the selected example.") as TextChunk],
            ]),
            wrapMode: "word",
          }));
          rightScroll.add(outro);
          rightCards.push(outro);
          rightCardKeys = cardKeys;
        }
        examples.forEach((example, index) => {
          const isSelected = index === state.exampleIndex;
          const card = rightCards[index + 1];
          const text = card?.getChildren()[0];
          if (!card || !(text instanceof TextRenderable)) return;
          card.backgroundColor = isSelected ? theme.accentBg : theme.panel;
          text.content = styled([
            [
              fg(isSelected ? theme.accent : theme.text)(inlineSafe(new Date(example.at).toLocaleString())) as TextChunk,
              plain(`  ${example.kind}`),
            ],
            [fg(theme.dim)(inlineSafe(example.sessionTitle)) as TextChunk],
            [fg(theme.dim)(inlineSafe(example.directory)) as TextChunk],
            [plain("action  "), plain(inlineSafe(example.action))],
            [plain("session "), plain(inlineSafe(example.sessionId))],
          ]);
        });
        const selectedCard = rightCards[state.exampleIndex + 1];
        if (selectedCard && (cardsChanged || selectedCard.id !== selectedExampleCardId)) revealSelectedExampleAfterLayout(selectedCard.id);
        selectedExampleCardId = selectedCard?.id;
      }
    } else {
      clearRightCards();
      selectedExampleCardId = undefined;
      rightPane.title = "How to invoke";
      rightText.content = detailContent(selected);
    }
    rightPane.borderColor = state.focus === "detail" || state.focus === "examples" || state.focus === "context" ? theme.borderFocus : theme.border;
  }

  function renderHelp(): void {
    clearRightCards();
    rightText.visible = true;
    rightPane.title = "Help";
    rightText.content = styled([
      [bold(fg(theme.accent)("HELP")) as TextChunk], [],
      [plain("Navigation")],
      [plain("  j/k or arrows select    PgUp/PgDn scroll    Enter examples/context")],
      [plain("  left/right focus pane   Esc back/close")], [],
      [plain("Explore")],
      [plain("  / search   Tab category   u not observed   n try next")], [],
      [plain("Evidence")],
      [plain("  loads = successful skill tool loads")],
      [plain("  reads = opened exact SKILL.md/playbook path")], [],
      [plain("Scope and actions")],
      [plain("  w window   s project/all   a subagents   r refresh")],
      [plain("  c copy invocation   p print invocation and exit")],
      [plain("  q or Ctrl-C exit   ? or Esc close help")], [],
      [plain(`Database: ${snapshot.options.dbPath ?? "not found"}`)],
      [plain("Metadata proves consultation, not completed execution.")],
      ...([...snapshot.catalog.warnings, ...snapshot.history.warnings].length
        ? [[], [plain("Warnings")], ...[...snapshot.catalog.warnings, ...snapshot.history.warnings].map((warning) => [fg(theme.warn)(inlineSafe(`  ${warning}`)) as TextChunk])]
        : []),
      ...[...snapshot.catalog.warnings, ...snapshot.history.warnings].map((warning) => [fg(theme.warn)(inlineSafe(`WARNING: ${warning}`)) as TextChunk]),
    ]);
  }

  function renderFooter(): void {
    const next = suggestion(snapshot);
    const searchLine = state.searching
      ? `Search /${state.search}█`
      : state.search
        ? `Search: ${state.search}  (Esc clears)`
        : "? help  / search";
    const refreshed = `${formatClock(snapshot.history.readAt)} in ${snapshot.history.durationMs}ms`;
    const scope = state.allProjects ? "all projects" : "current project";
    const warnings = [...snapshot.catalog.warnings, ...snapshot.history.warnings];
    const warning = warnings.find((message) => !message.toLowerCase().includes("child session"));
    footerText.content = styled([
      [
        fg(theme.dim)(inlineSafe(
          next ? `Try next: ${next.name}. ${next.whyTry}` : "Try next: no not-observed workflow or playbook in this window.",
        )) as TextChunk,
      ],
      [
        fg(theme.dim)(
          `${searchLine}   ↑↓ move   Enter examples   Tab category   q quit`,
        ) as TextChunk,
      ],
      [fg(warning ? theme.warn : theme.dim)(inlineSafe(`Refreshed ${refreshed} · 15s · ${scope}${warning ? ` · WARNING: ${warning}` : state.status ? ` · ${state.status}` : ""}`)) as TextChunk],
    ]);
  }

  function applyResponsiveLayout(): void {
    const tiny = renderer.width < 40 || renderer.height < 12;
    tinyText.visible = tiny;
    header.visible = !tiny;
    body.visible = !tiny;
    footer.visible = !tiny;
    if (tiny) return;
    const split = isSplitLayout(renderer.width);
    if (split) {
      leftPane.width = Math.max(57, Math.min(64, Math.floor(renderer.width * 0.48)));
      leftPane.visible = true;
      rightPane.visible = true;
      rightPane.flexGrow = 1;
    } else {
      const showList = state.focus === "list" && !state.narrowDetail;
      leftPane.visible = showList;
      rightPane.visible = !showList;
      leftPane.width = "100%";
      rightPane.flexGrow = 1;
    }
  }

  function draw(): void {
    if (stopped) return;
    applyResponsiveLayout();
    if (tinyText.visible) return;
    renderHeader();
    renderList();
    if (state.help) renderHelp();
    else renderRight();
    renderFooter();
  }

  function resetSelection(): void {
    state.selected = 0;
    state.exampleIndex = 0;
    closeContext();
  }

  function moveSelection(delta: number): void {
    const count = currentFiltered().length;
    const next = Math.max(0, Math.min(state.selected + delta, count - 1));
    if (next !== state.selected) {
      state.selected = next;
      closeContext();
    }
  }

  function moveExample(delta: number): void {
    const filtered = currentFiltered();
    const item = filtered[state.selected];
    const count = currentExamples(item).length;
    if (count === 0) return;
    state.exampleIndex = Math.max(0, Math.min(state.exampleIndex + delta, count - 1));
  }

  let refreshQueue = Promise.resolve();
  function refresh(preserveContext = true): Promise<void> {
    const requestedScope = `${state.allProjects}:${state.includeSubagents}:${state.window}`;
    refreshQueue = refreshQueue.then(async () => {
    if (stopped) return;
    const before = currentFiltered()[state.selected]?.capability.id;
    const beforeExample = pinnedExampleKey;
    const next = await buildSnapshot(
      { ...options, allProjects: state.allProjects, includeSubagents: state.includeSubagents, window: state.window },
      store,
    );
    if (stopped || requestedScope !== `${state.allProjects}:${state.includeSubagents}:${state.window}`) return;
    snapshot = next;
    const selectedIndex = before ? filterCapabilities(snapshot, state).findIndex((item) => item.capability.id === before) : -1;
    if (selectedIndex >= 0) state.selected = selectedIndex;
    else state.selected = 0;
    const selectedItem = filterCapabilities(snapshot, state)[state.selected];
    const exampleStillExists = beforeExample && currentExamples(selectedItem).some((example) => exampleKey(example) === beforeExample);
    if (!preserveContext || (beforeExample && !exampleStillExists)) {
      closeContext();
      if (state.focus === "context" || state.focus === "examples") state.focus = "list";
    }
    draw();
    });
    return refreshQueue;
  }

  async function loadContext(example: RecentExample): Promise<void> {
    const key = exampleKey(example);
    const requestId = ++contextRequestSeq;
    contextPane.status = "loading";
    contextPane.key = key;
    contextPane.data = undefined;
    contextPane.reason = undefined;
    pinnedExampleKey = key;
    draw();
    const dbPath = snapshot.options.dbPath;
    if (!dbPath) {
      if (requestId !== contextRequestSeq) return;
      contextPane.status = "unavailable";
      contextPane.reason = "The OpenCode database path is unknown.";
      draw();
      return;
    }
    let result: ExampleContext;
    try {
      result = await loadExampleContext(dbPath, example);
    } catch {
      result = { kind: "unavailable", reason: "Exact context could not be read." };
    }
    if (stopped || requestId !== contextRequestSeq || contextPane.key !== key) return;
    if (result.kind === "available") {
      contextPane.status = "available";
      contextPane.data = result;
    } else {
      contextPane.status = "unavailable";
      contextPane.reason = result.reason;
    }
    draw();
  }

  function copyInvocation(text: string): void {
    if (process.platform === "darwin") {
      const pb = spawnSync("pbcopy", { input: text, encoding: "utf8", timeout: 1_000 });
      if (pb.status === 0) {
        state.status = "copy requested: pbcopy";
        return;
      }
    }
    if (renderer.copyToClipboardOSC52(stripControlAndAnsi(text).replace(/[\r\n\t]/g, " "))) {
      state.status = "copy requested: OSC 52";
      return;
    }
    state.status = "copy unavailable";
  }

  let stopped = false;
  let onStop!: () => void;
  const finished = new Promise<void>((resolveFinished) => {
    onStop = resolveFinished;
  });

  function shutdown(): void {
    if (stopped) return;
    stopped = true;
    contextRequestSeq += 1;
    clearInterval(refreshTimer);
    renderer.off("resize", onResize);
    renderer.off(CliRenderEvents.DESTROY, onRendererDestroy);
    renderer.keyInput.off("keypress", onKeypress);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (!renderer.isDestroyed) renderer.destroy();
    store.close();
    onStop();
  }

  function onRendererDestroy(): void { shutdown(); }
  function onSignal(): void { shutdown(); }

  function onResize(): void {
    selectedRowId = undefined;
    draw();
  }

  function onKeypress(key: KeyEvent): void {
    void handleKey(key).catch(() => {
      shutdown();
    });
  }

  async function handleKey(key: KeyEvent): Promise<void> {
    if (key.ctrl && key.name === "c") {
      shutdown();
      return;
    }
    if (state.searching) {
      if (key.name === "escape") {
        state.searching = false;
        state.search = "";
        resetSelection();
      } else if (key.name === "return" || key.name === "enter") {
        state.searching = false;
      } else if (key.name === "backspace") {
        state.search = state.search.slice(0, -1);
        resetSelection();
      } else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        state.search += key.sequence;
        resetSelection();
      }
      draw();
      return;
    }
    if (state.help) {
      if (key.name === "escape" || key.sequence === "?" || key.name === "q") state.help = false;
      draw();
      return;
    }
    if (key.name === "q") {
      shutdown();
      return;
    }
    if (key.sequence === "/") {
      state.searching = true;
      state.search = "";
      draw();
      return;
    }
    if (key.sequence === "?") {
      state.help = true;
      draw();
      return;
    }
    if (key.name === "escape") {
      if (state.focus === "context") {
        state.focus = "examples";
      } else if (state.focus === "examples") {
        state.focus = state.examplesReturnFocus;
        closeContext();
      } else if (state.narrowDetail) {
        state.narrowDetail = false;
        state.focus = "list";
      } else {
        state.search = "";
        resetSelection();
        state.focus = "list";
      }
      draw();
      return;
    }
    if (key.name === "tab") {
      state.category =
        state.category === "all"
          ? "skills"
          : state.category === "skills"
            ? "playbooks"
            : state.category === "playbooks"
              ? "principles"
              : "all";
      resetSelection();
      draw();
      return;
    }
    if (!key.ctrl && key.name === "u") {
      state.hideObserved = !state.hideObserved;
      resetSelection();
      draw();
      return;
    }
    if (key.name === "w") {
      state.window = windowCycle(state.window);
      closeContext();
      await refresh(false);
      return;
    }
    if (key.name === "s") {
      state.allProjects = !state.allProjects;
      closeContext();
      await refresh(false);
      return;
    }
    if (key.name === "a") {
      state.includeSubagents = !state.includeSubagents;
      closeContext();
      await refresh(false);
      return;
    }
    if (key.name === "r") {
      await refresh();
      return;
    }
    if (key.name === "n") {
      const next = suggestion(snapshot);
      if (next) {
        state.category = "all";
        state.hideObserved = false;
        state.search = "";
        const index = filterCapabilities(snapshot, state).findIndex((item) => item.capability.id === next.id);
        state.selected = index >= 0 ? index : 0;
        closeContext();
      }
      draw();
      return;
    }

    const page = Math.max(1, Math.floor(renderer.height / 2));
    const inList = state.focus === "list";
    const inExamples = state.focus === "examples";
    const inReader = state.focus === "detail" || state.focus === "context";

    if (inList || inExamples) {
      const step = (delta: number) => (inExamples ? moveExample(delta) : moveSelection(delta));
      if (key.name === "down" || key.sequence === "j") step(1);
      else if (key.name === "up" || key.sequence === "k") step(-1);
      else if (key.name === "home") step(-Infinity);
      else if (key.name === "end") step(Infinity);
      else if (!inExamples && (key.name === "pagedown" || (key.ctrl && key.name === "d"))) step(page);
      else if (!inExamples && (key.name === "pageup" || (key.ctrl && key.name === "u"))) step(-page);
      else if (inExamples && (key.name === "pagedown" || (key.ctrl && key.name === "d"))) rightScroll.scrollBy(page);
      else if (inExamples && (key.name === "pageup" || (key.ctrl && key.name === "u"))) rightScroll.scrollBy(-page);
    }
    if (inReader) {
      if (key.name === "down" || key.sequence === "j") rightScroll.scrollBy(1);
      else if (key.name === "up" || key.sequence === "k") rightScroll.scrollBy(-1);
      else if (key.name === "home") rightScroll.scrollTo(0);
      else if (key.name === "end") rightScroll.scrollTo(Number.MAX_SAFE_INTEGER);
      else if (key.name === "pagedown" || (key.ctrl && key.name === "d")) rightScroll.scrollBy(page);
      else if (key.name === "pageup" || (key.ctrl && key.name === "u")) rightScroll.scrollBy(-page);
    }
    if (key.name === "left") {
      state.focus = "list";
      state.narrowDetail = false;
    }
    if (key.name === "right") {
      state.focus = "detail";
      if (!isSplitLayout(renderer.width)) state.narrowDetail = true;
    }
    if (key.name === "return" || key.name === "enter") {
      if (state.focus === "list" || state.focus === "detail") {
        state.examplesReturnFocus = state.narrowDetail || state.focus === "detail" ? "detail" : "list";
        state.focus = "examples";
        state.exampleIndex = 0;
      } else if (state.focus === "examples") {
        const filtered = currentFiltered();
        const item = filtered[state.selected];
        const examples = currentExamples(item);
        const example = examples[state.exampleIndex];
        if (example) {
          state.focus = "context";
          await loadContext(example);
          return;
        }
      }
    }
    const current = currentFiltered()[state.selected];
    if (key.name === "p" && current) {
      const invocation = stripControlAndAnsi(current.capability.invocation);
      shutdown();
      process.stdout.write(`${invocation}\n`);
      return;
    }
    if (key.name === "c" && current) {
      copyInvocation(current.capability.invocation);
    }
    draw();
  }

  renderer.keyInput.on("keypress", onKeypress);
  renderer.on("resize", onResize);
  renderer.on(CliRenderEvents.DESTROY, onRendererDestroy);
  if (runtime.listenForSignals !== false) {
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  }
  const refreshTimer = setInterval(() => { void refresh(true); }, runtime.refreshIntervalMs ?? 15_000);
  refreshTimer.unref();
  renderer.setTerminalTitle("pstack learn");
  renderer.start();
  draw();

  void finished.finally(() => {
    if (!stopped) shutdown();
  });

  return {
    shutdown,
    getState: () => state,
    closed: finished,
  };
}
