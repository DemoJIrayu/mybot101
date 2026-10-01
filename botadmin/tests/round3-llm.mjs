// Round-3 features end to end with the real model: company knowledge reaches a bot, an attached file is read, the demo
// accounting system answers through MCP, an approval rule pauses an invoice until you click allow, a bot hands work to
// another bot (hand-off arrow on the mission-control wall + team tab), and the voice loop (mic -> whisper -> send ->
// reply read aloud). Borrows Bot A/B; restores rules, company knowledge and MCP assignments.
// usage: node round3-llm.mjs  (BotAdmin.exe --devtools-port 9223; LLM up; ask ลุงจืด not to click the app meanwhile)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { connect, borrowBot } from "./cdp.mjs";
const c = await connect();
const js = s => JSON.stringify(s);
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${typeof info === "string" ? info : js(info)}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000, every = 1000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await sleep(every); } return null; };
const rand = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const textOf = m => m.blocks.filter(b => b.kind === "text").map(b => b.text).join("\n");
const busy = async botId => (await rk("runs/list", { filter: "active" })).runs.some(r => r.botId === botId);
// the demo accounting book, read the way the bots do (worker loopback); the token never leaves WSL
const acct = (tool, args = {}) => JSON.parse(execFileSync("wsl", ["-d", "Ubuntu-24.04", "--", "bash", "/mnt/d/localai/botadmin/tests/acct-call.sh", tool, js(args)], { encoding: "utf8" }));
async function send(botId, text) {
  const before = (await rk("threads/get", { botId })).messages.length;
  await rk("threads/send", { botId, text });
  return before;
}
// wait until the bot has no active run, then return what it wrote after `before`
async function reply(botId, before, ms = 300000) {
  await sleep(3000);
  const done = await until(async () => !(await busy(botId)) && (await rk("threads/get", { botId })).messages.slice(before), ms, 2000);
  return done ? done.filter(m => m.role !== "user").map(textOf).join("\n") : "";
}
let A, B, rulesBefore, brainDoc, acctBefore;
try {
  await c.waitFor(`App.chat.state.ready`, 60000);
  console.log("LLM mode", js(await c.evaluate(`App.call("llm.mode")`)));
  A = await borrowBot(rk, "Bot A"); B = await borrowBot(rk, "Bot B");
  const a = A.bot.id, b = B.bot.id;
  for (const id of [a, b]) { await rk("threads/clear", { botId: id }); await rk("computer/boot", { botId: id }).catch(() => {}); }
  await c.evaluate("App.chat.load()");
  rulesBefore = await rk("approvalRules/list");
  brainDoc = (await rk("memory/list", {})).find(d => !d.botId && d.path === "MEMORY.md");

  // ---------- 1. company knowledge reaches every bot ----------
  const promo = "FARM-" + rand();
  await rk("memory/update", { documentId: brainDoc.id, content: brainDoc.content.replace(/\s*$/, "\n\n") + `## โปรโมชั่น\nรหัสโปรโมชั่นเดือนนี้: ${promo}\n` });
  let t = await send(a, "รหัสโปรโมชั่นเดือนนี้ของบริษัทคืออะไร ตอบแค่รหัส ไม่ต้องใช้เครื่องมือ");
  let r = await reply(a, t);
  check("a bot answers from the company knowledge", r.includes(promo), r.slice(0, 120));
  await rk("memory/update", { documentId: brainDoc.id, content: brainDoc.content });

  // ---------- 2. attached file is read by the bot ----------
  const code = "DOC-" + rand();
  await c.evaluate(`App.go({ type: "bot", id: ${js(a)} })`);
  await c.waitFor(`!!document.querySelector("#c-attach")`, 15000);
  t = (await rk("threads/get", { botId: a })).messages.length;
  await c.evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File(["รายงานสาธิต\\nรหัสเอกสาร: ${code}\\n"], "report.txt", { type: "text/plain" }));
    const i = document.querySelector("#c-file"); i.files = dt.files; i.dispatchEvent(new Event("change"));
    const box = document.querySelector("#c-input"); box.value = "อ่านไฟล์ report.txt ที่แนบมา แล้วบอกรหัสเอกสาร ตอบแค่รหัส"; box.dispatchEvent(new Event("input"));
    document.querySelector("#c-send").click(); })()`);
  const sent = await until(async () => (await rk("threads/get", { botId: a })).messages.slice(t).find(m => m.role === "user" && m.blocks.some(x => x.kind === "file" && x.artifactId)), 30000);
  check("the message carries the file (artifact)", sent, sent && sent.blocks.map(x => x.kind).join(","));
  r = await reply(a, t);
  check("the bot reads the attached file", r.includes(code), r.slice(0, 120));

  // ---------- 3. demo accounting through MCP ----------
  const acctServer = (await rk("mcp/servers/list")).find(s => s.slug === "demo-accounting");
  acctBefore = (await rk("mcp/assignments/all")).filter(l => l.botId === a).map(l => ({ serverId: l.serverId, allowAllTools: l.allowAllTools, allowedTools: l.allowedTools }));
  await rk("mcp/assignments/approve", { botId: a, serverId: acctServer.id });
  const aging = acct("get_ar_aging");
  t = await send(a, "ใช้เครื่องมือ mcp__demo-accounting__get_ar_aging ของระบบบัญชีสาธิต แล้วบอกยอดลูกหนี้ค้างชำระรวมทั้งหมด เป็นตัวเลขบาท");
  r = await reply(a, t);
  check("the bot reads receivables from the accounting system", r.replace(/,/g, "").includes(aging.total.replace(/\.?0+$/, "")), `expected ${aging.total} · ${r.slice(0, 120)}`);

  // ---------- 4. approval rule pauses a write until you allow it ----------
  await c.evaluate(`App.go({ type: "work", tab: "rules" })`);
  await c.waitFor(`!!document.querySelector('.rule-seg[data-v="mcp__demo-accounting__create_invoice"]')`, 15000);
  await c.evaluate(`document.querySelector('.rule-seg[data-v="mcp__demo-accounting__create_invoice"] button[data-e="require_approval"]').click()`);
  await until(async () => (await rk("approvalRules/list")).some(x => x.matchValue === "mcp__demo-accounting__create_invoice"), 15000);
  const invBefore = acct("list_invoices").length, key = "t-" + rand();
  await c.evaluate(`App.go({ type: "bot", id: ${js(a)} })`);
  t = await send(a, `ใช้เครื่องมือ mcp__demo-accounting__create_invoice ออกใบแจ้งหนี้ให้ลูกค้า C-004 สินค้า P-005 จำนวน 2 ใช้ idempotency_key "${key}" แล้วบอกเลขที่ใบแจ้งหนี้`);
  const card = await c.waitFor(`(() => { const b = document.querySelector('.approval [data-answer="allow"]'); return b && b.closest(".approval").textContent.slice(0, 160); })()`, 300000);
  check("the invoice pauses on an approval card in the chat", card, card);
  check("nothing was written before approval", acct("list_invoices").length === invBefore);
  if (card) await c.evaluate(`document.querySelector('.approval [data-answer="allow"]').click()`);
  r = await reply(a, t);
  const inv = acct("list_invoices");
  check("after allow the invoice is created (once)", inv.length === invBefore + 1 && /C-004|หน้าร้าน/.test(JSON.stringify(inv[inv.length - 1])), `${invBefore} -> ${inv.length} · ${r.slice(0, 100)}`);
  check("trial balance still balances", acct("get_trial_balance").balanced === true);

  // ---------- 5. hand-off between bots (+ arrow on the wall, row on the team tab) ----------
  await c.evaluate(`App.go({ type: "live" })`);
  await c.waitFor(`!!document.querySelector("#lv-sum .chip")`, 20000);
  const word = "รับทราบ-" + rand();
  t = await send(a, `ใช้เครื่องมือ message_bot ส่งงานถึงบอทชื่อ "Bot B" (intent=request) ให้ Bot B ตอบกลับด้วยคำว่า ${word} เท่านั้น`);
  const arrow = await c.waitFor(`App.live && App.live.links().some(l => l.from === ${js(a)} && l.to === ${js(b)})`, 300000);
  check("mission control draws the hand-off arrow while Bot B works", arrow, await c.evaluate(`document.querySelectorAll(".live-links path").length + " arrow(s)"`));
  await reply(a, t);
  const got = await until(async () => (await rk("threads/get", { botId: b })).messages.find(m => m.blocks.some(x => x.kind === "bot_message_received" && x.fromBotId === a)), 120000);
  check("Bot B received the work from Bot A", got, got && got.blocks.find(x => x.kind === "bot_message_received").text.slice(0, 80));
  await until(async () => !(await busy(b)), 300000, 2000);
  await c.evaluate(`App.go({ type: "work", tab: "team" })`);
  check("team tab lists the hand-off", await c.waitFor(`[...document.querySelectorAll(".hand")].some(x => x.dataset.to === ${js(b)})`, 20000));
  await c.evaluate(`App.go({ type: "bot", id: ${js(b)} })`);
  check("the chat shows it as a message from Bot A", await c.waitFor(`[...document.querySelectorAll(".msg.bot .bubble")].some(x => /จาก Bot A/.test(x.textContent))`, 20000));

  // ---------- 6. voice loop: mic -> whisper -> send -> reply read aloud ----------
  await c.evaluate(`App.go({ type: "bot", id: ${js(a)} })`);
  await c.waitFor(`!!document.querySelector("#c-mic")`, 15000);
  const wav = fs.readFileSync("D:/localai/thai-tts-test.wav").toString("base64");
  await c.evaluate(`window.__wav = ${js(wav)}; navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext(); await ctx.resume();
    const buf = await ctx.decodeAudioData(Uint8Array.from(atob(window.__wav), ch => ch.charCodeAt(0)).buffer);
    const src = ctx.createBufferSource(), dst = ctx.createMediaStreamDestination(); src.buffer = buf; src.connect(dst); src.start();
    window.__micDone = new Promise(r => src.onended = r); return dst.stream; }`);
  const box = await c.evaluate(`(() => { const r = document.querySelector("#c-mic").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const tap = async () => { for (const type of ["mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 }); };
  t = (await rk("threads/get", { botId: a })).messages.length;
  await c.evaluate("App.voice.last = ''");
  await tap();
  await c.waitFor(`window.__micDone && document.querySelector("#c-mic").classList.contains("rec")`, 10000);
  await c.evaluate("window.__micDone");
  await sleep(500);
  await tap();
  const said = await until(async () => (await rk("threads/get", { botId: a })).messages.slice(t).find(m => m.role === "user" && /สวัสดี/.test(textOf(m))), 120000);
  check("spoken Thai is transcribed and sent", said, said && textOf(said));
  r = await reply(a, t);
  const spoke = await c.waitFor(`App.voice.last`, 30000);
  check("the reply to a spoken message is read aloud", spoke && r && spoke.slice(0, 10) && r.replace(/[*_#>`|~[\]()\s]/g, "").includes(spoke.replace(/\s/g, "").slice(0, 10)), (spoke || "").slice(0, 80));

  const errors = await c.evaluate("window.__errors");
  check("no JS errors", !errors.length, errors);
} finally {
  try {
    if (rulesBefore) {
      const now = await rk("approvalRules/list"), same = (x, y) => x.matchKind === y.matchKind && x.matchValue === y.matchValue && x.effect === y.effect;
      for (const x of now) if (!rulesBefore.some(y => same(x, y))) await rk("approvalRules/remove", { id: x.id });
      for (const y of rulesBefore) if (!now.some(x => same(x, y))) await rk("approvalRules/set", { effect: y.effect, matchKind: y.matchKind, matchValue: y.matchValue });
    }
    if (brainDoc) await rk("memory/update", { documentId: brainDoc.id, content: brainDoc.content });
    if (A && acctBefore) await rk("mcp/assignments/replace", { botId: A.bot.id, assignments: acctBefore });
    if (A) await A.done();
    if (B) await B.done();
    await c.evaluate("App.chat.load().then(() => App.go({ type: 'home' }))");
  } catch (e) { console.log("RESTORE FAILED", e.message); }
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
