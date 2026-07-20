# pstack-opencode

An [OpenCode](https://opencode.ai) port of [pstack](https://github.com/cursor/plugins/tree/main/pstack), Lauren Tan (poteto)'s rigorous-engineering plugin for Cursor. MIT licensed upstream, which explicitly invites forks. All credit for the substance to her; this repo adapts the plumbing.

Lives at [github.com/philrenaud/pstack-opencode](https://github.com/philrenaud/pstack-opencode). Ported from upstream v0.11.3.

pstack is a discipline layer for coding agents: playbooks that force reproduction before fixes, principles the agent must cite when they shape a decision, multi-model adversarial review, and anti-slop prose rules. Almost all of it is markdown, which is why it ports.

## Layout

```
skills/     40 skills (poteto-mode + playbooks, workflow skills, 21 principle skills)
agents/     5 OpenCode subagents (the model-routing layer, see below)
commands/   /poteto-mode slash command
```

## Install

Clone it, then point OpenCode at the clone. The clone is the live source of truth; nothing is copied.

```sh
git clone https://github.com/philrenaud/pstack-opencode.git ~/www/pstack-opencode
```

Paths below assume `~/www/pstack-opencode`; adjust if you cloned elsewhere.

1. Skills, via `skills.paths` in `~/.config/opencode/opencode.jsonc`:

   ```jsonc
   { "skills": { "paths": ["~/www/pstack-opencode/skills"] } }
   ```

2. Agents and the command, via symlinks:

   ```sh
   for f in ~/www/pstack-opencode/agents/*.md; do ln -sf "$f" ~/.config/opencode/agents/; done
   ln -sf ~/www/pstack-opencode/commands/poteto-mode.md ~/.config/opencode/commands/
   ```

3. Restart OpenCode. Verify with `opencode debug skill` (should list all 40) and `opencode agent list` (should show the five `poteto-*` subagents).

Edits to any file here apply on the next OpenCode restart.

## Use

- `/poteto-mode <task>` at the start of anything that needs rigor. It matches the task to a playbook (bug fix, feature, perf, refactoring, prototype, autonomous run, ...), copies the playbook steps into a todolist verbatim, and routes to the other skills as steps fire.
- The other skills also load on demand when a task matches their description, or by asking for them by name: `how`, `why`, `interrogate` (multi-model adversarial review), `arena` (N parallel attempts, graft the best), `architect`, `unslop`, `tdd`, `teach`, `blast-radius`, `reflect`, `recall`, `automate-me`.
- `setup-pstack` reconfigures which models the roles use.

## Model routing

Cursor passes a `model:` parameter per subagent call. OpenCode pins models on named agents instead, so the role-to-model mapping lives in `agents/`:

| Agent | Role | Model |
| --- | --- | --- |
| `poteto-agent` | general delegate, reads poteto-mode in full first | inherits caller's model |
| `poteto-coder` | precisely specified implementation | `openrouter/x-ai/grok-4.5` |
| `poteto-claude` | judgment, prose, synthesis panelist | `openrouter/anthropic/claude-opus-4.8` |
| `poteto-gpt` | second panel family | `openrouter/openai/gpt-5.2` |
| `poteto-grok` | fast exploration, third panel family | `openrouter/x-ai/grok-4.5` |

The three panelists should stay on three different model families: cross-model agreement is the signal `interrogate` and `arena` rely on. The pinned models assume an OpenRouter provider; on a different provider, run `/setup-pstack` (or edit the `model:` lines) and restart to remap. Model IDs must appear in `opencode models` output.

## What changed from upstream

The substance (playbooks, principles, prose rules, review rubrics) is untouched. The plumbing changed:

| Upstream (Cursor) | Here (OpenCode) |
| --- | --- |
| `subagent_type: generalPurpose` + per-call `model:`/`readonly:`/`run_in_background:` | named agents above; "review only, do not edit files" as a prompt instruction; parallel Tasks in one message |
| `name: Poteto Mode`, `mode: true` sticky-mode frontmatter | `name: poteto-mode` (OpenCode requires lowercase, matching the dir); stickiness is asked for in the command template instead |
| `/setup-pstack` writes `~/.cursor/rules/pstack-models.mdc` | edits the `model:` lines in `agents/` |
| `AskQuestion` tool | `question` tool |
| Cursor `/loop` built-in | self-driven polling (`gh pr checks --watch`, sleep-and-recheck) or in-session iteration |
| `babysit` built-in (PR watching) | `gh pr checks <n> --watch` + `gh pr view --comments` triage |
| `create-skill` built-in | the authoring-a-skill playbook + [OpenCode skill docs](https://opencode.ai/docs/skills) |
| `deslop`, `control-cli`, `control-ui` from `cursor-team-kit` | `unslop` rules applied to diffs; project-local `verify-*` skills via `create-verification-skill` |
| transcripts at `~/.cursor/projects/<slug>/agent-transcripts/` | `opencode session list` + `opencode export <sessionID>` |
| `.cursor/skills/` paths | `.opencode/skills/` / `~/.config/opencode/skills/` |
| `benny` automation pack (Slack triage) | not ported; depends on Cursor's automation runtime |

Known gaps against upstream: no true sticky mode (the command asks the model to stay in it, Cursor enforces it), and no `/loop` runtime primitive for unattended multi-hour runs.

## Re-syncing with upstream

Upstream lives at `cursor/plugins`, directory `pstack/`, and this port started from v0.11.3. To pull changes:

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/cursor/plugins.git /tmp/plugins
git -C /tmp/plugins sparse-checkout set pstack
diff -r /tmp/plugins/pstack/skills skills
```

New or changed skills need the substitution table above applied before landing. The `agents/`, `commands/`, and `setup-pstack` files are port-specific and have no upstream counterpart to sync.
