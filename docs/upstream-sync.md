# Upstream sync to v0.15.1

This sync covers `cursor/plugins/pstack` between the original [v0.11.3 baseline](https://github.com/cursor/plugins/commit/3fe2823ce17c) and [v0.15.1](https://github.com/cursor/plugins/commit/f8abeddd1862dc73704e3d719dd73df0d51b8c71). The target is the latest pstack change found on September 9, 2026.

## Changes available in OpenCode

| Upstream change | What users get |
| --- | --- |
| [Verification examples and interface guidance](https://github.com/cursor/plugins/commit/4483dcd246c3) | A feature-map example with create and search recipes. Architect now requires distinct whole-design candidates and screens for shallow modules, information leaks, temporal decomposition, and pass-through methods. |
| [Swarm](https://github.com/cursor/plugins/commit/91dd7b711988) | Parallel coverage, races, and exploration with declared selection rules and explicit missing-worker reports. |
| [Autopilot and writing workflows](https://github.com/cursor/plugins/commit/b047069f4f3a) | `no-comments`, Comment Sicko, `technical-writing`, Autopilot-full, and Autopilot-stack. One owner carries each PR through its lifecycle. Independent verification gates the final merge or stack entry. |
| [Program and PR workflows](https://github.com/cursor/plugins/commit/99559f2f5204) | `bro`, Babysit, Shipping, Orchestrate, worktree cleanup, Bugbot triage, and bundled watcher and coordinator tools. |
| [Verified multi-PR checklist](https://github.com/cursor/plugins/commit/bdf7aa355337) | Plans carry unit, live, and performance evidence, ten live verification lanes, review gates, and a runnable plan checker. |
| [Forge-neutral workflows and boundary guidance](https://github.com/cursor/plugins/commit/23a56e2dac2e) | GitHub CLI defaults, optional Origin, bottom-up verified shipping, current patch checks, and runtime schemas preferred over handwritten TypeScript guards. |
| [September skill audit](https://github.com/cursor/plugins/commit/e8d856f0273b) | Shorter instructions, two new principles, Attack the Premise and Test Behavior Not Implementation, and removal of How's critique mode. Architecture reviews go through Interrogate. |
| [Prose cleanup](https://github.com/cursor/plugins/commit/d7cde2b84ead) and [claim evidence](https://github.com/cursor/plugins/commit/f8abeddd1862) | Plainer sentences and a requirement that each claim include evidence or identify itself as measured, inferred, or a guess. |

Other imported changes include constructive type modeling, an Opus panel seat, model inheritance aliases, nested personal mode skills, stronger autonomous-run ownership, and tighter PR briefings. The mode no longer requires a principles-read todo at the start of every task. It still requires reading the leaf for each principle applied.

The resulting tree contains 46 skills, 23 principles, 23 playbooks, and seven agents. Regenerate counts with `bun scripts/verify.mjs`.

## OpenCode adaptations

Models live in named agents shared by OpenCode and Claude Code: `opencode/agents/` is the source and `claude/agents/` is rendered from it. Every agent and the OpenCode `/poteto-mode` command pins an available Anthropic model. The panel uses Opus 5 (`poteto-claude`, `poteto-opus`), Sonnet 5 (`poteto-gpt`), and Haiku 4.5 (`poteto-grok`). General delegates use Fable 5.1, code delegates and comment cleanup use Sonnet 5. The `poteto-gpt` and `poteto-grok` routing names are kept for compatibility with the skills that reference them; the routing was originally GitHub Copilot with GPT and Gemini seats.

Workers use exclusive local worktrees with separate runtime ports and data. They receive no unsupported subagent arguments. Review-only work is specified in the prompt. Skill text is host-neutral: it names the subagent tool, asking the user, the transcript, and the skills directory as roles, and `skills/poteto-mode/references/runtime.md` maps each to OpenCode or Claude Code. Transcript consumers stay project-scoped on both hosts.

Long-running workflows record audit deadlines and checkpoints. They cannot wake a stopped OpenCode session; on Claude Code the playbooks arm the audit tick with `/loop`. The watcher polls in bounded calls. `orch` manages durable state through `ORCH_STORE` or `--store`; its Graphite frontier integration remains optional to the rest of pstack.

The plan checker uses OpenCode agent names and a recorded goal instead of Cursor model slugs and `/goal`. The worktree audit accepts project-scoped session exports, preserves paths with spaces, and requires session inspection before deletion. Closed PRs and untracked work do not imply safe deletion.

## Exclusions

- `make-bot-ui` requires Cursor's `update_state` routine API, secret-request cards, and bot webhook wake events. It has no equivalent runtime in this port.
- The existing Benny automation pack remains excluded because it depends on Cursor automations.
- Cursor marketplace metadata, logo assets, and illustrated guide files stay upstream. The README links to the guide rather than copying Cursor installation instructions.
- Cursor-only frontmatter is removed. OpenCode does not enforce upstream's explicit-invocation or sticky-mode flags.

## Verification and maintenance

`scripts/sync-upstream.py` inventories and three-way merges future skill updates. `scripts/adapt-skills.py` rewrites Cursor vocabulary to the host-neutral wording after manual conflict resolution, and adds `user-invocable: false` to principle leaves. `scripts/claude-agents.mjs` renders `claude/agents/`. `upstream.json` records the import base.

`scripts/verify.mjs` checks frontmatter for both agent formats, references, agent names, host-specific wording outside the runtime reference, rendered-agent freshness, and index coverage. `scripts/verify-runtime.py` exercises both installers and OpenCode discovery in temporary configurations, tests the shipped plan template and a missing-lane failure, and runs the actual coordinator and watcher entry points. The bundled Bun suites cover watcher policy, GitHub responses, and coordinator persistence.

The sync uses an upstream inventory, three-way merge, platform adaptation, and runtime verification sequence. Runtime tests carry the highest rigor here because the new PR tooling makes decisions from persisted state and GitHub responses. The local decision trail is `.audit/upstream-sync.tsv`.

The initial checks passed 52 Bun tests with 206 assertions. After Copilot-backed review and fixes, 58 tests with 221 assertions pass, alongside strict watcher typechecking, structural validation, installation and discovery, and CLI smoke tests. Real git fixtures cover relocated installs, spaced worktree and transcript paths, untracked work, and closed-but-unmerged branches. A live read-only watcher call against `cursor/plugins#336` returned GitHub status and withheld readiness for unknown mergeability.

Sonnet 5, GPT 5.6 Sol, and Opus 5 completed independent reviews through GitHub Copilot. Gemini 3.8 Flash timed out without a verdict. Opus also reviewed the resulting watcher fixes. See [the review record](review.md) for findings and outcomes. Full autonomous programs, live PR mutations, and the Graphite frontier integration were not exercised.
