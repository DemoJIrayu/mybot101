// usage: node page.mjs <url-prefix> "<js>" [screenshot.png] -> evaluate in another WebView2 page (e.g. the Rakazo window)
const [prefix, expr, shot] = process.argv.slice(2);
const page = (await (await fetch("http://127.0.0.1:9223/json")).json()).find(p => p.type === "page" && p.url.startsWith(prefix));
if (!page) { console.log("no page", prefix); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const waits = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); waits.get(m.id)?.(m); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result.result.value ?? r.result.exceptionDetails?.text));
if (shot) (await import("node:fs")).writeFileSync(shot, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
ws.close();
