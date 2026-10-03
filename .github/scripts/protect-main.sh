#!/usr/bin/env bash
# Protect main: every change (yours and the agents') must come through a pull
# request and pass the DevSecOps checks. Run once from the repo root:
#   bash .github/scripts/protect-main.sh
set -euo pipefail

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "secrets",
      "semgrep",
      "trivy",
      "dependency-review",
      "codeql (python)",
      "codeql (javascript-typescript)",
      "python",
      "node"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "required_conversation_resolution": true,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "✓ main is protected on $REPO"
gh api "repos/$REPO/branches/main/protection" \
  -q '.required_status_checks.contexts | join(", ")'
