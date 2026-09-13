# pstack-opencode

An [OpenCode](https://opencode.ai) and [Claude Code](https://code.claude.com) port of [pstack](https://github.com/cursor/plugins/tree/main/pstack), Lauren Tan (poteto)'s rigorous-engineering plugin for Cursor. MIT licensed upstream, which explicitly invites forks. All credit for the substance to her; this repo adapts the plumbing.

Lives at [github.com/philrenaud/pstack-opencode](https://github.com/philrenaud/pstack-opencode). Synced through upstream **v0.15.1**, commit [`f8abeddd1862`](https://github.com/cursor/plugins/commit/f8abeddd1862dc73704e3d719dd73df0d51b8c71). See [the update notes](docs/upstream-sync.md) for changes since v0.11.3 and the remaining platform differences.

pstack is a discipline layer for coding agents: playbooks that force reproduction before fixes, principles the agent must cite when they shape a decision, multi-model adversarial review, and anti-slop prose rules. Almost all of it is markdown, which is why it ports.

## Layout

```
skills/            46 skills, including 23 principles and 23 poteto-mode playbooks; read by both hosts
opencode/agents/   7 subagents in OpenCode format, the source of truth for role prompts and model pins
opencode/commands/ /poteto-mode slash command (OpenCode only; Claude Code invokes the skill directly)
claude/agents/     the same 7 subagents in Claude Code format, rendered by scripts/claude-agents.mjs
scripts/           upstream sync, agent rendering, and verification tools
```

One skill tree serves both hosts. Skill text names roles (the subagent tool, asking the user, the transcript, the skills directory) and [`references/runtime.md`](skills/poteto-mode/references/runtime.md) maps each role to the host's tool and paths.

## Install

Clone it anywhere, then run the install script from inside the clone:

```sh
git clone https://github.com/philrenaud/pstack-opencode.git
cd pstack-opencode
./install.sh            # OpenCode
./install.sh claude     # Claude Code
./install.sh all        # both
```

The clone is the live source of truth; nothing is copied and `git pull` is the update mechanism. The script is idempotent (re-run it if you move the clone).

For OpenCode it registers `skills/` via `skills.paths` in `~/.config/opencode/opencode.json` (printing the line to add if a config already exists without it), and symlinks `opencode/agents/*.md` and `opencode/commands/*.md` into `~/.config/opencode/agents/` and `commands/`. Restart OpenCode, then verify with `opencode debug skill` and `opencode agent list`.

For Claude Code it symlinks each skill directory into `~/.claude/skills/` and `claude/agents/*.md` into `~/.claude/agents/`. Restart Claude Code, then type `/` to see `poteto-mode` and the other pstack skills in the menu and `/agents` to see the seven agents. The 23 `principle-*` leaves carry `user-invocable: false`, so they load when a skill cites them but stay out of the menu. Running under a Claude subscription, every subagent bills to the plan; no API key is involved. Set `CLAUDE_CONFIG_DIR` to install somewhere other than `~/.claude`.

Re-run `./install.sh` after updates that add skills or agents. Edits to any file here apply on the next host restart.

## Use

Run `./learn` for the interactive learning dashboard (OpenCode only; it reads OpenCode's session database). It lists the installed skills and playbooks, shows recent loads and consultations, and gives a copyable invocation for each. Press `/` to search, `u` for not-observed entries, and `?` for help. See [the learner guide](docs/learn.md) for scope filters and evidence limits.

- `/poteto-mode <task>` at the start of anything that needs rigor. It matches the task to a playbook (bug fix, feature, perf, refactoring, prototype, autonomous run, ...), copies the playbook steps into a todolist verbatim, and routes to the other skills as steps fire.
- The other skills also load on demand when a task matches their description, or by asking for them by name: `how`, `why`, `interrogate` (multi-model adversarial review), `arena` (N parallel attempts, graft the best), `architect`, `unslop`, `tdd`, `teach`, `blast-radius`, `reflect`, `recall`, `automate-me`.
- `setup-pstack` reconfigures which models the roles use.
- `swarm` covers parallel slices or races. `arena` compares candidate designs and combines the strongest parts.
- `no-comments` runs the Comment Sicko cleanup delegate. `technical-writing` handles docs and PR prose. `bro` restates the previous answer in plain language.
- Ask poteto-mode to babysit a PR, ship a verified stack, run an autopilot queue, orchestrate a program, or audit old worktrees. These are playbooks within `poteto-mode`.

## Model routing

Cursor passes a `model:` parameter per subagent call. This port pins models on named agents instead, so the role-to-model mapping lives in `opencode/agents/`, and `scripts/claude-agents.mjs` renders `claude/agents/` from it with each Anthropic ID mapped to the Claude Code alias for its tier:

| Agent | Role | OpenCode | Claude Code |
| --- | --- | --- | --- |
| `poteto-agent` | general delegate, reads poteto-mode in full first | `anthropic/claude-fable-5-1` | `best` |
| `poteto-coder` | mechanical implementation | `anthropic/claude-sonnet-5` | `sonnet` |
| `poteto-claude` | judgment, difficult code, prose, synthesis | `anthropic/claude-opus-5` | `opus` |
| `poteto-gpt` | second panel seat | `anthropic/claude-sonnet-5` | `sonnet` |
| `poteto-grok` | exploration, swarm, fast panel seat | `anthropic/claude-haiku-4-5` | `haiku` |
| `poteto-opus` | fourth panel seat | `anthropic/claude-opus-5` | `opus` |
| `comment-sicko` | comment cleanup | `anthropic/claude-sonnet-5` | `sonnet` |

Every pstack agent and the OpenCode `/poteto-mode` command explicitly pins an Anthropic model. The four panel seats span Opus, Sonnet, and Haiku; with a single provider, independent review comes from different model tiers rather than different vendors. `poteto-gpt` and `poteto-grok` keep their existing routing names. The OpenCode pins were confirmed by `opencode models anthropic`. The Claude Code aliases resolve per plan, so a pin never fails on a plan that lacks a model; `best` is Fable when the account has it and Opus otherwise. On Claude Code, `/poteto-mode` runs on the session's model.

Run `/setup-pstack` to choose other models. On OpenCode it reads the provider from each pin, so any provider `opencode models <provider>` can list is valid; on Claude Code it offers the alias tiers. After editing `opencode/agents/`, run `bun scripts/claude-agents.mjs` so `claude/agents/` follows. Removing a model pin with `inherit-parent` or `auto` allows the caller's provider to determine routing. Skills loaded directly use the current chat model; they cannot change its provider. Use the `/poteto-mode` command to force the pinned model.

## What changed from upstream

The port follows upstream workflows and adapts their runtime requirements:

| Upstream (Cursor) | Here |
| --- | --- |
| `subagent_type: generalPurpose` + per-call `model:`/`readonly:`/`run_in_background:` | named agents above; "review only, do not edit files" as a prompt instruction; parallel Tasks in one message |
| `name: Poteto Mode`, `mode: true` sticky-mode frontmatter | `name: poteto-mode` (both hosts require lowercase, matching the dir); stickiness is asked for in the skill and command prose instead |
| `/setup-pstack` writes `~/.cursor/rules/pstack-models.mdc` | edits the `model:` lines in `opencode/agents/` and re-renders `claude/agents/` |
| `AskQuestion` tool | "ask the user"; `question` on OpenCode, `AskUserQuestion` on Claude Code |
| Cursor `/loop` built-in | bounded polling in the active session on OpenCode; Claude Code's own `/loop` where the playbook arms an audit tick |
| bundled Babysit and Shipping playbooks | same verdict rules, with bounded polling in the active session |
| `create-skill` built-in | the authoring-a-skill playbook + the host's skill docs, linked from the runtime reference |
| `deslop`, `control-cli`, `control-ui` from `cursor-team-kit` | `unslop` rules applied to diffs; project-local `verify-*` skills via `create-verification-skill` |
| transcripts at `~/.cursor/projects/<slug>/agent-transcripts/` | OpenCode session exports, or `~/.claude/projects/<encoded-cwd>/*.jsonl`; skills say "the transcript" and the runtime reference locates it |
| `.cursor/skills/` paths | `<project-skills>` / `<personal-skills>`, resolved per host in the runtime reference |
| `benny` automation pack (Slack triage) | not ported; depends on Cursor's automation runtime |
| `make-bot-ui` | not ported; requires Cursor bot routines, secret-request cards, and webhook wake events |
| explicit-invocation and sticky-mode metadata | invocation guidance in descriptions and command prose; `user-invocable: false` hides the principle leaves from Claude Code's menu |

Neither host offers Cursor's cloud-worker placement, and OpenCode has no durable wake scheduler. Long runs checkpoint their state for resumption. The bundled `orch` CLI manages state, not worker execution. Its frontier integration requires Graphite metadata. Babysit, Shipping, and autopilot use `gh` by default, with Origin when available. See the [runtime reference](skills/poteto-mode/references/runtime.md).

## Verify

The verification tools require Python 3.9+, Bun 1.2.21 or newer, Node.js, and OpenCode. Bundled GitHub tools also need authenticated `gh`. The worktree audit uses `jq` and Python for transcript scanning. `verify.mjs` also fails when `claude/agents/` is stale relative to `opencode/agents/`; `verify-runtime.py` exercises both installers in temporary config directories.

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
