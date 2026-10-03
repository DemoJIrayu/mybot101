#!/usr/bin/env bash
# Create one LiteLLM key per agent, each limited to its models and a monthly budget,
# and save them into infra/.env. Keys are never printed.
# Run from the repo root, with `docker compose up -d` already running:
#   bash infra/create-agent-keys.sh
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck disable=SC1091
source .env
: "${LITELLM_MASTER_KEY:?LITELLM_MASTER_KEY missing in infra/.env}"
URL="http://127.0.0.1:4000"

# name | env var | allowed models | monthly USD budget
AGENTS=(
  "lead-agent|LEAD_AGENT_KEY|lead,worker,worker-paid|5"
  "dev-agent|DEV_AGENT_KEY|worker,worker-paid|2"
  "qa-agent|QA_AGENT_KEY|worker,worker-paid|2"
)

for entry in "${AGENTS[@]}"; do
  IFS='|' read -r alias var models budget <<<"$entry"
  if grep -qE "^${var}=.+" .env; then
    echo "• $var already set, skipping"
    continue
  fi
  models_json=$(jq -cn --arg m "$models" '$m | split(",")')
  body=$(jq -cn --arg a "$alias" --argjson m "$models_json" --argjson b "$budget" \
    '{key_alias: $a, models: $m, max_budget: $b, budget_duration: "30d"}')
  key=$(curl -fsS "$URL/key/generate" \
    -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" | jq -r '.key // empty')
  if [ -z "$key" ]; then
    echo "✗ could not create key for $alias (is LiteLLM running?)" >&2
    exit 1
  fi
  # Replace the empty "VAR=" line in .env (create it if missing).
  if grep -q "^${var}=" .env; then
    sed -i "s|^${var}=.*|${var}=${key}|" .env
  else
    echo "${var}=${key}" >> .env
  fi
  echo "✓ $var created: models [$models], budget \$$budget / 30 days"
done
