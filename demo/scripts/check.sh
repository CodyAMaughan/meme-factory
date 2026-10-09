#!/bin/sh
# Lint, check and snapshot one composition. `check` and `snapshot` read a folder's
# index.html, so each clip is copied into .work/<name>/ with the shared assets.
# Usage: scripts/check.sh remix.html [snapshot times, e.g. 1,3.5,6]
set -e
cd "$(dirname "$0")/.."
name=$(basename "$1" .html)
work=".work/$name"
rm -rf "$work" && mkdir -p "$work"
cp -R assets "$work/assets"
cp "$1" "$work/index.html"
npx --yes hyperframes@0.8.143 check "$work" | grep -E "✗|⚠|error\(s\)" || true
if [ -n "$2" ]; then
  npx --yes hyperframes@0.8.143 snapshot "$work" --at "$2" --no-end -o "snapshots/$name" >/dev/null 2>&1
  echo "snapshots: snapshots/$name/contact-sheet.jpg"
fi
