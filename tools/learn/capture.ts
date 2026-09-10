import { createTestRenderer } from "@opentui/core/testing";
import { discoverCatalog } from "./catalog";
import { HistoryStore } from "./history";
import { createInteractiveApp } from "./tui";
import type { CapabilityObservation, SnapshotResult } from "./types";

const catalog = await discoverCatalog();
const observed = new Map([['skill:architect', [4, 2]], ['skill:how', [9, 3]], ['skill:interrogate', [3, 1]], ['playbook:feature', [0, 5]]]);
const observations: CapabilityObservation[] = catalog.capabilities.map(capability => {
  const counts = observed.get(capability.id);
  return {capabilityId: capability.id, evidence: counts
    ? {kind: 'observed', count: {loads: counts[0]!, reads: counts[1]!}, lastSeenAt: '2026-09-10T14:32:00Z', lastSessionId: 'demo-session', lastSessionParent: false}
    : {kind: 'not-observed', count: {loads: 0, reads: 0}}};
});
const snapshot: SnapshotResult = {
  catalog, observations,
  history: {kind:'available', observations, sessionCount: 12, readAt: '2026-09-10T14:35:00Z', durationMs: 8, warnings: []},
  options: {scope:'project', projectPath: '/demo/pstack-opencode', window:'30', includeSubagents:false},
};
const setup = await createTestRenderer({width: 132, height: 34});
const store = new HistoryStore('/nonexistent/demo.db');
const app = await createInteractiveApp(setup.renderer, {cwd:'/demo/pstack-opencode', allProjects:false, includeSubagents:false, window:'30', json:false, snapshot:false, help:false}, store, snapshot, async()=>snapshot, {listenForSignals:false});
await setup.renderOnce();
await setup.flush();
const output = process.argv[2] ?? '.audit/learn-capture.json';
await Bun.write(output, JSON.stringify(setup.captureSpans()));
app.shutdown();
console.log(`Captured OpenTUI frame with demo history: ${output}`);
