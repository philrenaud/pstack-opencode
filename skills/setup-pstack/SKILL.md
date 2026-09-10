---
name: setup-pstack
description: Configure which models pstack uses per role. Detects your available models and updates the pstack agent definitions that pin them. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

pstack routes models through named OpenCode agents rather than per-call model parameters. The role-to-model mapping lives in the agent files in this repo's `agents/` directory (`../../agents/` relative to this skill). Editing a `model:` line there changes the model for every skill that spawns that agent.

## Roles

| Agent | Role | Used by |
| --- | --- | --- |
| `poteto-agent` | general delegate, GPT through Copilot | playbook delegates, plan exploration |
| `poteto-coder` | fast, precisely specified mechanical implementation | feature and refactoring delegates |
| `poteto-claude` | judgment, prose, difficult code, synthesis | how explainer, why synthesizer, reflect judgment/divergent, bug-fix/perf/hillclimb, panels |
| `poteto-gpt` | second panelist family | interrogate/arena/architect panels, reflect tooling |
| `poteto-grok` | fast exploration plus third panelist family | how explorer, why investigators, swarm, panels |
| `poteto-opus` | fourth panel seat | interrogate/arena/architect panels |
| `comment-sicko` | comment cleanup, Claude through Copilot | no-comments |

## Steps

### 1. Detect available models

Run `opencode models github-copilot`. This port uses GitHub Copilot for every role, including general delegates, comment cleanup, and the `/poteto-mode` command. Never write a model ID you have not seen in the detected list. Model IDs are `provider/model-id`, such as `github-copilot/claude-opus-5`. Change providers only when the user explicitly requests it.

### 2. Load current state

Read every file in this repo's `agents/` directory and `commands/poteto-mode.md`. Collect each `model:` frontmatter line. A missing line inherits the caller's model and does not guarantee the Copilot-only policy.

### 3. Map and confirm

Show every role with its current model, marking missing pins and unavailable models as needing a choice. If the user already specified the provider or models, apply that choice directly. Otherwise use `question` to offer detected Copilot models. Keep at least three model families across the panel. The defaults use Sonnet and Opus from Anthropic, GPT from OpenAI, and Gemini from Google. `poteto-grok` is the existing routing name for the Gemini seat; agent names do not determine their model family.

### 4. Validate and write

Every model ID written must appear in the detected list and start with `github-copilot/`. Edit only the `model:` frontmatter lines in agents and the command. Leave prompts and permissions alone. Re-runs stay idempotent. If the user explicitly requests `inherit-parent` or `auto`, explain that inheritance no longer guarantees Copilot-only routing, then remove the pin. Never write those aliases as model IDs.

### 5. Confirm

Tell the user which agents changed and that OpenCode must be restarted for agent changes to take effect. If the agent files are symlinked into `~/.config/opencode/agents/`, the edits apply there automatically; if they were copied, re-copy.

### 6. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke the **create-verification-skill** skill. On no, move on without pushing.
