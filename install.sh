#!/usr/bin/env bash
# Registers this clone with a local OpenCode install. Idempotent; re-run after moving the clone.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

mkdir -p "$CONFIG_DIR/agents" "$CONFIG_DIR/commands"

for f in "$REPO_DIR"/agents/*.md; do ln -sf "$f" "$CONFIG_DIR/agents/"; done
for f in "$REPO_DIR"/commands/*.md; do ln -sf "$f" "$CONFIG_DIR/commands/"; done
echo "linked agents and commands into $CONFIG_DIR"

CONFIG_FILE=""
for c in opencode.jsonc opencode.json; do
  if [ -f "$CONFIG_DIR/$c" ]; then CONFIG_FILE="$CONFIG_DIR/$c"; break; fi
done

if [ -z "$CONFIG_FILE" ]; then
  cat > "$CONFIG_DIR/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "skills": { "paths": ["$REPO_DIR/skills"] }
}
EOF
  echo "created $CONFIG_DIR/opencode.json with skills.paths"
elif grep -q "pstack-opencode/skills" "$CONFIG_FILE"; then
  echo "skills path already registered in $CONFIG_FILE"
else
  # Config exists but doesn't reference this repo. Editing JSONC from bash is a
  # good way to corrupt someone's config, so print the one line to add instead.
  echo ""
  echo "ACTION NEEDED: add this to $CONFIG_FILE:"
  echo ""
  echo "  \"skills\": { \"paths\": [\"$REPO_DIR/skills\"] }"
  echo ""
fi

echo ""
echo "Restart OpenCode, then verify:"
echo "  opencode debug skill        # should list the 40 pstack skills"
echo "  opencode agent list         # should show the five poteto-* subagents"
echo ""
echo "The agents pin OpenRouter models. On a machine with different providers,"
echo "run /setup-pstack inside OpenCode (or edit agents/*.md) to remap."
