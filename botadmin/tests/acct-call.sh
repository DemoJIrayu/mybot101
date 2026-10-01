#!/bin/bash
# Call one demo-accounting MCP tool from inside rakazo-worker (the loopback the bots use) and print its structured result.
# The bearer token is read here and never printed. usage: acct-call.sh <tool> '<json args>'
T=$(cat ~/rakazo/demo-acct/token)
docker exec -e T="$T" -e TOOL="$1" -e ARGS="${2:-{\}}" rakazo-worker-1 node -e '
fetch("http://localhost:7788/mcp", { method: "POST", headers: { authorization: "Bearer " + process.env.T, "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: process.env.TOOL, arguments: JSON.parse(process.env.ARGS) } }) })
  .then(r => r.json()).then(j => { if (j.result?.isError) throw new Error(j.result.content[0].text); console.log(JSON.stringify(j.result.structuredContent.result)); })
  .catch(e => { console.error(e.message); process.exit(1); });'
