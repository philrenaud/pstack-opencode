# Discover and invoke

## Sub-features

Catalog discovery, keyword search, category navigation, narrow detail, invocation print, help, terminal cleanup.

## How to get to it (user POV)

Run `./learn`. Press `/` to search and select with arrow keys. Press Right for details on a narrow screen. Enter opens recent examples at any width; Escape returns. Press `p` to print the invocation and exit.

## Driving it with the PTY helper

Preconditions: Bun is available and `./learn --help` succeeds.

Run `python3 scripts/verify-learn.py`. Require the search/help/resize/details/print PASS line and terminal restoration PASS line. Inspect `.audit/learn-terminal.txt` for the printed autopilot-stack invocation.

## Gotchas

The tool copies or prints prompts; it never invokes a skill itself. Search treats `q` as text. Ctrl-C must still exit. Terminal sizes below 40x12 show a resize hint.
