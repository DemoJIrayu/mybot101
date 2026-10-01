// Minimal Chrome DevTools Protocol client for BotAdmin UI tests (Node 22+ built-in WebSocket; no packages).
export async function connect(port = 9223, timeoutMs = 30000) {
  const t0 = Date.now();
  let page;
  while (!page) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p => p.url.startsWith("https://botteam.example")); }
    catch { /* app still starting */ }
    if (!page) { if (Date.now() - t0 > timeoutMs) throw new Error("no BotTeam page on devtools port " + port); await new Promise(r => setTimeout(r, 300)); }
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waits = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waits.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval error");
    return r.result.result.value;
  };
  const waitFor = async (expr, ms = 15000) => {
    const t = Date.now();
    while (Date.now() - t < ms) { try { const v = await evaluate(expr); if (v) return v; } catch {} await new Promise(r => setTimeout(r, 300)); }
    return null;
  };
  const screenshot = async (file) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(file, Buffer.from(r.result.data, "base64"));
  };
  return { send, evaluate, waitFor, screenshot, close: () => ws.close() };
}

// Test bots (Bot A/B) live archived so the demo roster and the 3D office only show the company bots:
// restore (or create) one for the test, and call done() in finally to archive it again.
export async function borrowBot(rk, name, create) {
  let bot = (await rk("bots/list")).find(b => b.name === name);
  const wasActive = !!bot; // an active bot (e.g. CEO) is only used, never archived
  const archived = !bot && (await rk("bots/listArchived")).find(b => b.name === name);
  if (archived) { await rk("bots/restore", { botId: archived.id }); bot = archived; }
  bot ||= await rk("bots/create", { name, title: "บอททดสอบระบบ (Private Computer)", color: "#6d7cff", computerMode: "dedicated", ...create });
  return { bot, done: async () => { if (!wasActive) await rk("bots/archive", { botId: bot.id }); } };
}
