# pstack-opencode

An [OpenCode](https://opencode.ai) port of [pstack](https://github.com/cursor/plugins/tree/main/pstack), Lauren Tan (poteto)'s rigorous-engineering plugin for Cursor. MIT licensed upstream, which explicitly invites forks. All credit for the substance to her; this repo adapts the plumbing.

Lives at [github.com/philrenaud/pstack-opencode](https://github.com/philrenaud/pstack-opencode). Synced through upstream **v0.15.1**, commit [`f8abeddd1862`](https://github.com/cursor/plugins/commit/f8abeddd1862dc73704e3d719dd73df0d51b8c71). See [the update notes](docs/upstream-sync.md) for changes since v0.11.3 and the remaining platform differences.

pstack is a discipline layer for coding agents: playbooks that force reproduction before fixes, principles the agent must cite when they shape a decision, multi-model adversarial review, and anti-slop prose rules. Almost all of it is markdown, which is why it ports.

## Layout

```
skills/     46 skills, including 23 principles and 23 poteto-mode playbooks
agents/     7 OpenCode subagents
commands/   /poteto-mode slash command
scripts/    upstream sync and verification tools
```

## Install

Clone it anywhere, then run the install script from inside the clone:

```sh
git clone https://github.com/philrenaud/pstack-opencode.git
cd pstack-opencode && ./install.sh
```

The clone is the live source of truth; nothing is copied and `git pull` is the update mechanism. The script is idempotent (re-run it if you move the clone) and does three things:

1. Registers `skills/` via `skills.paths` in `~/.config/opencode/opencode.json`. If a config file already exists without the entry, it prints the line to add rather than editing your config.
2. Symlinks `agents/*.md` and `commands/*.md` into `~/.config/opencode/agents/` and `commands/` (OpenCode has no `paths` config for these, so symlinks keep the repo authoritative).
3. Prints the verification commands.

Restart OpenCode, then verify with `opencode debug skill` and `opencode agent list`. The lists include 46 pstack skills, six `poteto-*` agents, and `comment-sicko`. Re-run `./install.sh` after updates that add agents or commands.

Edits to any file here apply on the next OpenCode restart.

## Use

Run `./learn` for the interactive learning dashboard. It lists the installed skills and playbooks, shows recent loads and consultations, and gives a copyable invocation for each. Press `/` to search, `u` for not-observed entries, and `?` for help. See [the learner guide](docs/learn.md) for scope filters and evidence limits.

- `/poteto-mode <task>` at the start of anything that needs rigor. It matches the task to a playbook (bug fix, feature, perf, refactoring, prototype, autonomous run, ...), copies the playbook steps into a todolist verbatim, and routes to the other skills as steps fire.
- The other skills also load on demand when a task matches their description, or by asking for them by name: `how`, `why`, `interrogate` (multi-model adversarial review), `arena` (N parallel attempts, graft the best), `architect`, `unslop`, `tdd`, `teach`, `blast-radius`, `reflect`, `recall`, `automate-me`.
- `setup-pstack` reconfigures which models the roles use.
- `swarm` covers parallel slices or races. `arena` compares candidate designs and combines the strongest parts.
- `no-comments` runs the Comment Sicko cleanup delegate. `technical-writing` handles docs and PR prose. `bro` restates the previous answer in plain language.
- Ask poteto-mode to babysit a PR, ship a verified stack, run an autopilot queue, orchestrate a program, or audit old worktrees. These are playbooks within `poteto-mode`.

## Model routing

Cursor passes a `model:` parameter per subagent call. OpenCode pins models on named agents instead, so the role-to-model mapping lives in `agents/`:

| Agent | Role | Model |
| --- | --- | --- |
| `poteto-agent` | general delegate, reads poteto-mode in full first | `github-copilot/gpt-6-astra` |
| `poteto-coder` | mechanical implementation | `github-copilot/gpt-5.3-codex` |
| `poteto-claude` | judgment, difficult code, prose, synthesis | `github-copilot/claude-sonnet-5` |
| `poteto-gpt` | second panel family | `github-copilot/gpt-5.6-sol` |
| `poteto-grok` | exploration, swarm, Gemini panel seat | `github-copilot/gemini-3.8-flash` |
| `poteto-opus` | fourth panel seat | `github-copilot/claude-opus-5` |
| `comment-sicko` | comment cleanup | `github-copilot/claude-sonnet-5` |

Every pstack agent explicitly uses GitHub Copilot. The `/poteto-mode` command also pins `github-copilot/gpt-6-astra`. The four panel seats span Claude, GPT, and Gemini. `poteto-grok` keeps its existing routing name but runs Gemini because the detected Copilot catalog has no Grok model. All pins were confirmed by `opencode models github-copilot`.

Run `/setup-pstack` to choose other Copilot models. Changing providers requires an explicit request. Removing a model pin with `inherit-parent` or `auto` allows the caller's provider to determine routing. Skills loaded directly use the current chat model; they cannot change its provider. Use a Copilot chat or the `/poteto-mode` command for Copilot-only execution.

## What changed from upstream

The port follows upstream workflows and adapts their runtime requirements:

| Upstream (Cursor) | Here (OpenCode) |
| --- | --- |
| `subagent_type: generalPurpose` + per-call `model:`/`readonly:`/`run_in_background:` | named agents above; "review only, do not edit files" as a prompt instruction; parallel Tasks in one message |
| `name: Poteto Mode`, `mode: true` sticky-mode frontmatter | `name: poteto-mode` (OpenCode requires lowercase, matching the dir); stickiness is asked for in the command template instead |
| `/setup-pstack` writes `~/.cursor/rules/pstack-models.mdc` | edits the `model:` lines in `agents/` |
| `AskQuestion` tool | `question` tool |
| Cursor `/loop` built-in | self-driven polling (`gh pr checks --watch`, sleep-and-recheck) or in-session iteration |
| bundled Babysit and Shipping playbooks | same verdict rules, with bounded polling in the active session |
| `create-skill` built-in | the authoring-a-skill playbook + [OpenCode skill docs](https://opencode.ai/docs/skills) |
| `deslop`, `control-cli`, `control-ui` from `cursor-team-kit` | `unslop` rules applied to diffs; project-local `verify-*` skills via `create-verification-skill` |
| transcripts at `~/.cursor/projects/<slug>/agent-transcripts/` | `opencode session list` + `opencode export <sessionID>` |
| `.cursor/skills/` paths | `.opencode/skills/` / `~/.config/opencode/skills/` |
| `benny` automation pack (Slack triage) | not ported; depends on Cursor's automation runtime |
| `make-bot-ui` | not ported; requires Cursor bot routines, secret-request cards, and webhook wake events |
| explicit-invocation and sticky-mode metadata | invocation guidance in descriptions and command prose; OpenCode does not enforce Cursor's metadata |

OpenCode has no equivalent durable wake scheduler or Cursor cloud-worker placement. Long runs checkpoint their state for resumption. The bundled `orch` CLI manages state, not worker execution. Its frontier integration requires Graphite metadata. Babysit, Shipping, and autopilot use `gh` by default, with Origin when available. See [OpenCode runtime guidance](skills/poteto-mode/references/opencode-runtime.md).

## Verify

The verification tools require Python 3.9+, Bun, Node.js, and OpenCode. Bundled GitHub tools also need authenticated `gh`. The worktree audit uses `jq` and Python for transcript scanning.

```sh
bun scripts/verify.mjs
python3 scripts/verify-runtime.py
bun install --frozen-lockfile --cwd skills/poteto-mode/scripts
bun run --cwd skills/poteto-mode/scripts test
bun run --cwd skills/poteto-mode/scripts typecheck
git diff --check
```

The runtime check installs into a temporary config directory. It checks idempotence, skill and agent discovery, the plan template, and CLI entry points. It does not start a paid model session or merge a PR.

## Re-syncing with upstream

`upstream.json` records the last imported revision and excluded skills. Start from a clean working tree. Clone upstream and inventory changes against that revision:

```sh
git clone --filter=blob:none --sparse https://github.com/cursor/plugins.git /tmp/plugins
git -C /tmp/plugins sparse-checkout set pstack
python3 scripts/sync-upstream.py /tmp/plugins --to <commit>
python3 scripts/sync-upstream.py /tmp/plugins --to <commit> --apply
```

The script three-way merges changed skills against the recorded upstream base. A nonzero exit reports conflicts that need manual resolution. It does not advance the recorded revision. Resolve conflicts, run `python3 scripts/adapt-skills.py` for metadata and common substitutions, then review every changed instruction for OpenCode compatibility. The normalizer refuses unresolved conflicts.

Review upstream `agents/`, docs, and model-routing changes separately. `setup-pstack` is port-owned. Run the verification commands, summarize exclusions in the update notes, then advance `upstream.json`. Read the [upstream guide](https://github.com/cursor/plugins/tree/main/pstack/docs) for workflow examples, with the platform differences above in mind.
