#!/usr/bin/env python3
"""Three-way import of pstack skills, preserving this port's adaptations."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("checkout", type=Path, help="local cursor/plugins checkout")
parser.add_argument("--to", required=True, help="upstream commit to import")
parser.add_argument("--apply", action="store_true", help="write merged files; default is inventory only")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
state = json.loads((root / "upstream.json").read_text())


def git(*arguments):
    return subprocess.check_output(["git", "-C", str(args.checkout), *arguments])


def tree(revision):
    return set(git("ls-tree", "-r", "--name-only", revision, "pstack/skills").decode().splitlines())


before, after = tree(state["commit"]), tree(args.to)
conflicts = []
for source in sorted(before | after):
    relative = source.removeprefix("pstack/")
    if any(relative == path or relative.startswith(path + "/") for path in state["excluded"]):
        continue
    old = git("show", f'{state["commit"]}:{source}') if source in before else b""
    new = git("show", f"{args.to}:{source}") if source in after else b""
    if old == new:
        continue
    target = root / relative
    local = target.read_bytes() if target.exists() else b""
    result = new
    if local != old and local != new:
        with tempfile.TemporaryDirectory() as temporary:
            paths = [Path(temporary) / name for name in ("local", "base", "upstream")]
            for path, content in zip(paths, (local, old, new)):
                path.write_bytes(content)
            merge = subprocess.run(["git", "merge-file", "-p", "-L", "OpenCode", "-L", "base", "-L", "upstream", *map(str, paths)], capture_output=True)
            if merge.returncode not in range(128):
                raise SystemExit(merge.stderr.decode())
            result = merge.stdout
            if merge.returncode:
                conflicts.append(relative)
    print(f'{"CONFLICT" if relative in conflicts else "MERGE"} {relative}')
    if args.apply:
        if not result and source not in after:
            target.unlink(missing_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(result)
            entry = git("ls-tree", args.to, source).decode().split()
            if entry and entry[0] == "100755":
                target.chmod(0o755)

print(f"{len(conflicts)} conflicts. Resolve and validate before updating upstream.json.")
raise SystemExit(bool(conflicts))
