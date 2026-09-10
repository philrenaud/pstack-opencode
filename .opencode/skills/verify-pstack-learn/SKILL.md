---
name: verify-pstack-learn
description: Verify the pstack learn terminal dashboard after catalog, history, keyboard, rendering, or refresh changes. Drives the real TUI in an isolated pseudo-terminal.
---

# Verify pstack learn

## Launch

From this repository root, run `bun install --frozen-lockfile --cwd tools/learn`. The app entry point is `./learn`. Each verification drive owns a separate pseudo-terminal and temporary SQLite database.

## Doctor

Run `./learn --help` and `./learn --snapshot`. The snapshot must display `pstack learn` and the catalog. A missing real history database is an explicitly labeled UNKNOWN state, not proof of zero use.

## Drive

Run `python3 scripts/verify-learn.py --evidence .audit/learn-terminal.txt`. The helper launches the real executable, searches with raw keyboard input, appends a skill load from a second SQLite writer, refreshes, opens recent examples with session context, opens help, resizes, opens narrow details, prints an invocation, and tests Ctrl-C while searching.

Run `bun run --cwd tools/learn test` and `bun run --cwd tools/learn typecheck` for evidence classification and catalog changes. Read [features/README.md](features/README.md) for coverage.

## Evidence

The PTY helper asserts user-visible output and terminal restoration, then saves raw terminal output to `.audit/learn-terminal.txt`. The file must survive cleanup. A snapshot alone does not prove keyboard interaction. Skill loads and file consultations must remain separate. Test data never counts as live user history.

## Cleanup

The helper terminates only its own child processes and deletes its own temporary database after each drive. It preserves the evidence path even on failure. Do not kill OpenCode or modify its database.

## Helpers

`scripts/verify-learn.py` runs with Python 3 and its standard PTY/SQLite libraries. No tmux or external service is required.
