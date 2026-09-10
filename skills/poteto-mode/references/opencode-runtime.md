# OpenCode runtime

Use the active Task schema. Select models by `subagent_type`, with defaults in this repo's `agents/` directory. Task does not accept Cursor's per-call model, cloud-placement, or background-execution fields. Submit independent Tasks together. Give every writing worker an exclusive worktree and every runtime lane separate ports, data, and output paths.

Long-running playbooks run while the OpenCode session is active. There is no durable wake scheduler in this port. Record the goal and next audit deadline in the run state, check deadlines between tool calls and worker completions, and checkpoint before exiting. Do not claim an unattended run will wake after OpenCode stops. Use bounded watcher calls so a polling process does not consume the session indefinitely.

Pass an explicit deadline in seconds, such as `watch-pr --owner <owner> --repo <repo-name> --pr <number> --timeout 60 --interval 10`, with a shell-tool timeout longer than 60 seconds. Unlike `gh`, this CLI's `--repo` takes the repository name alone, with a separate `--owner`. For one nonblocking observation, pass `--status-only --timeout 60`. A `TIMEOUT` verdict with exit code 5 ends this observation window, not the overall task. Read its reason, checkpoint if needed, and rearm while the task remains active. The default `--timeout 0` disables the deadline and is unsuitable for bounded session polling.

Store durable program state under `.opencode/state/orchestrate/<project-slug>/` in the target project, or a caller-provided path. Set `ORCH_STORE` to its absolute path for every `orch` invocation, or pass `--store`. Keep runtime state out of source control unless the user wants it reviewed.

The bundled `orch` CLI only manages state. It does not spawn workers or schedule wakeups. Its `frontier set --repo` integration requires Graphite `gt` metadata in the stack owner's checkout. Other bookkeeping commands work without Graphite. Babysit, Shipping, and the autopilot playbooks use `gh` by default and do not require Graphite. Use those workflows for a GitHub-only stack.

Run bundled tools by absolute path from the target repository. Relative `scripts/` paths in playbooks resolve from the `poteto-mode` skill directory, not the target repository. The tools require Bun. `watch-pr` and `orch` install their locked dependencies on first execution. The GitHub watcher also needs authenticated `gh`; the worktree audit needs `git`, `gh`, and `jq`, plus Python 3 when scanning transcript exports.

Find transcripts with `opencode session list` and export the matching project session with `opencode export <sessionID>`. Check its directory and opening prompt before reading. A transcript timestamp does not prove an agent is alive.
