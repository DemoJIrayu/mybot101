#!/usr/bin/env bash
# Prepare a repository for the agent team: open a PR that adds the shared DevSecOps
# pipeline, Dependabot and the npm 7-day rule. You review and merge it, then protect
# the branch. Agents can't do this themselves (they may never change .github/).
#
#   bash infra/onboard-repo.sh DemoJIrayu/Anne-AIChatbot
#   bash infra/onboard-repo.sh DemoJIrayu/YourNorst
set -euo pipefail

REPO=${1:?usage: bash infra/onboard-repo.sh OWNER/REPO}
HERE=$(cd "$(dirname "$0")" && pwd)
SHORT=${REPO#*/}
if ! grep -qiF "[repos.\"$REPO\"]" "$HERE/repos.toml"; then
  echo "✗ $REPO isn't listed in infra/repos.toml; add it there first (via a PR)." >&2
  exit 1
fi

DIR=${AGENT_REPOS_DIR:-$HOME/agent-repos}/$REPO
if [ ! -d "$DIR/.git" ]; then
  mkdir -p "$(dirname "$DIR")"
  gh repo clone "$REPO" "$DIR" -- --quiet
fi
cd "$DIR"
git fetch --quiet origin
BASE=$(gh repo view "$REPO" --json defaultBranchRef -q .defaultBranchRef.name)
START=$(git rev-parse --abbrev-ref HEAD)
BRANCH="onboard/agent-team-$(date +%Y%m%d-%H%M%S)"
git switch --quiet -c "$BRANCH" "origin/$BASE"

WORKFLOW="$HERE/onboarding/workflows/$SHORT.yml"
[ -f "$WORKFLOW" ] || WORKFLOW="$HERE/onboarding/workflows/default.yml"
mkdir -p .github/workflows
cp "$WORKFLOW" .github/workflows/devsecops.yml
[ -f .github/dependabot.yml ] || cp "$HERE/onboarding/dependabot.yml" .github/dependabot.yml
if [ ! -f .npmrc ]; then
  cp "$HERE/onboarding/npmrc" .npmrc
elif ! grep -q '^min-release-age' .npmrc; then
  printf '\n' >> .npmrc && cat "$HERE/onboarding/npmrc" >> .npmrc
fi

git add .github/workflows/devsecops.yml .github/dependabot.yml .npmrc
git commit --quiet -m "Add shared DevSecOps pipeline for the agent team"
git push --quiet -u origin "$BRANCH"
URL=$(gh pr create --repo "$REPO" --base "$BASE" --head "$BRANCH" \
  --title "Add shared DevSecOps pipeline (agent team onboarding)" \
  --body "Adds .github/workflows/devsecops.yml, which calls the shared pipeline in DemoJIrayu/mybot101 (secrets, Semgrep, Trivy, CodeQL, tests with test databases), plus Dependabot and the npm 7-day release-age rule.")
git switch --quiet "$START"

FLAG=""
grep -q 'code_scanning: false' "$WORKFLOW" && FLAG=" --no-code-scanning"
echo "✓ Pull request: $URL"
echo
echo "Next:"
echo "  1. Wait for the checks:      gh pr checks --repo $REPO --watch $BRANCH"
echo "  2. Merge it:                 gh pr merge --repo $REPO --squash --delete-branch $BRANCH"
echo "  3. Protect $BASE:              bash .github/scripts/protect-main.sh $REPO$FLAG"
echo "Then the agents can work on it:  python -m agent_team lead --repo $REPO \"...\""
