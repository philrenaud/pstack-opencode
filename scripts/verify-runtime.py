#!/usr/bin/env python3
"""Exercise installation, OpenCode discovery, and the bundled command entry points."""

import json
import os
import re
import shutil
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
tools = root / "skills/poteto-mode/scripts"


def run(*args, env=None, cwd=root, expected=0):
    with tempfile.TemporaryFile() as output:
        result = subprocess.run(args, cwd=cwd, env=env, stdout=output, stderr=subprocess.PIPE, timeout=120)
        output.seek(0)
        text = output.read().decode()
    assert result.returncode == expected, f"{args}: {result.returncode}\n{text}\n{result.stderr.decode()}"
    return text


with tempfile.TemporaryDirectory(prefix="pstack-verify-") as temporary:
    base = Path(temporary)
    env = {**os.environ, "XDG_CONFIG_HOME": str(base / "config")}
    run("bash", str(root / "install.sh"), env=env)
    config = base / "config/opencode/opencode.json"
    initial = config.read_bytes()
    run("bash", str(root / "install.sh"), env=env)
    assert config.read_bytes() == initial, "second install changed config"
    assert json.loads(initial)["skills"]["paths"] == [str(root / "skills")]
    for directory in ("agents", "commands"):
        for source in (root / directory).glob("*.md"):
            assert (config.parent / directory / source.name).resolve() == source
    print("PASS fresh and repeated install; all agent and command symlinks resolve")

    moved = base / "renamed clone"
    moved.mkdir()
    shutil.copy2(root / "install.sh", moved / "install.sh")
    for directory in ("agents", "commands"):
        shutil.copytree(root / directory, moved / directory)
    message = run("bash", str(moved / "install.sh"), env=env)
    assert "ACTION NEEDED" in message and config.read_bytes() == initial
    moved_config = {"skills": {"paths": [str(moved / "skills")]}}
    config.write_text(json.dumps(moved_config))
    message = run("bash", str(moved / "install.sh"), env=env)
    assert "already registered" in message and "ACTION NEEDED" not in message
    config.write_bytes(initial)
    run("bash", str(root / "install.sh"), env=env)
    print("PASS relocated clone reports stale registration and accepts its exact new path")

    jsonc = config.with_suffix(".jsonc")
    jsonc.write_text('{\n // user-owned configuration\n "model": "custom/model"\n}\n')
    preserved = jsonc.read_bytes()
    message = run("bash", str(root / "install.sh"), env=env)
    assert jsonc.read_bytes() == preserved and "ACTION NEEDED" in message
    jsonc.unlink()
    print("PASS existing JSONC stays intact and gets registration instructions")

    env.update({"OPENCODE_DISABLE_EXTERNAL_SKILLS": "1", "OPENCODE_DISABLE_DEFAULT_PLUGINS": "1", "OPENCODE_DISABLE_PROJECT_CONFIG": "1", "OPENCODE_PURE": "1"})
    discovered = json.loads(run("opencode", "debug", "skill", env=env, cwd=base))
    expected = {path.parent.name for path in (root / "skills").glob("*/SKILL.md")}
    actual = {entry["name"] for entry in discovered}
    assert expected <= actual, f"skills missing: {expected - actual}"
    listed = run("opencode", "agent", "list", env=env, cwd=base)
    for path in (root / "agents").glob("*.md"):
        assert path.stem in listed, f"agent missing: {path.stem}"
    print(f"PASS OpenCode loads {len(expected)} pstack skills and all agents")

    playbook = (root / "skills/poteto-mode/playbooks/multi-phase-plan.md").read_text()
    plan = base / "plan.md"
    plan.write_text(playbook.split("````markdown\n", 1)[1].split("````", 1)[0])
    run("node", str(tools / "check-plan.mjs"), str(plan))
    plan.write_text(plan.read_text().replace("git show origin/main:", "git -C <target-repo> show origin/main:"))
    run("node", str(tools / "check-plan.mjs"), str(plan))
    plan.write_text(plan.read_text().replace("- [ ] Lane 10.", "- [ ] Missing lane."))
    failure = run("node", str(tools / "check-plan.mjs"), str(plan), expected=1)
    assert "problems" in failure
    print("PASS plan checker accepts shipped template and rejects missing lane")

    store = base / "store"
    orch = ["bun", str(tools / "orch/orch.ts"), "--store", str(store)]
    run(*orch, "init")
    first = (store / "units.tsv").read_bytes()
    run(*orch, "init")
    assert (store / "units.tsv").read_bytes() == first
    run(*orch, "status")
    assert (store / "status.md").exists()
    print("PASS orch CLI initializes idempotently and writes status")

    help_text = run(str(tools / "watch-pr/watch-pr"), "--help")
    assert "--status-only" in help_text and "--queued-stack" in help_text
    run("bash", "-n", str(tools / "worktree-audit.sh"))
    print("PASS watcher entry point and worktree audit shell syntax")

    repo = base / "audit repo"
    repo.mkdir()
    run("git", "init", "-b", "main", str(repo))
    (repo / "baseline.txt").write_text("fixture baseline")
    run("git", "add", "baseline.txt", cwd=repo)
    run("git", "-c", "user.name=Verifier", "-c", "user.email=verify@example.invalid", "commit", "-m", "baseline", cwd=repo)
    run("git", "update-ref", "refs/remotes/origin/main", "HEAD", cwd=repo)
    worktree = base / "worker with spaces"
    run("git", "worktree", "add", "-b", "worker", str(worktree), cwd=repo)
    fake_bin = base / "bin"
    fake_bin.mkdir()
    gh = fake_bin / "gh"
    gh.write_text('#!/bin/sh\nprintf \'[{"number":1,"state":"CLOSED","headRefName":"worker"}]\\n\'\n')
    gh.chmod(0o755)
    audit_env = {**os.environ, "PATH": f'{fake_bin}:{os.environ["PATH"]}', "OPENCODE_TRANSCRIPT_DIR": ""}
    audit = run("bash", str(tools / "worktree-audit.sh"), str(repo), env=audit_env)
    assert str(worktree) in audit and "\tverify-session\t" in audit and "\tsafe\t" not in audit
    exports = base / "session exports"
    exports.mkdir()
    (exports / "run 1.json").write_text(json.dumps({"directory": str(worktree.resolve())}))
    transcript_env = {**audit_env, "OPENCODE_TRANSCRIPT_DIR": str(exports)}
    audit = run("bash", str(tools / "worktree-audit.sh"), str(repo), env=transcript_env)
    assert "\tverify-recent-chat\t" in audit, audit
    (worktree / "untracked.txt").write_text("keep this work")
    audit = run("bash", str(tools / "worktree-audit.sh"), str(repo), env=audit_env)
    assert "\thold-scratch\t" in audit, audit
    run("git", "add", "untracked.txt", cwd=worktree)
    run("git", "-c", "user.name=Verifier", "-c", "user.email=verify@example.invalid", "commit", "-m", "unmerged work", cwd=worktree)
    audit = run("bash", str(tools / "worktree-audit.sh"), str(repo), env=audit_env)
    assert "\treview\t" in audit and "\tsafe\t" not in audit, audit
    print("PASS worktree audit handles spaced worktree and transcript paths, untracked work, and closed-but-unmerged branches")

pins = {}
for directory in ("agents", "commands"):
    for path in (root / directory).glob("*.md"):
        model = re.search(r"^model: (.+)$", path.read_text(), re.M)
        assert model and "/" in model[1], f"missing provider/model pin in {path}"
        pins[path] = model[1]
available_models = set()
for provider in sorted({model.split("/", 1)[0] for model in pins.values()}):
    available_models.update(run("opencode", "models", provider).splitlines())
unavailable = {path.name: model for path, model in pins.items() if model not in available_models}
assert not unavailable, f"pinned models not listed by opencode: {unavailable}"
print(f"PASS every agent and command pins a model available from its provider ({len(pins)} pins)")
