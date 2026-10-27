#!/usr/bin/env bash
# Stable copy of the designer for making drawings, separate from the development server (npm start, port 1234).
# The stable copy is a git worktree on the branch "stable", built once and served as static files on port 8080.
# Browsers store drawings per address, so drawings made on localhost:8080 are never touched by development.
#
#   scripts/stable.sh serve          serve the stable build on http://localhost:8080
#   scripts/stable.sh release [ref]  fast-forward the stable branch to ref (default: main) and rebuild it
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STABLE_DIR="$(cd "$REPO_DIR/.." && pwd)/CircuiTikZ-Designer-stable"
PORT=8080

if [ ! -d "$STABLE_DIR" ]; then
	git -C "$REPO_DIR" worktree add -b stable "$STABLE_DIR" main
fi

case "${1:-serve}" in
	serve)
		echo "Stable designer: http://localhost:$PORT  ($(git -C "$STABLE_DIR" log -1 --format='%h %s'))"
		exec python3 -m http.server "$PORT" --directory "$STABLE_DIR/dist"
		;;
	release)
		ref="${2:-main}"
		git -C "$STABLE_DIR" merge --ff-only "$ref"
		(cd "$STABLE_DIR" && npm ci --no-audit --no-fund && rm -rf dist && npm run build)
		echo "Released $(git -C "$STABLE_DIR" log -1 --format='%h %s'). Reload http://localhost:$PORT to use it."
		;;
	*)
		echo "usage: $0 [serve | release [ref]]" >&2
		exit 1
		;;
esac
