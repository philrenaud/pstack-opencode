### Worktree and simulator cleanup

**You own the disk and the safety gate.** Prune merged or abandoned git worktrees and stale iOS simulators to reclaim space. Deletion is irreversible, so every step guards against deleting something in use or holding uncommitted work.

1. Snapshot and audit. Record `df -h /`, then run `scripts/worktree-audit.sh` from the skill directory (principle-build-the-lever). It reads paths from `git worktree list`, including paths with spaces. It classifies size, age, merge state, uncommitted work, and PR state. Optionally set `PSTACK_TRANSCRIPT_DIR` to a directory of this project's transcripts (OpenCode exports, or the Claude Code project transcript directory; see `../references/runtime.md`). Session usage is unknown without them. `verify-session` is a candidate for inspection, never deletion approval.
2. The bucket is advice, not permission. Active sessions are the real artifact (principle-prove-it-works). Cross-check candidates against session exports and running processes. Ask the user about usage that those sources cannot establish.
3. Verify usage before deleting. For every `verify-session` or `verify-recent-chat` row, read the matching project session transcripts per the runtime reference. Check which worktrees active tasks use. Inspect tracked and untracked work and commits not in the merged PR. A merged or closed PR alone does not prove a worktree is disposable.
4. Pause on irreversible loss. `wip:N` is N tracked uncommitted edits. `scratch:N` is untracked work of unknown value. Inspect and name the files before deciding what is disposable. Show the diff and get a decision before discarding user work. Clean, merged, and confirmed not-in-use worktrees can proceed under the cleanup request.
5. Prune the confirmed set. Per path, use `git worktree remove "<path>"`. If it refuses because files remain, inspect them before escalating to forced removal. Keep branch refs. Run `git worktree prune`, confirm with `df -h /`, and re-list.
6. Simulators and other reclaimers. Inspect `xcrun simctl list` and `xcrun simctl runtime list` before removing stale simulators or runtimes. Check Xcode `DerivedData`, `iOS DeviceSupport`, and package caches when they account for meaningful disk usage. Clear only confirmed disposable data. Agent session transcripts and databases are history, not cache.

This is the one playbook that deletes user state with no code review to catch a slip, so the gates above are the review.

**Reply:** `df -h /` before and after with space reclaimed, the worktrees pruned, and a one-line reason for each held back (in-use by which chat, or uncommitted work).
