#!/usr/bin/env bash
# Builds review/review-step-<STEP>.zip for code review.
# Usage: bash scripts/make_review.sh 02
# Runs linters and tests, stages all changes (no commit), saves the diff and packs
# every tracked or new non-ignored file together with review/REVIEW.md.

set -uo pipefail

STEP="${1:-}"
if [ -z "$STEP" ]; then
  echo "Usage: bash scripts/make_review.sh <step>, for example: bash scripts/make_review.sh 02"
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "zip is not installed. Run: sudo apt install -y zip"
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Not a git repository"; exit 1; }
cd "$ROOT" || exit 1

OUT="review"
mkdir -p "$OUT"
LOG="$OUT/checks.txt"
SUMMARY="$OUT/checks-summary.txt"
: > "$LOG"
: > "$SUMMARY"

if [ ! -f "$OUT/REVIEW.md" ]; then
  echo "WARNING: $OUT/REVIEW.md is missing. Write it before building the review." | tee -a "$SUMMARY"
fi

run_check() {
  # run_check <name> <dir> <command...>
  local name="$1" dir="$2"
  shift 2
  echo "===== $name | dir: $dir | cmd: $*" >> "$LOG"
  if [ ! -d "$dir" ]; then
    echo "===== SKIPPED (no $dir)" >> "$LOG"
    echo "SKIP  $name" >> "$SUMMARY"
    echo >> "$LOG"
    return
  fi
  (cd "$dir" && "$@") >> "$LOG" 2>&1
  local rc=$?
  echo "===== exit code: $rc" >> "$LOG"
  echo >> "$LOG"
  if [ "$rc" -eq 0 ]; then
    echo "PASS  $name" >> "$SUMMARY"
  else
    echo "FAIL  $name (exit $rc)" >> "$SUMMARY"
  fi
}

# Database for backend tests
if [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1; then
  echo "===== docker compose up -d --wait db" >> "$LOG"
  docker compose up -d --wait db >> "$LOG" 2>&1 || echo "WARN  could not start db" >> "$SUMMARY"
  echo >> "$LOG"
fi

if [ -f backend/pyproject.toml ]; then
  run_check "ruff check"        backend uv run ruff check .
  run_check "ruff format check" backend uv run ruff format --check .
  run_check "pytest"            backend uv run pytest -q
fi

if [ -f frontend/package.json ]; then
  run_check "npm lint"  frontend npm run lint
  run_check "npm build" frontend npm run build
  if grep -q '"test"' frontend/package.json; then
    run_check "npm test" frontend npm test -- --run
  fi
fi

# Stage everything (respects .gitignore) so the diff includes new files. No commit.
git add -A
git diff --cached --stat > "$OUT/diffstat.txt"
git diff --cached > "$OUT/changes.diff"

ZIP="$OUT/review-step-$STEP.zip"
rm -f "$ZIP"
{
  git ls-files --cached --others --exclude-standard
  for f in "$OUT/REVIEW.md" "$LOG" "$SUMMARY" "$OUT/diffstat.txt" "$OUT/changes.diff"; do
    [ -f "$f" ] && echo "$f"
  done
} | sort -u | zip -q "$ZIP" -@

SIZE_KB=$(( $(stat -c %s "$ZIP") / 1024 ))
echo
echo "Checks:"
cat "$SUMMARY"
echo
echo "Review package: $ROOT/$ZIP (${SIZE_KB} KB)"
if [ "$SIZE_KB" -gt 20000 ]; then
  echo "WARNING: package is larger than 20 MB. Check .gitignore."
fi
