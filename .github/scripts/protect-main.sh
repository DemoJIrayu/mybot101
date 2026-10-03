#!/usr/bin/env bash
# Protect the default branch: every change (yours and the agents') must come through a
# pull request and pass the DevSecOps checks.
#
#   bash .github/scripts/protect-main.sh                                 # this repo
#   bash .github/scripts/protect-main.sh DemoJIrayu/Anne-AIChatbot
#   bash .github/scripts/protect-main.sh DemoJIrayu/YourNorst --no-code-scanning
#
# --no-code-scanning: for repos that call the pipeline with code_scanning: false
# (private repos without GitHub Advanced Security): CodeQL and dependency review
# don't run there, so they can't be required.
set -euo pipefail

REPO=""
CODE_SCANNING=true
for arg in "$@"; do
  case "$arg" in
    --no-code-scanning) CODE_SCANNING=false ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) REPO="$arg" ;;
  esac
done
REPO=${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}
BRANCH=$(gh repo view "$REPO" --json defaultBranchRef -q .defaultBranchRef.name)

# Check names are "<caller job> / <reusable job>"; the caller job is called "devsecops".
# Jobs skipped by their `if` (e.g. no Python project) count as passing.
checks=(secrets semgrep trivy python node e2e)
if [ "$CODE_SCANNING" = true ]; then
  checks+=(dependency-review)
  langs=$(gh api "repos/$REPO/contents/.github/workflows/devsecops.yml" -q .content 2>/dev/null \
    | base64 -d 2>/dev/null | grep -o 'codeql_languages:.*' || true)
  [ -z "$langs" ] && langs='"javascript-typescript"'
  for lang in python javascript-typescript; do
    if [[ "$langs" == *"$lang"* ]]; then checks+=("codeql ($lang)"); fi
  done
fi
contexts=$(printf '%s\n' "${checks[@]}" | sed 's|^|devsecops / |' | jq -R . | jq -s .)

jq -n --argjson contexts "$contexts" '{
  required_status_checks: { strict: true, contexts: $contexts },
  enforce_admins: true,
  required_pull_request_reviews: { required_approving_review_count: 0 },
  required_conversation_resolution: true,
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false
}' | gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input - >/dev/null

echo "✓ $BRANCH is protected on $REPO. Required checks:"
gh api "repos/$REPO/branches/$BRANCH/protection" -q '.required_status_checks.contexts[]' \
  | sed 's/^/  - /'
