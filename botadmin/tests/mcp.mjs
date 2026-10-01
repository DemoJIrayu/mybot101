// MCP acceptance: add a public remote MCP server through the app UI, assign it to a throwaway bot,
// ask the bot to use it, and confirm an MCP tool actually ran. Cleans up after itself. usage: node mcp.mjs
import { connect } from "./cdp.mjs";

const c = await connect();
const js = JSON.stringify;
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`); };
const set = (sel, v) => c.evaluate(`(() => { const e = document.querySelector(${js(sel)}); e.value = ${js(v)}; e.dispatchEvent(new Event("input")); })()`);
const click = sel => c.evaluate(`document.querySelector(${js(sel)}).click()`);
const NAME = "DeepWiki ทดสอบ";
let server, bot;

try {
  // 1) add through the UI
  await c.evaluate(`App.go({ type: "mcp" })`);
  await c.waitFor(`!!document.querySelector("#mcp-add")`, 5000);
  await click("#mcp-add");
  await c.waitFor(`!!document.querySelector("#m-url")`, 3000);
  await set("#m-name", NAME);
  await set("#m-url", "https://mcp.deepwiki.com/mcp");
  await set("#m-desc", "ถามเรื่อง repo บน GitHub");
  await click("#m-ok");
  check("server card shown", await c.waitFor(`[...document.querySelectorAll("#mcp-list .card h3")].some(h => h.textContent.includes(${js(NAME)}))`, 20000));
  server = (await rk("mcp/servers/list")).find(s => s.name === NAME);
  check("server stored", server && server.transport === "streamable_http", server && server.slug);

  // 2) assign to a throwaway bot through the UI
  bot = await rk("bots/create", { name: "ทดสอบ MCP", title: "บอททดสอบ MCP", instructions: "ตอบภาษาไทยสั้นๆ ใช้เครื่องมือ MCP ที่มีเมื่อถูกขอ", computerMode: "team", color: "#6d7cff" });
  await c.evaluate(`App.go({ type: "mcp" })`);
  await c.waitFor(`!!document.querySelector('[data-assign="${server.id}"]')`, 10000);
  await click(`[data-assign="${server.id}"]`);
  await c.waitFor(`!!document.querySelector('#a-list .opt[data-id="${bot.id}"]')`, 5000);
  await click(`#a-list .opt[data-id="${bot.id}"]`);
  await click("#a-ok");
  await c.waitFor(`!document.querySelector("#a-ok")`, 15000);
  const links = await rk("mcp/assignments/list", { botId: bot.id });
  check("assignment saved", JSON.stringify(links).includes(server.id), JSON.stringify(links).slice(0, 160));
  await c.screenshot("D:/tmp/mcp-page.png");

  // 3) the bot uses it
  const t0 = Date.now();
  await rk("threads/send", { botId: bot.id, text: "ใช้เครื่องมือ DeepWiki (MCP) ถามว่า repo facebook/react เขียนด้วยภาษาอะไรเป็นหลัก แล้วตอบสั้นๆ ว่าใช้เครื่องมือชื่ออะไร", clientNonce: "mcp-" + t0 });
  let snap;
  for (;;) {
    await sleep(3000);
    snap = await rk("threads/get", { botId: bot.id });
    if (snap.messages.some(m => m.role === "bot") && (!snap.run || ["completed", "failed", "cancelled", "waiting_input"].includes(snap.run.status))) break;
    if (Date.now() - t0 > 300000) throw new Error("timeout");
  }
  const steps = snap.messages.flatMap(m => m.blocks.filter(b => b.kind === "steps").flatMap(b => b.steps.map(s => s.label)));
  const reply = snap.messages.filter(m => m.role === "bot").flatMap(m => m.blocks.map(b => b.text || "")).join(" ").replace(/\s+/g, " ");
  console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s run=${snap.run?.status} steps=${js(steps)}\n   reply: ${reply.slice(0, 240)}`);
  check("bot called an MCP tool", steps.some(s => /deepwiki|ask_question|read_wiki|mcp/i.test(s)), js(steps));
  check("bot answered about React", /JavaScript|TypeScript|Flow/i.test(reply));
} finally {
  if (bot) await rk("bots/archive", { botId: bot.id }).catch(e => console.log("archive:", e.message));
  if (server) await rk("mcp/servers/remove", { id: server.id }).catch(e => console.log("remove:", e.message));
  await c.evaluate(`App.chat.load()`);
  const errors = await c.evaluate(`window.__errors`);
  check("no JS errors", errors.length === 0, js(errors));
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
