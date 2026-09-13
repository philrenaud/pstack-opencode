---
name: setup-pstack
description: Configure which models pstack uses per role. Detects your available models and updates the pstack agent definitions that pin them. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

pstack routes models through named agents rather than per-call model parameters. The role-to-model mapping lives in this repo's `opencode/agents/` directory (`../../opencode/agents/` relative to this skill). Those files are the single source: `claude/agents/` is rendered from them by `scripts/claude-agents.mjs`, which maps each Anthropic model ID to the Claude Code alias for its tier. Editing a `model:` line in `opencode/agents/` and re-rendering changes the model for every skill that spawns that agent on both hosts.

## Roles

| Agent | Role | Used by |
| --- | --- | --- |
| `poteto-agent` | general delegate, strongest model | playbook delegates, plan exploration |
| `poteto-coder` | fast, precisely specified mechanical implementation | feature and refactoring delegates |
| `poteto-claude` | judgment, prose, difficult code, synthesis | how explainer, why synthesizer, reflect judgment/divergent, bug-fix/perf/hillclimb, panels |
| `poteto-gpt` | second panel seat | interrogate/arena/architect panels, reflect tooling |
| `poteto-grok` | fast exploration plus third panel seat | how explorer, why investigators, swarm, panels |
| `poteto-opus` | fourth panel seat | interrogate/arena/architect panels |
| `comment-sicko` | comment cleanup | no-comments |

## Steps

### 1. Detect available models

Identify the host first; `skills/poteto-mode/references/runtime.md` describes both.

- **OpenCode.** Run `opencode models <provider>` for each provider currently pinned in `opencode/agents/` (`opencode models anthropic` by default; `opencode models` with no argument lists every configured provider). Never write a model ID you have not seen in the detected list. Model IDs are `provider/model-id`, such as `anthropic/claude-opus-5`. Change providers only when the user explicitly requests it, and only to a provider whose models `opencode models` lists.
- **Claude Code.** There is no catalog command. The renderer maps `anthropic/claude-fable-5-1` to `best`, `claude-opus-5` to `opus`, `claude-sonnet-5` to `sonnet`, and `claude-haiku-4-5` to `haiku`; any other ID is written without its provider prefix. Aliases resolve per plan, so a pin never fails on a plan that lacks a model, and `best` is Fable when the account has it and Opus otherwise. Offer those four tiers.

### 2. Load current state

Read every file in `opencode/agents/` and `opencode/commands/poteto-mode.md`. Collect each `model:` frontmatter line. A missing line inherits the caller's model and does not guarantee the pinned-provider policy.

### 3. Map and confirm

Show every role with its current model, marking missing pins and unavailable models as needing a choice. If the user already specified the provider or models, apply that choice directly. Otherwise ask the user, offering the detected models. Keep at least three distinct models across the panel so independent review is not the same model under different names. With a single provider, distinct tiers count: the defaults use Fable 5.1 for `poteto-agent`, Opus 5 for `poteto-claude` and `poteto-opus`, Sonnet 5 for `poteto-gpt`, `poteto-coder`, and `comment-sicko`, and Haiku 4.5 for `poteto-grok`. `poteto-gpt` and `poteto-grok` are existing routing names; agent names do not determine their model.

### 4. Validate and write

Every model ID written must appear in the detected list for its provider and carry a `provider/` prefix. Edit only the `model:` frontmatter lines in `opencode/agents/` and the command. Leave prompts and permissions alone. Then run `bun scripts/claude-agents.mjs` from the repo root so `claude/agents/` matches; `bun scripts/verify.mjs` fails while they differ. Re-runs stay idempotent. If the user explicitly requests `inherit-parent` or `auto`, explain that inheritance no longer guarantees pinned-provider routing, then remove the pin. Never write those aliases as model IDs.

### 5. Confirm

Tell the user which agents changed and that the host must be restarted for agent changes to take effect. Both installs symlink the agent files (`~/.config/opencode/agents/` and `~/.claude/agents/`), so the edits apply there automatically; if they were copied, re-copy.

### 6. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke the **create-verification-skill** skill. On no, move on without pushing.
