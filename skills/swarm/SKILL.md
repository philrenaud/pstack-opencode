---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
---

# Swarm

Fan out N parallel subagent workers. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers, not the concurrency limit.
4. Use `poteto-grok` for workers by default, configured with `/setup-pstack`. For a model race, name each arm's agent and model up front. Available panel agents are `poteto-claude`, `poteto-gpt`, `poteto-grok`, and `poteto-opus`.
5. Give each worker its own writable output when it writes.

## Phase B: Fan out

Spawn all N workers in one message with the chosen `subagent_type`. Give writing workers exclusive worktrees or output directories. Give runtime lanes separate ports and data. Include "Review only. Do not edit files." for read-only work.

When a worker must start from a non-default branch, create its worktree at that ref and put the absolute path in its brief. Do not assume the subagent tool creates an isolated checkout.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.
