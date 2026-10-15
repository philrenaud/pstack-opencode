---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, locate this project's current session transcript the way the runtime reference describes (`skills/poteto-mode/references/runtime.md`; on either host, take the newest session for this project). Confirm the project and opening user message match before reading it. Do not inspect other projects' sessions.

For each candidate session, check that the transcript's opening user message contains this conversation's opening user prompt. Take the matching session. If none resolves, write a tight digest of the session and pass that instead.

## 2. Spawn three reviewers in parallel

One message, three subagent calls. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references, so do not restrict their tools. Include "Review only. Do not edit files." in each prompt.

Match each subagent to the job by choosing the named agent, per the Subagents section of the **poteto-mode** skill.

| Lens | `subagent_type` | Prompt template |
|---|---|---|
| Judgment | `poteto-claude` | `references/judgment-reviewer.md` |
| Tooling | `poteto-gpt` | `references/tooling-reviewer.md` |
| Divergent | `poteto-claude` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the subagent response body.

## 3. Synthesize

One subagent call with `subagent_type: "poteto-claude"`. Include "Review only. Do not edit files." It spot-verifies citations through MCP. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): follow the authoring-a-skill playbook (`skills/poteto-mode/playbooks/authoring-a-skill.md`) and the skill format for your host (linked from `skills/poteto-mode/references/runtime.md`).
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): follow the authoring-a-skill playbook's description-optimization steps.
- `new skill via authoring-a-skill: <kebab-name>`: follow the authoring-a-skill playbook. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
