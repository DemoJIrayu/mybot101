// usage (in WSL): node thinkpatch.mjs <orig> <out>
import { readFileSync, writeFileSync } from "node:fs";
const [src, out] = process.argv.slice(2);
let s = readFileSync(src, "utf8");
const a = `    try {
      const response = await baseFetch(input instanceof Request ? input : url, {
        ...init,`;
if (!s.includes(a)) throw new Error("anchor missing");
s = s.replace(a, `    try {
      const response = await baseFetch(input instanceof Request ? input : url, {
        ...init,
        body: localThinking(init?.body),`);
const b = `async function closeDispatcherWithResponse(`;
s = s.replace(b, `// hotfix(BotTeam): llama-server ignores reasoning_effort and only honours chat_template_kwargs.enable_thinking.
// Thinking goes off for reasoning_effort "none" (bot thinking level "off"). Follow-up steps of a computer/browser loop
// get a small thinking budget: the planning step thinks fully, each later click/type thinks briefly (~5x faster).
// A budget (not "off") keeps the answer step reliable: fully off at long contexts sometimes ends the turn empty.
// calibration knob (docker-compose.override.yml): tokens per follow-up step, 0 = no cap
const GUI_THINKING_BUDGET = Number(process.env.RAKAZO_GUI_THINKING_BUDGET ?? 256);
const GUI_TOOL = /^(computer|browser)_/;
type ChatMessage = { role?: string; tool_calls?: { function?: { name?: string } }[] };
type ChatRequest = { messages?: ChatMessage[]; reasoning_effort?: string; chat_template_kwargs?: object; thinking_budget_tokens?: number };
export function localThinking(body: unknown): unknown {
  if (typeof body !== "string" || !body.includes('"messages"')) return body;
  try {
    const req = JSON.parse(body) as ChatRequest;
    const msgs = req.messages ?? [];
    let i = msgs.length - 1;
    // skip the trailing tool results (plus the image message some chat formats add right after one)
    while (i > 0 && (msgs[i]?.role === "tool" || (msgs[i]?.role === "user" && msgs[i - 1]?.role === "tool"))) i--;
    const gui = i < msgs.length - 1 && msgs[i]?.role === "assistant" &&
      !!msgs[i]?.tool_calls?.some((c) => GUI_TOOL.test(c.function?.name ?? ""));
    if (req.reasoning_effort === "none") req.chat_template_kwargs = { ...req.chat_template_kwargs, enable_thinking: false };
    else if (gui && GUI_THINKING_BUDGET > 0) req.thinking_budget_tokens ??= GUI_THINKING_BUDGET;
    else return body;
    return JSON.stringify(req);
  } catch {
    return body;
  }
}

${b}`);
writeFileSync(out, s);
console.log("patched", s.split("\n").length, "lines");
