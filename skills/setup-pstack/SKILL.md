---
name: setup-pstack
description: Configure which models pstack uses per role. Detects your available models and updates the pstack agent definitions that pin them. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

pstack routes models through named OpenCode agents rather than per-call model parameters. The role-to-model mapping lives in the agent files in this repo's `agents/` directory (`../../agents/` relative to this skill). Editing a `model:` line there changes the model for every skill that spawns that agent.

## Roles

| Agent | Role | Used by |
| --- | --- | --- |
| `poteto-agent` | general delegate, inherits the caller's model | playbook delegates, plan exploration |
| `poteto-coder` | fast, precisely specified implementation | feature, bug-fix, perf, hillclimb, refactoring delegates |
| `poteto-claude` | judgment, prose, synthesis panelist | how explainer, why synthesizer, reflect judgment, interrogate/arena/architect panels |
| `poteto-gpt` | second panelist family | interrogate/arena/architect panels, how critics |
| `poteto-grok` | fast exploration plus third panelist family | how explorer, why investigators, reflect tooling, panels |

## Steps

### 1. Detect available models

Run `opencode models`. That list is the dependable source; never write a model ID you have not seen in it. Model IDs are `provider/model-id` (for example `openrouter/anthropic/claude-opus-4.8`).

### 2. Load current state

Read every file in this repo's `agents/` directory and collect each agent's `model:` frontmatter line (absent means it inherits the caller's model).

### 3. Map and confirm

Show every agent with its current model, marking any whose model is not in the detected list as needing a choice. Use the `question` tool to ask whether to accept as-is or change specific agents, offering detected models as options. Panel diversity matters: `poteto-claude`, `poteto-gpt`, and `poteto-grok` should stay on three different model families, since cross-model agreement is the signal `interrogate` and `arena` rely on.

### 4. Validate and write

Every model ID written must be in the detected list. Edit only the `model:` frontmatter line of each agent file; leave prompts and permissions alone. Re-runs stay idempotent.

### 5. Confirm

Tell the user which agents changed and that OpenCode must be restarted for agent changes to take effect. If the agent files are symlinked into `~/.config/opencode/agents/`, the edits apply there automatically; if they were copied, re-copy.

### 6. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke the **create-verification-skill** skill. On no, move on without pushing.
