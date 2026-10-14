#!/usr/bin/env bash
# Builds the general (not StudyScribe-specific) copies of the ui-ux-pro-max skill
# from the project copy in .claude/skills/ui-ux-pro-max:
#   install  copy it to ~/.claude/skills so Claude Code has it in every project
#   zip      write tools/claude-skills/ui-ux-pro-max.zip for claude.ai (upload it under Skills in Claude settings)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/.claude/skills/ui-ux-pro-max"
PROJECT_CMD='python3 .claude/skills/ui-ux-pro-max/scripts/'

case "${1:-}" in
  install)
    DEST="$HOME/.claude/skills/ui-ux-pro-max"
    rm -rf "$DEST" && mkdir -p "$(dirname "$DEST")" && cp -R "$SRC" "$DEST"
    sed -i.bak "s#${PROJECT_CMD}#python3 ~/.claude/skills/ui-ux-pro-max/scripts/#g" "$DEST/SKILL.md" && rm "$DEST/SKILL.md.bak"
    echo "Installed to $DEST. Restart Claude Code to pick it up."
    ;;
  zip)
    TMP="$(mktemp -d)"
    cp -R "$SRC" "$TMP/ui-ux-pro-max"
    find "$TMP" -name __pycache__ -prune -exec rm -rf {} +
    # claude.ai mounts skills at a path we don't control, so commands run from the skill's own folder.
    python3 - "$TMP/ui-ux-pro-max/SKILL.md" "$PROJECT_CMD" <<'PY'
import sys
path, project_cmd = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read().replace(project_cmd, "python3 scripts/")
note = ("\n> **Where to run commands:** every `python3 scripts/...` command below runs from this skill's own folder, "
        "the directory that contains this SKILL.md. `cd` there first, or prefix the script path with that folder.\n")
title = "# UI/UX Pro Max - Design Intelligence\n"
text = text.replace(title, title + note, 1)
open(path, "w", encoding="utf-8").write(text)
PY
    OUT="$ROOT/tools/claude-skills/ui-ux-pro-max.zip"
    rm -f "$OUT" && (cd "$TMP" && zip -qrX "$OUT" ui-ux-pro-max)
    echo "Wrote $OUT ($(unzip -l "$OUT" | tail -1 | awk '{print $2}') files)"
    rm -rf "$TMP"
    ;;
  *) echo "usage: $0 install|zip" >&2; exit 1 ;;
esac
