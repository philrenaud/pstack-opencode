# Usage evidence

## Sub-features

Read-only database access, project/window filters, child-session toggle, separate loads and reads, unknown state, live refresh.

## How to get to it (user POV)

Run `./learn`, change scope with `s`, time window with `w`, and child-session inclusion with `a`. Refresh with `r` or wait 15 seconds.

## Driving it with the PTY helper

Preconditions: Bun and Python 3 are available. Test databases are separate from real OpenCode history.

Run `bun run --cwd tools/learn test` for timestamp, attribution, scope, cache freshness, and missing/schema evidence cases. Run `python3 scripts/verify-learn.py` and require the visible count to change from one load to two after an external SQLite commit and `r`.

## Gotchas

Consultation is not workflow completion. Top-level CLI audits can count even with child sessions excluded. Missing history must show unknown. A same-name skill in an explicit foreign directory must not count.
