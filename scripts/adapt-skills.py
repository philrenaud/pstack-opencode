#!/usr/bin/env python3
"""Normalize imported skill metadata and Cursor vocabulary to the host-neutral wording both OpenCode and Claude Code read."""

from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
replacements = {
    "Cursor's built-in `create-skill` (authoring)": "the authoring-a-skill playbook (authoring)",
    "`create-skill`'s YAML rules": "the host's skill format (linked from `skills/poteto-mode/references/runtime.md`)",
    "`create-skill`'s writing guidelines": "the authoring-a-skill playbook's writing guidelines",
    "`create-skill` alone": "the authoring-a-skill playbook alone",
    "the **create-skill** skill (Cursor's built-in for authoring SKILL.md files)": "the authoring-a-skill playbook and the host's skill format (linked from `skills/poteto-mode/references/runtime.md`)",
    "the `deslop` skill from the `cursor-team-kit` plugin (`/deslop`)": "the **unslop** rules applied to the diff",
    "Run `/deslop` from `cursor-team-kit` over the diff before commit.": "Apply **unslop** to the diff before commit.",
    "`/deslop`": "**unslop** on the diff",
    "(`control-ui` or `control-cli` from `cursor-team-kit` as the change demands)": "through the project's `verify-*` skill",
    "(`control-cli` or `control-ui` from `cursor-team-kit` as the change demands)": "through the project's `verify-*` skill",
    "`control-ui` or `control-cli` from `cursor-team-kit`": "the project's `verify-*` skill",
    "One Cursor cloud agent per PR": "One subagent in an exclusive worktree per PR",
    "each a Cursor cloud agent": "each a subagent in an exclusive worktree",
    "Cursor's `/loop` command": "an in-session iteration loop",
    "`/loop` per component": "Iterate per component",
    '"/loop until X"': '"run until X"',
    "Hold the watch under `/loop` in dynamic mode.": "Run bounded watcher calls in the active session and rearm after each verdict. Persist a checkpoint before the session ends.",
    "Run `drive` and `background` under `/loop` in dynamic mode.": "Run `drive` as bounded watcher calls in the active session. In `background` mode, take one `--status-only` pass at each work checkpoint and return to the plan.",
    "a real terminal `/loop`": "an in-session audit deadline",
    "then re-read the armed `/goal`": "then re-read the recorded goal",
    "origin/main:pstack/skills/": "origin/main:skills/",
    "subagent_type: \"Comment Sicko\"": "subagent_type: \"comment-sicko\"",
    "with `subagent_type: \"poteto-agent\"` and an explicit model per the Subagents section": "with `subagent_type: \"poteto-agent\"` per the Subagents section",
    "using your configured feature model (default `grok-4.6-fast-xhigh`)": "using `subagent_type: \"poteto-coder\"`",
    "using your configured refactoring model (default `grok-4.6-fast-xhigh`)": "using `subagent_type: \"poteto-coder\"`",
    "using your configured bug-fix model (default `claude-fable-5-1-thinking-max`)": "using `subagent_type: \"poteto-claude\"`",
    "using your configured perf-issue model (default `claude-fable-5-1-thinking-max`)": "using `subagent_type: \"poteto-claude\"`",
    "using your configured hillclimb model (default `claude-fable-5-1-thinking-max`)": "using `subagent_type: \"poteto-claude\"`",
    "Ten lanes on `grok-4.6-fast-xhigh`": "Ten lanes using `subagent_type: \"poteto-grok\"`",
    "Each live lane runs on its own cloud VM at the PR head.": "Each live lane runs in its own worktree at the PR head with separate runtime ports and data.",
}
for path in (root / "skills").rglob("*.md"):
    if "node_modules" in path.parts:
        continue
    text = path.read_text()
    if re.search(r"^(<<<<<<<|=======|>>>>>>>)", text, re.M):
        raise SystemExit(f"Resolve merge conflicts manually before adapting {path}")
    if path.name == "SKILL.md":
        text = re.sub(r"^name:.*$", f"name: {path.parent.name}", text, count=1, flags=re.M)
        text = re.sub(r"^(?:disable-model-invocation|mode|icon|color|reminder|paths|user-invocable):.*\n", "", text, flags=re.M)
        if path.parent.name.startswith("principle-"):
            text = text.replace("\n---\n", "\nuser-invocable: false\n---\n", 1)
    text = text.replace("~/.cursor/skills/", "<personal-skills>/")
    text = text.replace(".cursor/skills/", "<project-skills>/")
    text = text.replace("AskQuestion", "the host's question tool")
    text = text.replace("Cursor restart", "host restart")
    for cursor, neutral in (("the `Task` tool", "the subagent tool"), ("the Task tool", "the subagent tool"), ("`Task` calls", "subagent calls"), ("`Task` call", "subagent call"), ("Spawn `Task` with", "Spawn a subagent with"), ("one Task each", "one subagent each"), ("Task subagent", "subagent"), ("`Task` prompts", "subagent prompts")):
        text = text.replace(cursor, neutral)
    text = text.replace("arm a `/goal` with the full program objective", "record the full program objective in the durable run state")
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = text.replace("git show origin/main:skills/", "git -C <pstack-clone> show origin/main:skills/")
    text = re.sub(r'- `subagent_type`: `generalPurpose`\n- `model`: your configured how-explorer model .*?\n- `readonly`: `true`', '- `subagent_type`: `poteto-grok`\n- Include "Review only. Do not edit files." in the prompt.', text)
    text = re.sub(r'- `subagent_type`: `generalPurpose`\n- `model`: your configured how-explainer model .*?\n- `readonly`: `true`', '- `subagent_type`: `poteto-claude`\n- Include "Review only. Do not edit files." in the prompt.', text)
    text = re.sub(r"A local root arms each tick as an in-session audit deadline\..*?Never leave the cadence to memory or lossy completion notifications\.", "Record the next audit time in the durable run state and check it between tool calls and worker completions; on a host with `/loop`, arm the tick with it (see `../references/runtime.md`). Before ending the session, checkpoint the goal, owners, and next audit time so another session can resume.", text)
    text = text.rstrip() + "\n"
    if text != path.read_text():
        path.write_text(text)

for relative in ("reflect/SKILL.md", "show-me-your-work/SKILL.md", "poteto-mode/playbooks/eval.md", "poteto-mode/playbooks/session-pickup.md"):
    path = root / "skills" / relative
    text = path.read_text()
    text = re.sub(r"The parent finds its own transcript file.*?unrelated projects\.", "The parent locates this project's current session transcript the way the runtime reference describes (`skills/poteto-mode/references/runtime.md`). Confirm the project and opening user message match before reading it. Do not inspect other projects' sessions.", text)
    text = re.sub(r"Read this run's transcript under.*?unrelated private chats\.", "Locate this project's session transcript per the runtime reference (`skills/poteto-mode/references/runtime.md`). Confirm its project and opening prompt before using it.", text)
    text = re.sub(r"Read each candidate's local transcript under.*?unrelated projects\.", "Read each candidate's session transcript per the runtime reference (`../references/runtime.md`). Check that it belongs to this project and evaluation before reading it.", text)
    text = re.sub(r"A local transcript under.*?unrelated projects\), a cloud-agent URL, or a pushed branch\.", "Use this project's prior session transcript (located per `../references/runtime.md`), a supplied session export, or a pushed branch.", text)
    if text != path.read_text():
        path.write_text(text)
