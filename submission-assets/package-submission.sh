#!/usr/bin/env bash
#
# Builds PocketChaos_Hackathon_Submission.zip: "a ZIP containing the complete project and full Git history",
# with no passwords, keys, tokens or secrets (Build With AI Hackathon 2026 guidebook, pages 9 and 12).
#
#   ./submission-assets/package-submission.sh [--allow-dirty] [--allow-empty-context] [--output FILE]
#
# What goes in:  the committed project exactly as at HEAD, plus .git/ (all branches and tags, full history).
# What stays out: node_modules/, .env files, dist/, build/, .expo/, coverage/, logs, OS junk, uncommitted work.
#
# Pre-flight checks (any failure aborts; nothing in your repository is modified):
#   1. secret scan of the committed tree AND the whole history (private keys, cloud/API tokens, credentialed
#      MongoDB URIs, filled-in JWT_SECRET / DEMO_PASSWORD), plus credentials embedded in git remote URLs;
#   2. no .env (other than .env.example), key-store or certificate file is tracked or was ever committed;
#   3. no dependency / build folders are tracked;
#   4. context files are not empty (.ai/AI_LEARNING_LOG.md Entry #3: "an empty context file fails silently");
#   5. uncommitted changes are reported, because only committed work is packaged.
#
set -euo pipefail

ALLOW_DIRTY=0
ALLOW_EMPTY_CONTEXT=0
OUTPUT=""
ZIP_NAME="PocketChaos_Hackathon_Submission.zip"
ARCHIVE_ROOT="PocketChaos"

while [ $# -gt 0 ]; do
  case "$1" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --allow-empty-context) ALLOW_EMPTY_CONTEXT=1 ;;
    --output) shift; OUTPUT="${1:-}" ;;
    --output=*) OUTPUT="${1#--output=}" ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED=$'\033[1;31m'; GREEN=$'\033[1;32m'; AMBER=$'\033[1;33m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=""; GREEN=""; AMBER=""; DIM=""; BOLD=""; RESET=""
fi
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$AMBER" "$RESET" "$*"; }
fail() { printf '  %s✗ %s%s\n' "$RED" "$*" "$RESET"; FAILED=1; }
FAILED=0

for tool in git zip unzip; do
  command -v "$tool" >/dev/null 2>&1 || { echo "${RED}Missing required tool: $tool${RESET}" >&2; exit 1; }
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || { echo "Not inside a Git repository." >&2; exit 1; }
cd "$ROOT"
git rev-parse --verify -q HEAD >/dev/null || { echo "The repository has no commits yet." >&2; exit 1; }

[ -n "$OUTPUT" ] || OUTPUT="$ROOT/dist/$ZIP_NAME"
case "$OUTPUT" in /*) ;; *) OUTPUT="$PWD/$OUTPUT" ;; esac

printf '\n%sPocketChaos submission packager%s %s(%s @ %s)%s\n\n' "$BOLD" "$RESET" "$DIM" "$(git rev-parse --abbrev-ref HEAD)" "$(git rev-parse --short HEAD)" "$RESET"

# ------------------------------------------------------------------------------------------------ 1. secret scan
echo "${BOLD}1. Secret scan${RESET} ${DIM}(committed tree + full history)${RESET}"

SECRET_PATTERNS=(
  'BEGIN [A-Z ]*PRIVATE KEY'                                  # PEM / OpenSSH private keys
  'AKIA[0-9A-Z]{16}'                                          # AWS access key id
  'gh[pousr]_[A-Za-z0-9]{36}'                                 # GitHub tokens
  'github_pat_[A-Za-z0-9_]{22,}'                              # GitHub fine-grained tokens
  'xox[baprs]-[A-Za-z0-9-]{10,}'                              # Slack tokens
  'AIza[0-9A-Za-z_-]{35}'                                     # Google API keys
  '(sk|rk)_live_[0-9A-Za-z]{20,}'                             # Stripe live keys
  'sk-(ant-)?[A-Za-z0-9_-]{20,}'                              # OpenAI / Anthropic API keys
  'mongodb(\+srv)?://[^/[:space:]:@"'"'"']+:[^@[:space:]"'"'"']+@'  # MongoDB URI with username:password
  '(JWT_SECRET|DEMO_PASSWORD|API_KEY|SECRET_KEY)=[^[:space:]$]+'    # filled-in env assignments
)
GREP_ARGS=()
for pattern in "${SECRET_PATTERNS[@]}"; do GREP_ARGS+=(-e "$pattern"); done

tree_hits="$(git grep -I -n -E "${GREP_ARGS[@]}" HEAD -- . ':(exclude)**/package-lock.json' 2>/dev/null || true)"
if [ -n "$tree_hits" ]; then
  fail "Possible secrets in the committed tree:"
  printf '%s\n' "$tree_hits" | cut -c1-160 | sed 's/^/      /'
else
  ok "No secret patterns in the $(git ls-tree -r --name-only HEAD | wc -l | tr -d ' ') committed files"
fi

history_hits="$(git log --all --reflog -p --no-color --no-ext-diff 2>/dev/null | grep -nE "${GREP_ARGS[@]}" || true)"
if [ -n "$history_hits" ]; then
  fail "Possible secrets somewhere in the Git history (they would ship inside .git/):"
  printf '%s\n' "$history_hits" | cut -c1-160 | head -20 | sed 's/^/      /'
  echo "      Rewrite history (e.g. git filter-repo) and rotate the credential before submitting."
else
  ok "No secret patterns in $(git rev-list --all --reflog 2>/dev/null | sort -u | wc -l | tr -d ' ') commits of history"
fi

remote_creds="$(git config --get-regexp '^remote\..*\.url$' 2>/dev/null | grep -E '://[^/@[:space:]]+:[^/@[:space:]]+@' || true)"
if [ -n "$remote_creds" ]; then
  fail "A git remote URL embeds credentials (.git/config ships in the ZIP): $(printf '%s' "$remote_creds" | sed -E 's#://[^@]+@#://***@#')"
else
  ok "No credentials in git remote URLs"
fi

if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks detect --source "$ROOT" --no-banner --redact >/dev/null 2>&1; then ok "gitleaks: no leaks"; else fail "gitleaks reported leaks (run: gitleaks detect --redact -v)"; fi
fi

# ------------------------------------------------------------------------------------------------ 2. forbidden files
echo "${BOLD}2. Forbidden files${RESET}"
FORBIDDEN_FILES='(^|/)\.env($|\.)|\.(pem|key|p8|p12|pfx|jks|keystore|mobileprovision)$|(^|/)id_(rsa|ed25519|ecdsa)'
tracked_bad="$(git ls-tree -r --name-only HEAD | grep -E "$FORBIDDEN_FILES" | grep -vE '(^|/)\.env\.example$' || true)"
history_bad="$(git log --all --reflog --name-only --format= 2>/dev/null | sort -u | grep -E "$FORBIDDEN_FILES" | grep -vE '(^|/)\.env\.example$' || true)"
if [ -n "$tracked_bad" ]; then fail "Committed secret-bearing files: $(echo $tracked_bad)"; else ok "No .env / key-store files committed (only .env.example)"; fi
if [ -n "$history_bad" ]; then fail "Secret-bearing files appear in the history: $(echo $history_bad)"; else ok "No .env / key-store file was ever committed"; fi

FORBIDDEN_DIRS='(^|/)(node_modules|dist|build|\.expo|coverage)/'
tracked_dirs="$(git ls-tree -r --name-only HEAD | grep -E "$FORBIDDEN_DIRS" | head -5 || true)"
if [ -n "$tracked_dirs" ]; then fail "Dependency/build output is committed (e.g. $(echo $tracked_dirs | cut -c1-120)); remove it and commit"; else ok "No node_modules/, dist/, build/, .expo/ or coverage/ committed"; fi

# ------------------------------------------------------------------------------------------------ 3. context files
echo "${BOLD}3. AI context files${RESET}"
context_files="$(git ls-tree -r --name-only HEAD | grep -E '^(\.ai/.*\.md|POCKETCHAOS_MASTER_PLAN\.md|README\.md)$' || true)"
if [ -z "$context_files" ]; then
  warn "No .ai/*.md context files found at HEAD"
else
  empty=""
  for file in $context_files; do
    if [ "$(git cat-file -s "HEAD:$file")" -eq 0 ]; then empty="$empty $file"; fi
  done
  if [ -n "$empty" ]; then
    if [ "$ALLOW_EMPTY_CONTEXT" -eq 1 ]; then warn "Empty context files (allowed by --allow-empty-context):$empty"
    else fail "Empty context files:$empty. Fill them in and commit, or pass --allow-empty-context"; fi
  else
    ok "$(echo "$context_files" | wc -l | tr -d ' ') context files, none empty"
  fi
fi

# ------------------------------------------------------------------------------------------------ 4. working tree
echo "${BOLD}4. Working tree${RESET}"
changed="$(git status --porcelain --untracked-files=no)"
untracked="$(git ls-files --others --exclude-standard)"
if [ -n "$changed" ]; then
  if [ "$ALLOW_DIRTY" -eq 1 ]; then warn "Uncommitted changes are NOT included (only HEAD is packaged):"; else fail "Uncommitted changes would be left out of the ZIP. Commit them, or pass --allow-dirty:"; fi
  printf '%s\n' "$changed" | head -15 | sed 's/^/      /'
else
  ok "No uncommitted changes to tracked files"
fi
if [ -n "$untracked" ]; then
  warn "Untracked files are not included (commit them if they belong in the submission):"
  printf '%s\n' "$untracked" | head -15 | sed 's/^/      /'
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\n%sPre-flight failed: no ZIP was written.%s\n\n' "$RED" "$RESET"
  exit 1
fi

# ------------------------------------------------------------------------------------------------ 5. build
echo "${BOLD}5. Build${RESET}"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/pocketchaos-zip.XXXXXX")"
CHECK=""
trap 'rm -rf "$STAGE" ${CHECK:+"$CHECK"}' EXIT
PROJECT="$STAGE/$ARCHIVE_ROOT"
mkdir -p "$PROJECT"

git archive --format=tar HEAD | tar -x -C "$PROJECT"
cp -R "$ROOT/.git" "$PROJECT/.git"
find "$PROJECT/.git" -name '*.lock' -type f -delete
# The copy (never your repository) is reset to HEAD and pruned: unreachable objects, such as amended commits
# kept only by the reflog, would otherwise ship content that the history scan above cannot vouch for.
git -C "$PROJECT" reset -q
git -C "$PROJECT" reflog expire --expire=now --all
git -C "$PROJECT" gc --prune=now --quiet 2>/dev/null
git -C "$PROJECT" config --local --unset-all core.hooksPath 2>/dev/null || true
ok "Staged HEAD + full Git history ($(git -C "$PROJECT" rev-list --all | wc -l | tr -d ' ') commits)"

mkdir -p "$(dirname "$OUTPUT")"
rm -f "$OUTPUT"
(
  cd "$STAGE"
  zip -q -r -X "$OUTPUT" "$ARCHIVE_ROOT" \
    -x "*/node_modules/*" "*/dist/*" "*/build/*" "*/.expo/*" "*/coverage/*" \
       "*.log" "*/.DS_Store" "*/.env" "*/.env.local" "*/.env.*.local" "*/$ZIP_NAME"
)
ok "Wrote $OUTPUT"

# ------------------------------------------------------------------------------------------------ 6. verify
echo "${BOLD}6. Verify${RESET}"
listing="$(unzip -Z1 "$OUTPUT")"
bad_entries="$(printf '%s\n' "$listing" | grep -E '(^|/)(node_modules|\.expo|coverage)/|(^|/)\.env($|\.)' | grep -vE '\.env\.example$' || true)"
if [ -n "$bad_entries" ]; then fail "Excluded paths found in the ZIP: $(echo $bad_entries | cut -c1-200)"; else ok "No node_modules/, .env, .expo/ or coverage/ entries"; fi
printf '%s\n' "$listing" | grep -q "^$ARCHIVE_ROOT/.git/HEAD$" && ok "Contains .git/ (full history)" || fail ".git/ is missing from the ZIP"

CHECK="$(mktemp -d "${TMPDIR:-/tmp}/pocketchaos-check.XXXXXX")"
unzip -q "$OUTPUT" -d "$CHECK"
extracted="$CHECK/$ARCHIVE_ROOT"
if git -C "$extracted" fsck --no-progress >/dev/null 2>&1 && [ -z "$(git -C "$extracted" status --porcelain)" ]; then
  ok "Extracted copy: git fsck passes, working tree clean, HEAD $(git -C "$extracted" rev-parse --short HEAD), $(git -C "$extracted" rev-list --count HEAD) commits"
else
  fail "The extracted copy is not a clean Git repository"
fi
rm -rf "$CHECK"

if [ "$FAILED" -ne 0 ]; then
  rm -f "$OUTPUT"
  printf '\n%sVerification failed: the ZIP was removed.%s\n\n' "$RED" "$RESET"
  exit 1
fi

size="$(du -h "$OUTPUT" | cut -f1 | tr -d ' ')"
count="$(printf '%s\n' "$listing" | grep -vc '/$')"
sha="$(shasum -a 256 "$OUTPUT" 2>/dev/null || sha256sum "$OUTPUT")"
printf '\n%sReady:%s %s\n       %s files · %s · sha256 %s\n\n' "$GREEN" "$RESET" "$OUTPUT" "$count" "$size" "${sha%% *}"
