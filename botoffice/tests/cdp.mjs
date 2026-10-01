// Minimal Chrome DevTools Protocol client for UI tests (Node 22+ built-in WebSocket; no packages).
export async function connect(port = 9223, timeoutMs = 30000, prefix = "https://botteam.example") {
  const t0 = Date.now();
  let page;
  while (!page) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p => p.url.startsWith(prefix)); }
    catch { /* app still starting */ }
    if (!page) { if (Date.now() - t0 > timeoutMs) throw new Error(`no page ${prefix} on devtools port ${port}`); await new Promise(r => setTimeout(r, 300)); }
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
