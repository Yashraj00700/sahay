#!/usr/bin/env bash
# ─── Repo secret scanner ──────────────────────────────────────────────────────
# Scans tracked-source files for patterns that look like accidentally
# committed secrets. Runs in CI (`npm run secrets:check`) and locally.
#
# Design notes:
#   • Single grep -rE pass for speed (<10s on this repo).
#   • Skip vendored / generated / fixture directories (they intentionally
#     contain dummy tokens). Any "real" secret living there should still be
#     called out by a developer review, not by this scanner.
#   • Patterns are deliberately conservative: false positives waste developer
#     time, false negatives waste customer trust. We bias toward signal.
#
# Patterns detected:
#   • AWS access key IDs:                AKIA[0-9A-Z]{16}
#   • Anthropic live API keys:           sk-ant-[A-Za-z0-9_-]{20,}
#   • Generic OpenAI-style live keys:    sk-[A-Za-z0-9]{32,}
#   • Long JWT-shaped tokens:            eyJ[A-Za-z0-9_-]{20,}\.eyJ...
#   • Inline password assignments:       password\s*=\s*"...."
#   • PEM private-key headers:           -----BEGIN (RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----
#
# Exit 1 on any match, 0 otherwise.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2

EXCLUDE_DIRS=(
  --exclude-dir=node_modules
  --exclude-dir=.git
  --exclude-dir=dist
  --exclude-dir=build
  --exclude-dir=.next
  --exclude-dir=.turbo
  --exclude-dir=.vercel
  --exclude-dir=coverage
  --exclude-dir=drizzle
  --exclude-dir=__fixtures__
)

# Files we know contain example/template values or documentation describing
# patterns. Excluded by exact basename so a file with these names anywhere
# in the tree is skipped.
EXCLUDE_FILES=(
  --exclude=.env.example
  --exclude=.env.sample
  --exclude=.env.template
  --exclude=SECRETS.md
  --exclude=package-lock.json
  --exclude=yarn.lock
  --exclude=pnpm-lock.yaml
  --exclude=check-secrets.sh
)

# Combine into one ERE alternation. `grep -E` is happy with this and the
# single pass keeps wall-clock under a second on this repo.
PATTERN='AKIA[0-9A-Z]{16}'
PATTERN+='|sk-ant-[A-Za-z0-9_-]{20,}'
PATTERN+='|sk-[A-Za-z0-9]{32,}'
PATTERN+='|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
PATTERN+='|[Pp]assword[[:space:]]*=[[:space:]]*"[^"]{6,}"'
PATTERN+='|-----BEGIN[[:space:]]+(RSA[[:space:]]+|EC[[:space:]]+|DSA[[:space:]]+|OPENSSH[[:space:]]+)?PRIVATE[[:space:]]+KEY-----'

# `grep -rIEn`:
#   -r recursive, -I skip binary, -E extended regex, -n line numbers.
# Output goes to a temp file so we can both display matches and decide the
# exit code without re-running grep.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if grep -rIEn "${EXCLUDE_DIRS[@]}" "${EXCLUDE_FILES[@]}" "$PATTERN" . > "$TMP" 2>/dev/null; then
  echo "Potential secret patterns detected:" >&2
  cat "$TMP" >&2
  echo >&2
  echo "If a match is a false positive (test fixture, doc snippet), move it to" >&2
  echo "an excluded directory or rename to .env.example / SECRETS.md, or scrub" >&2
  echo "the value before committing." >&2
  exit 1
fi

echo "No secret patterns detected."
exit 0
