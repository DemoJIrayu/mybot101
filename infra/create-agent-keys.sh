#!/usr/bin/env bash
# Create one LiteLLM key per agent, limited to its model aliases and a monthly budget,
# and save them into infra/.env. Keys are never printed.
# Safe to re-run: existing keys are kept, and their allowed models and budget are
# updated to match the table below (e.g. after adding a new model alias).
# Run from the repo root, with `docker compose up -d` already running:
#   bash infra/create-agent-keys.sh
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck disable=SC1091
source .env
: "${LITELLM_MASTER_KEY:?LITELLM_MASTER_KEY missing in infra/.env}"
URL="http://127.0.0.1:4000"

# name | env var | allowed model aliases | monthly USD budget
AGENTS=(
  "lead-agent|LEAD_AGENT_KEY|lead,worker,worker-paid|5"
  "dev-agent|DEV_AGENT_KEY|coder-or,worker,worker-paid|5"
  "qa-agent|QA_AGENT_KEY|worker,worker-paid|2"
)

api() {  # api <path> <json-body>
  curl -fsS "$URL$1" \
    -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
    -H "Content-Type: application/json" \
    -d "$2"
}

for entry in "${AGENTS[@]}"; do
  IFS='|' read -r alias var models budget <<<"$entry"
  models_json=$(jq -cn --arg m "$models" '$m | split(",")')
  existing=$(grep -E "^${var}=" .env | head -1 | cut -d= -f2- || true)

  if [ -n "$existing" ]; then
    body=$(jq -cn --arg k "$existing" --argjson m "$models_json" --argjson b "$budget" \
      '{key: $k, models: $m, max_budget: $b}')
    if api /key/update "$body" >/dev/null; then
      echo "✓ $var updated: models [$models], budget \$$budget / 30 days"
    else
      echo "✗ could not update $var (is LiteLLM running? is the key still valid?)" >&2
      exit 1
    fi
    continue
  fi

  body=$(jq -cn --arg a "$alias" --argjson m "$models_json" --argjson b "$budget" \
    '{key_alias: $a, models: $m, max_budget: $b, budget_duration: "30d"}')
  key=$(api /key/generate "$body" | jq -r '.key // empty')
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
