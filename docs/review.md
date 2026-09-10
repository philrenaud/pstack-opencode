# Review of the upstream sync

The review covered the full uncommitted v0.15.1 import, OpenCode adaptations, new tools, and Copilot-only model routing. Reviewers received the same brief and rubric in separate fresh OpenCode processes with explicit `github-copilot/` models. They had read-only scope and could not delegate.

## Reviewers

| Model | Outcome |
| --- | --- |
| Claude Sonnet 5 | Completed. Found contradictory delegate-routing instructions. Reproduced the existing verification results. |
| GPT 5.6 Sol | Completed. Found watcher readiness, pagination, and deadline defects, installer relocation detection, and transcript filename handling. |
| Gemini 3.8 Flash | Timed out after ten minutes without a verdict. Not counted as a completed review. |
| Claude Opus 5 | Completed. Found concrete polling guidance and adaptation/checker issues. Reviewed the fixes and found additional deadline and stale-branch cases. |

## Findings addressed

- Explicit playbook agent choices now take precedence over the general delegate default.
- Every bundled agent and the command explicitly pins an available Copilot model. Structural verification rejects missing pins or other providers.
- Installer registration checks the current absolute skill path. A moved clone prompts for config repair instead of reporting stale registration as successful.
- The adaptation script removes the upstream path prefix before applying the clone-specific Git command. The plan checker accepts `git -C` commands.
- Reference validation handles files outside `skills/` without constructing an invalid skill-root path.
- Transcript scanning uses Python and handles directories and filenames with spaces. Tests exercise recent-session detection rather than only worktree names.
- Runtime guidance names the watcher's deadline flags and separate owner/repository arguments.
- Required review, blocked mergeability, unknown mergeability, and a behind-base state cannot produce watcher readiness. Clean repositories without mandatory reviews still work.
- Review-thread queries fetch every page, reject missing or repeated cursors, and compute Bugbot pass counts across all pages.
- One deadline governs discovery, subprocess calls, polling, and retry sleeps. Hung commands are killed. Discovery timeouts produce the same TIMEOUT/exit-5 contract as polling timeouts. A wall-clock regression test prevents coupling to the performance-clock epoch.

GPT Sol implemented the watcher fixes in an exclusive directory scope. The parent inspected the actual diff and reran checks. Opus then reviewed that implementation; the parent fixed its additional stale-branch, clock, and discovery-exit findings and reran the tests.

## Findings not taken

- Sonnet's suggestion that the original credit errors were from Copilot conflicts with the recorded OpenRouter error URL. The new reviews did run through Copilot.
- Sonnet and Opus share the Anthropic family, just as upstream's Fable and Opus seats did. This is already disclosed. Judges must use a different model family, not merely a different agent name.
- The imported `readSnapshot` argument `allowDraft` is unused. Draft gating lives in policy classification. Removing this existing argument is a separate cleanup and does not fix a behavior defect in this import.

## Evidence and limits

Final checks passed 58 Bun tests with 221 assertions, strict watcher typechecking, structural verification, and runtime installation checks. A read-only live GitHub request against `cursor/plugins#336` returned STATUS with unknown mergeability and no readiness claim. An initial invocation used `gh`-style `--repo owner/repo` incorrectly; it returned TIMEOUT. Runtime guidance now names the correct argument shape.

Raw review output and the decision log remain local under `.audit/`. The initial decision-log entries were reconstructed after implementation, not recorded as events occurred. Their timestamps are logging times. The initial runtime-guidance row established the written adaptation, not proof of autonomous operation. Subsequent tests prove the specific paths above.

Gemini did not provide a verdict. Full autonomous programs, live PR mutation workflows, and Graphite frontier integration remain untested. The user owns committing and pushing this change.
