// Work center (ui/work.js) end to end on Bot A: inbox answers a real question, activity lists and opens runs,
// a routine is created in the form, switched on, run now and removed, and memory taught in the UI is used by the bot.
// usage: node work.mjs  (BotAdmin.exe --devtools-port 9223 running; Bot A's memory and routines are restored after)
import { connect, borrowBot } from "./cdp.mjs";
const c = await connect();
const js = s => JSON.stringify(s);
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${info}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tab = async t => { await c.evaluate(`document.querySelector('#w-tabs [data-tab="${t}"]').click()`); await c.waitFor(`!document.querySelector("#w-body .skeleton")`, 20000); };
const text = sel => c.evaluate(`document.querySelector(${js(sel)})?.innerText || ""`);
const thread = async id => (await rk("threads/get", { botId: id }));
const idle = async id => { const s = await thread(id); return ![s.run, ...(s.activeRuns || [])].some(r => r && !/^(completed|failed|cancelled)$/.test(r.status)); };
const waitIdle = async (id, ms = 180000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await idle(id)) return true; await sleep(1500); } return false; };
const lastBotText = async id => { const s = await thread(id); return s.messages.filter(m => m.role === "bot").flatMap(m => m.blocks).filter(b => b.kind === "text").map(b => b.text).at(-1) || ""; };
let lease = null, memDoc = null, routineId = null;
try {
  lease = await borrowBot(rk, "Bot A");
  const bot = lease.bot, id = bot.id;
  await rk("threads/stop", { botId: id }).catch(() => {});
  await rk("threads/clear", { botId: id });
  await c.evaluate("App.chat.load()");

  // ---------- 1. inbox ----------
  let paused = null;
  for (let i = 0; i < 2 && !paused; i++) { // the model sometimes answers without asking: one more try
    await rk("threads/stop", { botId: id }).catch(() => {});
    await rk("threads/send", { botId: id, text: "ทดสอบระบบ: ถามผมกลับหนึ่งคำถามแบบมีตัวเลือก 2 ข้อ (ใช้เครื่องมือถามผู้ใช้) ว่าจะให้สรุปงานแบบสั้นหรือยาว แล้วรอคำตอบ", clientNonce: "work-" + Date.now() });
    const t = Date.now();
    while (Date.now() - t < 90000 && !paused) {
      paused = (await rk("runs/list", { filter: "active" })).runs.find(r => r.botId === id && /^waiting_/.test(r.status));
      if (!paused) await sleep(1500);
    }
  }
  check("Bot A is waiting for the user", paused, paused?.status);
  await c.evaluate("App.work.poll()");
  check("sidebar badge counts it", +(await text(".nav .badge")) >= 1, await text(".nav .badge"));
  await c.evaluate(`App.go({ type: "work", tab: "inbox" })`);
  const card = await c.waitFor(`[...document.querySelectorAll(".inbox-card")].some(x => x.innerText.includes("Bot A"))`, 15000);
  check("inbox shows Bot A's card", card, (await text(".inbox-card")).replace(/\s+/g, " ").slice(0, 90));
  const how = await c.evaluate(`(() => {
    const k = [...document.querySelectorAll(".inbox-card")].find(x => x.innerText.includes("Bot A"));
    const b = k && k.querySelector("[data-answer]");
    if (b) { b.click(); return "choice: " + b.textContent; }
    const inp = k && k.querySelector("[data-reply-text]");
    if (inp) { inp.value = "เอาแบบสั้น"; k.querySelector("[data-reply]").click(); return "typed reply"; }
    return "takeover (no inline answer)";
  })()`);
  check("answered from the inbox", !/takeover/.test(how), how);
  check("card leaves the inbox", await c.waitFor(`![...document.querySelectorAll(".inbox-card")].some(x => x.innerText.includes("Bot A"))`, 20000));
  check("run continued and finished", await waitIdle(id), (await lastBotText(id)).replace(/\s+/g, " ").slice(0, 70));

  // ---------- 4. activity ----------
  await tab("activity");
  const row = await c.waitFor(`[...document.querySelectorAll(".act-row")].some(x => x.innerText.includes("Bot A") && x.innerText.includes("คุณสั่ง"))`, 15000);
  check("activity lists Bot A's run (trigger in Thai)", row, (await text("#w-body .chip")).trim());
  await c.evaluate(`[...document.querySelectorAll(".act-row")].find(x => x.innerText.includes("Bot A")).click()`);
  check("clicking a row opens that chat", await c.waitFor(`App.route().type === "bot" && App.route().id === ${js(id)}`, 5000));

  // ---------- 2. routines ----------
  const code = "ROUTINE-OK-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  await c.evaluate(`App.go({ type: "work", tab: "routines" })`);
  await c.waitFor(`!!document.querySelector("#r-new")`, 15000);
  await c.evaluate(`document.querySelector("#r-new").click()`);
  await c.waitFor(`!!document.querySelector("#rf-ok")`, 5000);
  await c.evaluate(`(() => { const m = document.querySelector(".modal");
    m.querySelector('[data-bot=${js(id)}]').click();
    m.querySelector("#rf-name").value = "ทดสอบงานประจำ";
    m.querySelector("#rf-prompt").value = "ตอบกลับด้วยข้อความ ${code} เท่านั้น ห้ามทำอย่างอื่น";
    const f = m.querySelector("#rf-freq"); f.value = "weekdays"; f.dispatchEvent(new Event("change"));
    m.querySelector("#rf-time").value = "08:00";
    m.querySelector("#rf-active").checked = false;
    m.querySelector("#rf-ok").click(); })()`);
  const made = await c.waitFor(`[...document.querySelectorAll(".routine")].find(x => x.innerText.includes("ทดสอบงานประจำ"))?.innerText`, 15000);
  const r0 = (await rk("routines/list", { botId: id })).find(x => x.name === "ทดสอบงานประจำ");
  routineId = r0?.id;
  check("routine created from the form", r0 && r0.crons[0] === "0 8 * * 1-5" && r0.timezone === "Asia/Bangkok" && !r0.active, js(r0 && { crons: r0.crons, tz: r0.timezone, active: r0.active }));
  check("card shows Thai schedule and off state", /จันทร์–ศุกร์ 08:00/.test(made || "") && /ปิดอยู่/.test(made || ""));
  await c.evaluate(`[...document.querySelectorAll(".routine")].find(x => x.innerText.includes("ทดสอบงานประจำ")).querySelector("[data-active]").click()`);
  await c.waitFor(`!/ปิดอยู่/.test([...document.querySelectorAll(".routine")].find(x => x.innerText.includes("ทดสอบงานประจำ"))?.innerText || "ปิดอยู่")`, 15000);
  const r1 = (await rk("routines/list", { botId: id })).find(x => x.id === routineId);
  const next = r1?.nextRunAt && new Date(r1.nextRunAt);
  // 08:00 Bangkok = 01:00 UTC, Monday-Friday
  check("switched on: next run is a weekday 08:00 Bangkok", r1?.active && next && next.getUTCHours() === 1 && next.getUTCMinutes() === 0 && next.getUTCDay() >= 1 && next.getUTCDay() <= 5, r1?.nextRunAt);
  await c.evaluate(`[...document.querySelectorAll(".routine")].find(x => x.innerText.includes("ทดสอบงานประจำ")).querySelector("[data-test]").click()`);
  let ran = false;
  for (const t = Date.now(); Date.now() - t < 180000 && !ran; await sleep(2000)) ran = (await lastBotText(id)).includes(code);
  check("รันเลย: the bot did the routine in its chat", ran, code);
  const recent = (await rk("runs/list", { filter: "recent" })).runs.find(r => r.botId === id && r.trigger === "routine");
  check("activity records it as a routine run", recent, recent?.status);
  await c.evaluate(`[...document.querySelectorAll(".routine")].find(x => x.innerText.includes("ทดสอบงานประจำ")).querySelector("[data-del]").click()`);
  await c.waitFor(`!!document.querySelector('.scrim [data-a="yes"]')`, 5000);
  await c.evaluate(`document.querySelector('.scrim [data-a="yes"]').click()`);
  await c.waitFor(`![...document.querySelectorAll(".routine")].some(x => x.innerText.includes("ทดสอบงานประจำ"))`, 15000);
  check("routine removed", !(await rk("routines/list", { botId: id })).some(x => x.id === routineId));
  if (!(await rk("routines/list", { botId: id })).some(x => x.id === routineId)) routineId = null;

  // ---------- 3. memory ----------
  memDoc = (await rk("memory/list", { botId: id })).find(d => d.path === "MEMORY.md");
  check("Bot A has a memory document", memDoc);
  const secret = "มะม่วง" + Math.floor(Math.random() * 90 + 10);
  await c.evaluate(`App.go({ type: "work", tab: "memory" })`);
  await c.waitFor(`[...document.querySelectorAll(".memory")].some(x => x.innerText.includes("Bot A"))`, 15000);
  await c.evaluate(`(() => { const k = [...document.querySelectorAll(".memory")].find(x => x.innerText.includes("Bot A"));
    k.querySelector("[data-add]").value = "รหัสลับทดสอบคือ ${secret}"; k.querySelector("[data-add-btn]").click(); })()`);
  const shown = await c.waitFor(`[...document.querySelectorAll(".memory")].find(x => x.innerText.includes("Bot A"))?.innerText.includes(${js(secret)})`, 15000);
  const doc1 = (await rk("memory/list", { botId: id })).find(d => d.id === memDoc?.id);
  check("taught in the UI: saved and shown", shown && doc1?.content.includes(secret), doc1?.content.replace(/\s+/g, " ").slice(0, 80));
  await rk("threads/send", { botId: id, text: "รหัสลับทดสอบคืออะไร ตอบแค่รหัส", clientNonce: "mem-" + Date.now() });
  await sleep(1500);
  await waitIdle(id);
  const reply = await lastBotText(id);
  check("the bot uses its memory", reply.includes(secret), reply.replace(/\s+/g, " ").slice(0, 60));
  await c.evaluate(`[...document.querySelectorAll(".memory")].find(x => x.innerText.includes("Bot A")).querySelector("[data-forget]").click()`);
  await c.waitFor(`!!document.querySelector('.scrim [data-a="yes"]')`, 5000);
  await c.evaluate(`document.querySelector('.scrim [data-a="yes"]').click()`);
  await c.waitFor(`/ยังไม่มีอะไรในความจำ/.test([...document.querySelectorAll(".memory")].find(x => x.innerText.includes("Bot A"))?.innerText || "")`, 15000);
  const doc2 = (await rk("memory/list", { botId: id })).find(d => d.id === memDoc?.id);
  check("ลืมทั้งหมด clears it", doc2 && !doc2.content.includes(secret), js(doc2?.content));
  const errors = await c.evaluate("window.__errors");
  check("no JS errors", !errors.length, JSON.stringify(errors));
  await c.screenshot("D:/tmp/work-test.png");
} finally {
  if (routineId) await rk("routines/remove", { routineId }).catch(() => {});
  if (memDoc) await rk("memory/update", { documentId: memDoc.id, content: memDoc.content }).catch(() => {});
  if (lease) { await rk("threads/stop", { botId: lease.bot.id }).catch(() => {}); await lease.done(); }
  await c.evaluate("App.chat.load()").catch(() => {});
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
