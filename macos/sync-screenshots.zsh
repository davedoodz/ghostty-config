#!/bin/zsh
set -euo pipefail

readonly repo="$HOME/Projects/screenshots"
readonly lock="$repo/.git/screenshot-sync.lock"

if [[ ! -d "$repo/.git" ]]; then
  print -u2 "screenshot repository is missing: $repo"
  exit 1
fi

if ! mkdir "$lock" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$lock"' EXIT INT TERM

# Let macOS finish writing the image before Git reads it.
sleep 2

git -C "$repo" add -A
if ! git -C "$repo" diff --cached --quiet; then
  git -C "$repo" commit -m "Archive screenshots $(date '+%Y-%m-%d %H:%M:%S')"
fi

if [[ "$(git -C "$repo" rev-list --count origin/main..HEAD)" -gt 0 ]]; then
  git -C "$repo" push origin main
fi
