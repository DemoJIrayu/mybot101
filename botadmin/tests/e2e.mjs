// End-to-end UI test against the running app (BotAdmin.exe --devtools-port 9223) and live Rakazo + Gemma.
// Creates 2 throwaway bots + 1 group through the real UI, chats, checks replies, then archives them.
// usage: node e2e.mjs [outDir]
import { connect } from "./cdp.mjs";
const out = process.argv[2] || "D:/tmp";
const c = await connect();
const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${info}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const js = s => JSON.stringify(s);
const click = sel => c.evaluate(`(() => { const e = document.querySelector(${js(sel)}); if (!e) return false; e.click(); return true; })()`);
const type = (sel, text) => c.evaluate(`(() => { const e = document.querySelector(${js(sel)}); e.value = ${js(text)}; e.dispatchEvent(new Event("input")); return true; })()`);
const created = { bots: [], group: null };
const stamp = Date.now().toString(36).slice(-4);

async function createBot(name, role) {
  await c.evaluate(`App.go({ type: "home" })`);
  await click("#newAgent");
  check(`modal templates (${name})`, await c.waitFor(`document.querySelectorAll(".tpl").length === 7`, 3000));
  await click('.tpl[data-i="-1"]');
  await c.waitFor(`!!document.querySelector("#f-name")`, 3000);
  await type("#f-name", name);
  await type("#f-role", role);
  await click('[data-mode="team"]'); // no dedicated container for a throwaway bot
  await click("#f-ok");
  const born = await c.waitFor(`!!document.querySelector(".born #f-go")`, 20000);
  check(`create bot ${name}`, born);
  const id = await c.evaluate(`App.chat.state.bots.find(b => b.name === ${js(name)})?.id`);
  created.bots.push(id);
  await click("#f-go");
  check(`open chat ${name}`, await c.waitFor(`App.route()?.id === ${js(id)} && !!document.querySelector("#c-input")`, 5000));
  return id;
}

async function send(text) {
  await c.waitFor(`!document.querySelector("#msgs-inner .empty .typing")`, 10000); // snapshot loaded
  await type("#c-input", text);
  await click("#c-send");
}

try {
  // 1. single bot: streamed reply + tool steps
  const a = await createBot(`ทดสอบ-A-${stamp}`, "ตอบภาษาไทยสั้นๆ");
  const t0 = Date.now();
  await send("ใช้ web_fetch อ่าน https://example.com แล้วบอกหัวข้อหน้าเว็บเป็นประโยคเดียว");
  check("my bubble appears", await c.waitFor(`document.querySelectorAll(".msg.me").length >= 1`, 3000));
  const typing = await c.waitFor(`!!document.querySelector(".msg.bot .typing, .steps")`, 30000);
  check("typing/steps indicator", typing, `${Date.now() - t0}ms`);
  const stepsSeen = await c.waitFor(`!!document.querySelector(".steps")`, 60000);
  check("tool steps block", stepsSeen);
  await c.screenshot(`${out}/e2e-steps.png`);
  const done = await c.waitFor(`(() => { const m = [...document.querySelectorAll(".msg.bot")].pop(), b = m && !m.dataset.id.startsWith("progress:") && m.querySelector(".bubble"); return !document.querySelector(".msg.bot .typing") && !App.chat.state.bots.find(x => x.id === ${js(a)})?.working && b && b.innerText.length > 5 && b.innerText; })()`, 180000);
  check("bot final reply", done && /example/i.test(done), `${Date.now() - t0}ms: ${String(done).slice(0, 80)}`);
  check("steps collapsed as done", await c.evaluate(`!!document.querySelector(".steps summary .label") && /ขั้นตอน/.test(document.querySelector(".steps summary .label").textContent)`));
  await c.screenshot(`${out}/e2e-chat.png`);

  // 2. group of two bots
  const b = await createBot(`ทดสอบ-B-${stamp}`, "ตอบภาษาไทยสั้นๆ");
  await c.evaluate(`App.go({ type: "home" })`);
  await click("#newGroup");
  await c.waitFor(`!!document.querySelector("#g-name")`, 3000);
  await type("#g-name", `ห้องทดสอบ-${stamp}`);
  await c.evaluate(`[${js(a)}, ${js(b)}].forEach(id => document.querySelector('.pick .opt[data-id="' + id + '"]').click())`);
  await click("#g-ok");
  const gid = await c.waitFor(`App.route()?.type === "group" && App.route().id`, 15000);
  created.group = gid;
  check("create group", gid);
  const g0 = Date.now();
  await send("@everyone ตอบคำเดียวว่า พร้อม");
  const both = await c.waitFor(`(() => { const who = new Set([...document.querySelectorAll(".msg.bot")].filter(m => m.querySelector(".bubble") && !m.querySelector(".typing")).map(m => m.querySelector(".who")?.textContent).filter(Boolean)); return who.size >= 2 && !App.chat.state.bots.some(x => x.working); })()`, 180000);
  check("both group members reply", both, `${Date.now() - g0}ms`);
  await c.screenshot(`${out}/e2e-group.png`);
} finally {
  // cleanup: archive what this test created
  if (created.group) await c.evaluate(`App.call("rk", { path: "groups/archive", input: { groupId: ${js(created.group)} } }).catch(e => e.message)`);
  for (const id of created.bots.filter(Boolean)) await c.evaluate(`App.call("rk", { path: "bots/archive", input: { botId: ${js(id)} } }).catch(e => e.message)`);
  await c.evaluate(`App.chat.load().then(() => App.go({ type: "home" }))`);
  const errors = await c.evaluate(`window.__errors`);
  check("no JS errors", errors.length === 0, JSON.stringify(errors));
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
