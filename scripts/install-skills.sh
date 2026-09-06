#!/usr/bin/env bash
# install-skills.sh: link the app-store-screenshots skill into the local skill stores.
#
# Stores (three links, one per agent host):
#   ~/.agents/skills/app-store-screenshots -> <repo>/skills/app-store-screenshots   (absolute, canonical)
#   ~/.claude/skills/app-store-screenshots -> ../../.agents/skills/app-store-screenshots (relative)
#   ~/.codex/skills/app-store-screenshots  -> <repo>/skills/app-store-screenshots   (absolute)
#
# The script never replaces a real directory or a link that points somewhere else.
# It never touches ~/.agents/.skill-lock.json. It never needs sudo.
# Compatible with the macOS system bash (3.2).

set -euo pipefail

SKILL="app-store-screenshots"
OLD_SKILLS="aso-appstore-screenshots asc-localize-screenshots localize-app-store-screenshots"
STORES="agents claude codex"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

resolve_dir() {
  # Print the physical path of a directory. Falls back when realpath is missing.
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1"
  else
    (cd "$1" && pwd -P)
  fi
}

SCRIPT_DIR="$(resolve_dir "$(dirname "$0")")"
REPO="$(resolve_dir "$SCRIPT_DIR/..")"
SRC="$REPO/skills/$SKILL"

store_dir() {
  case "$1" in
    agents) printf '%s\n' "$HOME/.agents/skills" ;;
    claude) printf '%s\n' "$HOME/.claude/skills" ;;
    codex)  printf '%s\n' "$HOME/.codex/skills" ;;
    *) echo "error: unknown store '$1'" >&2; exit 2 ;;
  esac
}

# The link target each store expects, as written on disk (literal, not resolved).
expected_target() {
  case "$1" in
    agents) printf '%s\n' "$SRC" ;;
    claude) printf '%s\n' "../../.agents/skills/$SKILL" ;;
    codex)  printf '%s\n' "$SRC" ;;
  esac
}

ARCHIVE_ROOT="$HOME/.agents/skills-archive"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

usage() {
  cat <<USAGE
Usage: scripts/install-skills.sh [--check | --retire [--yes] | --uninstall | --help]

Default (no flag): create the three links below when missing. Print "ok" for
links that already point at the right place. Refuse to replace anything else.

  ~/.agents/skills/$SKILL -> $SRC
  ~/.claude/skills/$SKILL -> ../../.agents/skills/$SKILL
  ~/.codex/skills/$SKILL  -> $SRC

Flags:
  --check      Print the state of the three links and of the three retired skills
               ($OLD_SKILLS)
               in all three stores. Changes nothing.
  --retire     Move real directories of the three retired skills to
               ~/.agents/skills-archive/<YYYY-MM-DD>/<store>/<name> and delete
               their symlinks. Asks y/N first.
  --yes        Skip the y/N prompt for --retire.
  --uninstall  Remove only the three $SKILL links. Leaves anything else alone.
  --help       Show this text.

Exit status: 0 on success, 1 when a path is in the way or a link points elsewhere.
USAGE
}

# Describe a path: "absent", "link:<target>", "dir", or "file".
describe() {
  local path="$1"
  if [ -L "$path" ]; then
    printf 'link:%s\n' "$(readlink "$path")"
  elif [ -d "$path" ]; then
    printf 'dir\n'
  elif [ -e "$path" ]; then
    printf 'file\n'
  else
    printf 'absent\n'
  fi
}

# State of one of our links: ok | missing | wrong-target | not-a-link
link_state() {
  local store="$1"
  local path
  path="$(store_dir "$store")/$SKILL"
  local want
  want="$(expected_target "$store")"
  case "$(describe "$path")" in
    absent) printf 'missing\n' ;;
    "link:$want") printf 'ok\n' ;;
    link:*) printf 'wrong-target\n' ;;
    *) printf 'not-a-link\n' ;;
  esac
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_install() {
  if [ ! -f "$SRC/SKILL.md" ]; then
    echo "error: skill source not found: $SRC/SKILL.md" >&2
    exit 1
  fi

  # First pass: refuse before changing anything if any path is in the way.
  local store path state blocked=0
  for store in $STORES; do
    path="$(store_dir "$store")/$SKILL"
    state="$(link_state "$store")"
    case "$state" in
      wrong-target)
        echo "error: $path is a link to $(readlink "$path"), expected $(expected_target "$store")" >&2
        blocked=1 ;;
      not-a-link)
        echo "error: $path exists and is not a symlink; move it aside first" >&2
        blocked=1 ;;
    esac
  done
  if [ "$blocked" -ne 0 ]; then
    echo "nothing changed" >&2
    exit 1
  fi

  # Second pass: create what is missing. Order matters: the claude link is
  # relative and resolves through the agents link.
  for store in $STORES; do
    path="$(store_dir "$store")/$SKILL"
    state="$(link_state "$store")"
    if [ "$state" = "ok" ]; then
      echo "ok       $path -> $(readlink "$path")"
      continue
    fi
    mkdir -p "$(dirname "$path")"
    ln -s "$(expected_target "$store")" "$path"
    echo "linked   $path -> $(readlink "$path")"
  done
}

cmd_check() {
  local store path state name desc
  echo "skill: $SKILL"
  echo "source: $SRC"
  echo
  echo "links:"
  for store in $STORES; do
    path="$(store_dir "$store")/$SKILL"
    state="$(link_state "$store")"
    case "$state" in
      ok)           echo "  ok            $path -> $(readlink "$path")" ;;
      missing)      echo "  missing       $path" ;;
      wrong-target) echo "  wrong-target  $path -> $(readlink "$path") (expected $(expected_target "$store"))" ;;
      not-a-link)   echo "  not-a-link    $path" ;;
    esac
  done
  echo
  echo "retired skills (removed by --retire):"
  for name in $OLD_SKILLS; do
    for store in $STORES; do
      path="$(store_dir "$store")/$name"
      desc="$(describe "$path")"
      case "$desc" in
        absent) echo "  absent        $path" ;;
        link:*) echo "  link          $path -> ${desc#link:}" ;;
        dir)    echo "  dir           $path" ;;
        file)   echo "  file          $path" ;;
      esac
    done
  done
}

cmd_retire() {
  local yes="$1"
  local today
  today="$(date +%Y-%m-%d)"
  local archive="$ARCHIVE_ROOT/$today"

  # Collect the work first so the prompt can show it.
  local store path desc name plan="" count=0
  for name in $OLD_SKILLS; do
    for store in $STORES; do
      path="$(store_dir "$store")/$name"
      desc="$(describe "$path")"
      case "$desc" in
        absent) ;;
        link:*)
          plan="$plan  remove link  $path -> ${desc#link:}"$'\n'
          count=$((count + 1)) ;;
        dir)
          plan="$plan  move dir     $path -> $archive/$store/$name"$'\n'
          count=$((count + 1)) ;;
        file)
          echo "error: $path is a regular file; move it aside first" >&2
          exit 1 ;;
      esac
    done
  done

  if [ "$count" -eq 0 ]; then
    echo "nothing to retire: none of ($OLD_SKILLS) present in any store"
    return 0
  fi

  echo "retire plan ($count items):"
  printf '%s' "$plan"

  if [ "$yes" -ne 1 ]; then
    if [ ! -t 0 ]; then
      echo "error: stdin is not a terminal; pass --yes to confirm" >&2
      exit 1
    fi
    local answer=""
    printf 'Proceed? [y/N] '
    read -r answer
    case "$answer" in
      y|Y|yes|YES) ;;
      *) echo "aborted; nothing changed"; exit 1 ;;
    esac
  fi

  # Refuse to merge into an existing archive folder for the same store/name.
  for name in $OLD_SKILLS; do
    for store in $STORES; do
      path="$(store_dir "$store")/$name"
      if [ ! -L "$path" ] && [ -d "$path" ] && [ -e "$archive/$store/$name" ]; then
        echo "error: archive destination already exists: $archive/$store/$name" >&2
        echo "nothing changed" >&2
        exit 1
      fi
    done
  done

  for name in $OLD_SKILLS; do
    for store in $STORES; do
      path="$(store_dir "$store")/$name"
      if [ -L "$path" ]; then
        rm "$path"
        echo "removed  $path"
      elif [ -d "$path" ]; then
        mkdir -p "$archive/$store"
        mv "$path" "$archive/$store/$name"
        echo "archived $path -> $archive/$store/$name"
      fi
    done
  done
  echo "done: archive at $archive"
}

cmd_uninstall() {
  local store path state skipped=0
  for store in $STORES; do
    path="$(store_dir "$store")/$SKILL"
    state="$(link_state "$store")"
    case "$state" in
      ok)
        rm "$path"
        echo "removed  $path" ;;
      missing)
        echo "absent   $path" ;;
      wrong-target)
        echo "skipped  $path -> $(readlink "$path") (not our link)"
        skipped=1 ;;
      not-a-link)
        echo "skipped  $path (not a symlink)"
        skipped=1 ;;
    esac
  done
  if [ "$skipped" -ne 0 ]; then
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

MODE="install"
YES=0
for arg in "$@"; do
  case "$arg" in
    --check)     MODE="check" ;;
    --retire)    MODE="retire" ;;
    --uninstall) MODE="uninstall" ;;
    --yes|-y)    YES=1 ;;
    --help|-h)   usage; exit 0 ;;
    *)
      echo "error: unknown argument '$arg'" >&2
      usage >&2
      exit 2 ;;
  esac
done

case "$MODE" in
  install)   cmd_install ;;
  check)     cmd_check ;;
  retire)    cmd_retire "$YES" ;;
  uninstall) cmd_uninstall ;;
esac
