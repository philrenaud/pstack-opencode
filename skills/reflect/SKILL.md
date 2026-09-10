---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

The parent locates this project's session with `opencode session list` and exports it with `opencode export <sessionID>`. Confirm the project and opening user message match before reading it. Do not inspect other projects' sessions.

```bash
opencode session list
opencode export <sessionID> > /tmp/reflect-transcript.json
```

For each candidate, check that the export's opening user message contains this conversation's opening user prompt. Take the matching session. If none resolves, write a tight digest of the session and pass that instead.

### 2. Spawn three reviewers in parallel

One message, three `Task` calls using the agents below. Include "Review only. Do not edit files." in each prompt. Reviewers may use available MCP tools for context lookups.

| Lens | `subagent_type` | Prompt template |
|---|---|---|
| Judgment | `poteto-claude` | `references/judgment-reviewer.md` |
| Tooling | `poteto-gpt` | `references/tooling-reviewer.md` |
| Divergent | `poteto-claude` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `Task` response body.

### 3. Synthesize

One `Task` call with `subagent_type: "poteto-claude"`. Include "Review only. Do not edit files." The synthesizer's quality check includes spot-verifying citations with available MCP tools. Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. The synthesizer returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. See the **encode-lessons-in-structure** principle skill.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Only the Accepted list waits for approval.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): follow the authoring-a-skill playbook (`skills/poteto-mode/playbooks/authoring-a-skill.md`) and the OpenCode skill format (https://opencode.ai/docs/skills).
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): rewrite the description per the authoring-a-skill playbook, front-loading trigger keywords.
- `new skill via authoring-a-skill: <kebab-name>`: create it via the authoring-a-skill playbook. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
