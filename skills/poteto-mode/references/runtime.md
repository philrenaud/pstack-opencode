# Runtime reference

pstack runs on two agent hosts from the same skill tree. Skill text names the role, not the host's tool. This file maps each role to the host you are running in. Read the section for your host once per session.

| Role in the skills | OpenCode | Claude Code |
| --- | --- | --- |
| The subagent tool | `Task` | `Agent` |
| Naming an agent | `subagent_type: "poteto-claude"` | same |
| Asking the user a question | `question` | `AskUserQuestion` |
| Loading a skill | the skill tool | the `Skill` tool |
| The todolist | the todo tools | `TodoWrite`, or `TaskCreate`/`TaskUpdate` when enabled |
| This project's transcripts | `opencode session list`, `opencode export <sessionID>` | `~/.claude/projects/<encoded-cwd>/*.jsonl` |
| Project-local skills | `.opencode/skills/<name>/` | `.claude/skills/<name>/` |
| Personal skills | `~/.config/opencode/skills/<name>/` | `~/.claude/skills/<name>/` |
| Skill format docs | https://opencode.ai/docs/skills | https://code.claude.com/docs/en/skills |
| MCP configuration | `opencode.json` `mcp` key | `.mcp.json` and settings `mcpServers` |
| Durable wake scheduler | none | `/loop` and scheduled agents |

Both hosts read the same `SKILL.md` frontmatter. Claude Code also honours `user-invocable: false`, which hides the `principle-*` leaves from its slash menu; OpenCode ignores the key.

## Subagents on both hosts

Select models by `subagent_type`. The pins live in this repo: `opencode/agents/` is the source and `claude/agents/` is rendered from it by `scripts/claude-agents.mjs`, mapping the Anthropic IDs to Claude Code aliases (`best`, `opus`, `sonnet`, `haiku`). Neither host accepts Cursor's per-call model, cloud-placement, or readonly fields; say "Review only. Do not edit files." in the prompt instead. Submit independent subagent calls together in one message. Give every writing worker an exclusive worktree and every runtime lane separate ports, data, and output paths.

Store durable program state under `.pstack/state/orchestrate/<project-slug>/` in the target project, or a caller-provided path. Set `ORCH_STORE` to its absolute path for every `orch` invocation, or pass `--store`. Keep runtime state out of source control unless the user wants it reviewed.

The bundled `orch` CLI only manages state. It does not spawn workers or schedule wakeups. Its `frontier set --repo` integration requires Graphite `gt` metadata in the stack owner's checkout. Other bookkeeping commands work without Graphite. Babysit, Shipping, and the autopilot playbooks use `gh` by default and do not require Graphite. Use those workflows for a GitHub-only stack.

Run bundled tools by absolute path from the target repository. Relative `scripts/` paths in playbooks resolve from the `poteto-mode` skill directory, not the target repository. The tools require Bun. `watch-pr` and `orch` install their locked dependencies on first execution. The GitHub watcher also needs authenticated `gh`; the worktree audit needs `git`, `gh`, and `jq`, plus Python 3 when scanning transcripts.

Pass an explicit deadline in seconds to the watcher, such as `watch-pr --owner <owner> --repo <repo-name> --pr <number> --timeout 60 --interval 10`, with a shell-tool timeout longer than 60 seconds. Unlike `gh`, this CLI's `--repo` takes the repository name alone, with a separate `--owner`. For one nonblocking observation, pass `--status-only --timeout 60`. A `TIMEOUT` verdict with exit code 5 ends this observation window, not the overall task. Read its reason, checkpoint if needed, and rearm while the task remains active. The default `--timeout 0` disables the deadline and is unsuitable for bounded session polling.

## OpenCode

Subagents run while the session is active and there is no durable wake scheduler. Record the goal and next audit deadline in the run state, check deadlines between tool calls and worker completions, and checkpoint before exiting. Do not claim an unattended run will wake after OpenCode stops. Use bounded watcher calls so a polling process does not consume the session indefinitely.

Find transcripts with `opencode session list` and export the matching project session with `opencode export <sessionID>`. Check its directory and opening prompt before reading. A transcript timestamp does not prove an agent is alive. Set `PSTACK_TRANSCRIPT_DIR` to a directory of this project's exports when the worktree audit should score session usage.

Agent and command changes need an OpenCode restart. Skill edits apply on the next load.

## Claude Code

Subagent calls return a notification when they finish; do not poll for them. Nesting is allowed to a bounded depth, so a coordinator may spawn sub-coordinators that spawn workers. `/loop` reruns a prompt on an interval or self-paced, which covers the audit ticks in the autopilot and orchestrate playbooks while the session stays open; scheduled agents cover unattended runs. Record the goal and next audit deadline in the run state anyway, so a resumed session can pick up.

Transcripts live at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`, where `<encoded-cwd>` is the workspace path with each `/` turned into `-`, so `/Users/you/proj` becomes `-Users-you-proj`. Every line is one message. Read only the current project's directory; other directories are unrelated private chats. Order candidates by modification time, never by name. Set `PSTACK_TRANSCRIPT_DIR` to that directory when the worktree audit should score session usage.

The pins in `claude/agents/` use aliases, so the plan's model access decides what `best` and `opus` resolve to. Subscription plans bill every subagent against the plan; no API key is involved. Agent changes need a Claude Code restart. Installed by symlink, skill edits apply on the next load.
