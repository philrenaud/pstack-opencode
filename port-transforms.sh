# Sourced by sync-upstream.sh. Upstream (Cursor) bytes -> port (OpenCode) bytes.
# Executable source of the README substitution table: global line rules below,
# then literal from->to pairs in port-pairs/ for the multi-line prose blocks
# (subagent routing, model slugs, Cursor built-ins) that line rules can't express.
# port-pairs/ is derived from upstream@PIN vs local skills/; regenerate it when a
# landed sync changes the delta, or hand-edit a pair when upstream rewords one.

PORT_OWNED_PATHS=(setup-pstack)
UPSTREAM_URL="https://github.com/cursor/plugins"
UPSTREAM_SKILLS_PREFIX="pstack/skills"
LOCAL_SKILLS_PREFIX="skills"
PORT_PAIRS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/port-pairs"

is_port_owned() {
  local relpath="${1#./}"
  relpath="${relpath#skills/}"
  local p
  for p in "${PORT_OWNED_PATHS[@]}"; do
    case "$relpath" in
      "$p"|"$p"/*) return 0 ;;
    esac
  done
  return 1
}

# Residual Cursor tokens after portify mean a new transform is needed; the sync
# driver annotates review flags with this, it never gates on it.
looks_like_cursor_plumbing() {
  grep -qE 'AskQuestion|disable-model-invocation|subagent_type:[[:space:]]*generalPurpose|run_in_background:|~/\.cursor/|\.cursor/skills/|agent-transcripts|create-skill|babysit|Bugbot|/loop|control-cli|control-ui|/deslop|claude-opus-4-8-thinking|gpt-5\.5-high-fast|grok-4\.5-fast-xhigh|name:[[:space:]]*Poteto Mode|^mode:[[:space:]]*true' "$1" 2>/dev/null
}

# Literal multi-line replace. PAIRS names a file of \001 from \002 to \003
# records, longest-from first so overlapping pairs can't shadow each other.
_portify_apply_pairs() {
  awk '
    BEGIN { RS = "\3"; ORS = ""; n = 0
      while ((getline rec < ENVIRON["PAIRS"]) > 0) {
        sub(/^\001/, "", rec)
        split(rec, parts, "\002")
        if (parts[1] != "") { n++; fr[n] = parts[1]; to[n] = parts[2] }
      }
      close(ENVIRON["PAIRS"]); RS = "\n"
    }
    { body = body $0 "\n" }
    END {
      for (i = 1; i <= n; i++) {
        s = body; body = ""; plen = length(fr[i])
        while ((idx = index(s, fr[i])) > 0) {
          body = body substr(s, 1, idx - 1) to[i]
          s = substr(s, idx + plen)
        }
        body = body s
      }
      printf "%s", body
    }'
}

_portify_pairs_stream() {
  local f t
  for f in "$PORT_PAIRS_DIR"/*.from; do
    t="${f%.from}.to"
    printf '\001'; cat "$f"; printf '\002'; cat "$t"; printf '\003'
  done
}

# stdin: upstream file bytes. stdout: port bytes. Pure and deterministic;
# idempotent because the .from texts only exist in upstream form.
portify() {
  sed -E \
    -e '/^disable-model-invocation:[[:space:]]*true[[:space:]]*$/d' \
    -e '/^mode:[[:space:]]*true[[:space:]]*$/d' \
    -e '/^icon:[[:space:]]/d' \
    -e '/^color:[[:space:]]/d' \
    -e '/^reminder:[[:space:]]/d' \
    -e 's/^name:[[:space:]]*Poteto Mode[[:space:]]*$/name: poteto-mode/' \
    -e 's|~/\.cursor/skills/|~/.config/opencode/skills/|g' \
    -e 's|\.cursor/skills/|.opencode/skills/|g' \
  | PAIRS=<(_portify_pairs_stream) _portify_apply_pairs
}
