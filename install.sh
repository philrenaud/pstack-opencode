#!/usr/bin/env bash
# Registers this clone with a local OpenCode and/or Claude Code install.
# Idempotent; re-run after moving the clone.
#
#   ./install.sh            OpenCode only (the historical default)
#   ./install.sh claude     Claude Code only
#   ./install.sh all        both
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-opencode}"

install_opencode() {
  local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  mkdir -p "$config_dir/agents" "$config_dir/commands"

  for f in "$REPO_DIR"/opencode/agents/*.md; do ln -sf "$f" "$config_dir/agents/"; done
  for f in "$REPO_DIR"/opencode/commands/*.md; do ln -sf "$f" "$config_dir/commands/"; done
  echo "linked agents and commands into $config_dir"

  local config_file=""
  for c in opencode.jsonc opencode.json; do
    if [ -f "$config_dir/$c" ]; then config_file="$config_dir/$c"; break; fi
  done

  if [ -z "$config_file" ]; then
    cat > "$config_dir/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "skills": { "paths": ["$REPO_DIR/skills"] }
}
JSON
    echo "created $config_dir/opencode.json with skills.paths"
  elif grep -qF "\"$REPO_DIR/skills\"" "$config_file"; then
    echo "skills path already registered in $config_file"
  else
    # Config exists but doesn't reference this repo. Editing JSONC from bash is a
    # good way to corrupt someone's config, so print the one line to add instead.
    echo ""
    echo "ACTION NEEDED: add this to $config_file:"
    echo ""
    echo "  \"skills\": { \"paths\": [\"$REPO_DIR/skills\"] }"
    echo ""
  fi

  echo ""
  echo "Restart OpenCode, then verify:"
  echo "  opencode debug skill        # should list the pstack skills in this clone"
  echo "  opencode agent list         # should show poteto-* and comment-sicko"
}

install_claude() {
  local claude_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  mkdir -p "$claude_dir/skills" "$claude_dir/agents"

  # Claude Code discovers one directory per skill, so each skill directory is
  # linked individually. -n keeps a re-run from nesting a link inside the old one.
  for d in "$REPO_DIR"/skills/*/; do
    d="${d%/}"
    ln -sfn "$d" "$claude_dir/skills/$(basename "$d")"
  done
  for f in "$REPO_DIR"/claude/agents/*.md; do ln -sf "$f" "$claude_dir/agents/"; done
  echo "linked skills and agents into $claude_dir"

  echo ""
  echo "Restart Claude Code, then verify:"
  echo "  type /  in the prompt       # the menu should list poteto-mode and the other pstack skills"
  echo "  /agents                     # should show poteto-* and comment-sicko"
  echo ""
  echo "claude/agents/ is generated from opencode/agents/ by scripts/claude-agents.mjs."
}

case "$TARGET" in
  opencode) install_opencode ;;
  claude) install_claude ;;
  all) install_opencode; echo ""; install_claude ;;
  *) echo "usage: $0 [opencode|claude|all]" >&2; exit 2 ;;
esac

echo ""
echo "All pstack roles pin Anthropic models. To choose other available models,"
echo "run /setup-pstack inside your agent host (or edit opencode/agents/*.md) to remap."
