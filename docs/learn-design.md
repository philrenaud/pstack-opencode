# Learner design decisions

Four independent architecture candidates compared a native terminal renderer, a TUI framework, and alternative evidence models. All favored Bun's built-in terminal and SQLite support. The selected design keeps catalog discovery, history attribution, and rendering in separate modules. It has no production dependencies or model calls.

The domain distinguishes unknown history from absent observations. Loads and file consultations have independent tallies. A skill or playbook can be observed without its workflow having completed.

History uses indexed session lookups before examining tool metadata. A persistent read-only connection uses SQLite `data_version` to skip unchanged session queries. Changed databases trigger scalar per-session signatures before re-reading event fields. The adapter never selects transcript outputs or prompts. Scope defaults to the current project, with explicit local all-project scope available.

Two candidate suggestions were rejected after review. A session-only time window would count old events in recently active chats, so the implementation filters individual event timestamps too. Suffix-matching reads from any clone would count upstream research as installed-port use, so attribution requires canonical catalog paths. Known symlinked paths work; separate copies do not.

The initial implementation had one owner for the coupled model and interface. UI and history corrections then used disjoint file scopes. A real PTY test exposed key-handling issues and verifies search, refresh, help, resizing, details, prompt output, and terminal restoration. A piped-output test caught early process exit truncating JSON above 64 KiB.

Independent Claude and GPT reviews produced these outcomes:

- Accepted the idle-refresh cost finding. The `data_version` cache now skips unchanged session and event queries.
- Accepted the date and terminal-sanitization findings. Last-seen includes a calendar date; rendered paths and warnings cannot emit terminal controls.
- Rejected counting mismatched frontmatter names as valid installed skills. OpenCode requires the skill name to match its directory; the dashboard follows that catalog identity.
- Kept conservative unknown status when a malformed event has no identifiable capability. That row could belong to any skill, so absence cannot be proven. A warning explains the incomplete evidence.

Suggestions are a fixed useful starting order with a generic fallback. They do not infer the user's proficiency. Playbook examples invoke `/poteto-mode`; the tool never runs, commits, pushes, or merges anything on the user's behalf.
