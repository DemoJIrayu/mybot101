// Round-4 features that need the model: waiting runs -> one batched notification + digest card (+ "always allow" asks
// first, cancel keeps the card), fact check by another bot (false claim -> ไม่ถูกต้อง), trigger in watch mode (bot reads,
// writes nothing), messy plan from speech (fake mic -> whisper) -> plan card -> approve -> routine, morning brief by CEO
// (read-only). Restores rules, Bot B's MCP access, the book, routines, triggers; Bot A/B archived again.
// usage: node round4-llm.mjs  (BotAdmin.exe --devtools-port 9223, llama-server healthy; ask ลุงจืด not to click the app)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { connect, borrowBot } from "./cdp.mjs";
const health = await fetch("http://127.0.0.1:8080/health").then(r => r.json()).catch(e => ({ error: e.message }));
if (health.status !== "ok") { console.log("LLM not ready:", JSON.stringify(health)); process.exit(2); }
const c = await connect();
const js = s => JSON.stringify(s);
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${typeof info === "string" ? info : js(info)}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await sleep(1000); } return null; };
const click = sel => c.evaluate(`document.querySelector(${js(sel)}).click()`);
const text = sel => c.evaluate(`document.querySelector(${js(sel)})?.innerText || ""`);
const tap = async sel => { const r = await c.evaluate(`(() => { const b = document.querySelector(${js(sel)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 }); };
const wsl = cmd => execFileSync("wsl", ["-d", "Ubuntu-24.04", "--", "bash", "-lc", cmd], { encoding: "utf8" }).trim();
const acct = (tool, args = {}) => JSON.parse(execFileSync("wsl", ["-d", "Ubuntu-24.04", "--", "bash", "/mnt/d/localai/botadmin/tests/acct-call.sh", tool, js(args)], { encoding: "utf8" }));
const bookLast = async () => (await c.evaluate(`App.call("acct.events", { after: 0 })`)).last;
const stop = id => rk("threads/stop", { botId: id }).catch(() => {});
const waiting = async ids => (await rk("runs/list", { filter: "active" })).runs.filter(r => ids.includes(r.botId) && /^waiting_/.test(r.status));
const idle = async id => { const s = await rk("threads/get", { botId: id }); return ![s.run, ...(s.activeRuns || [])].some(r => r && !/^(completed|failed|cancelled)$/.test(r.status)); };
const same = (a, b) => a.matchKind === b.matchKind && a.matchValue === b.matchValue && a.effect === b.effect;
const MESSY = "เอ่อ พรุ่งนี้ให้ฝ่ายขายโทรตามลูกค้าที่ค้างชำระนะ แล้วก็ ทุกเช้าวันจันทร์ถึงศุกร์แปดโมงครึ่ง ให้ฝ่ายบัญชีสรุปยอดขายเมื่อวานส่งผม";
let A, B, rulesBefore, acctBefore, trigBefore, bookSaved = false, routineIds = [];
try {
  await c.waitFor(`App.chat.state.ready`, 60000);
  await c.evaluate("window.__errors.length = 0");
  A = await borrowBot(rk, "Bot A"); B = await borrowBot(rk, "Bot B");
  const a = A.bot.id, b = B.bot.id;
  for (const id of [a, b]) { await stop(id); await rk("threads/clear", { botId: id }); }
  await c.evaluate("App.chat.load()");
  rulesBefore = await rk("approvalRules/list");
  wsl("cp -p ~/rakazo/demo-acct/data.json /tmp/r4-book.json"); bookSaved = true;

  // ---------- host op ----------
  const ok = await c.evaluate(`App.call("llm.ask", { system: "ตอบสั้นที่สุด", prompt: "พิมพ์คำว่า OK คำเดียว", maxTokens: 20 })`);
  check("llm.ask reaches the local model", /OK/i.test(ok.text), ok.text);

  // ---------- 2 waiting runs -> one notification + digest; "always" asks first ----------
  await rk("approvalRules/set", { effect: "require_approval", matchKind: "tool", matchValue: "scratchpad_add" });
  const n0 = await c.evaluate("App.work.notified.length");
  for (const [id, name] of [[a, "A"], [b, "B"]]) await rk("threads/send", { botId: id, text: `ใช้เครื่องมือ scratchpad_add เพิ่มรายการ "ทดสอบ r4 จาก ${name}" ตอนนี้เลย` });
  const t0 = Date.now(), pausedAt = {};
  const both = await until(async () => { for (const r of await waiting([a, b])) pausedAt[r.botName] ??= Math.round((Date.now() - t0) / 1000); return Object.keys(pausedAt).length === 2; }, 240000);
  check("both bots wait for approval", both, pausedAt);
  await sleep(25000); // poll (5 s) + hold window
  const notes = (await c.evaluate(`App.work.notified.slice(${n0})`)).map(n => ({ s: Math.round((n.at - t0) / 1000), count: n.count }));
  check("one batched notification for both (pauses within the 12 s window)", notes.length === 1 && notes[0].count === 2, { pausedAt, notes });
  await c.evaluate(`App.go({ type: "work", tab: "inbox" })`);
  const dg = await until(async () => await c.evaluate(`document.querySelectorAll(".digest .dg-row").length === 2 && !document.querySelector(".digest .spin")`) && await text(".digest"), 240000);
  check("digest card summarises the 2 items with a recommendation", dg && !/ไม่สำเร็จ/.test(dg), dg ? dg.replace(/\s+/g, " ").slice(0, 160) : "");
  check("inbox cards + digest in Thai (no Rakazo 'Review before')", !/Review before/.test(await text("#w-body")), (await text(".inbox .inbox-text")).slice(0, 80));
  await click(`.inbox [data-answer="always"]`);
  const last = `[...document.querySelectorAll(".modal")].at(-1)`;
  check("อนุญาตเสมอ on a real card asks first", await until(() => c.evaluate(`/อนุญาตเสมอ\\?/.test(${last}?.innerText || "")`), 5000));
  await c.evaluate(`${last}.querySelector('[data-a="no"]').click()`);
  await sleep(2000);
  check("cancel keeps both waiting, no always-allow rule", (await waiting([a, b])).length === 2 && !(await rk("approvalRules/list")).some(r => r.matchValue === "scratchpad_add" && r.effect === "always_allow"));
  const all = await c.evaluate(`!!document.querySelector("[data-dg-all]")`);
  if (all) {
    await click("[data-dg-all]");
    await until(() => c.evaluate(`/ทำตามคำแนะนำ/.test(${last}?.innerText || "")`), 5000);
    await c.evaluate(`${last}.querySelector('[data-a="yes"]').click()`);
  } else for (const id of [a, b]) await c.evaluate(`document.querySelector('.inbox [data-answer="deny"]')?.click()`).then(() => sleep(1500));
  check(`answered from the inbox (${all ? "ทำตามคำแนะนำ" : "ปฏิเสธทีละการ์ด"})`, await until(async () => (await waiting([a, b])).length === 0, 60000));
  // clean slate: a stopped bot resumes its unfinished scratchpad task on the next message and would wait on the rule again
  for (const id of [a, b]) { await stop(id); await rk("threads/clear", { botId: id }); }
  for (const r of (await rk("approvalRules/list")).filter(r => r.matchValue === "scratchpad_add" && !rulesBefore.some(x => same(x, r)))) await rk("approvalRules/remove", { id: r.id });

  // ---------- fact check by another bot ----------
  const acctServer = (await rk("mcp/servers/list")).find(s => s.slug === "demo-accounting");
  acctBefore = (await rk("mcp/assignments/all")).filter(l => l.botId === b).map(l => ({ serverId: l.serverId, allowAllTools: l.allowAllTools, allowedTools: l.allowedTools }));
  await rk("mcp/assignments/approve", { botId: b, serverId: acctServer.id });
  const claim = "ตอนนี้บริษัทไม่มีลูกหนี้ค้างชำระเลย ยอดลูกหนี้คงค้างรวมเป็น 0 บาท";
  const verdict = await c.evaluate(`App.assistant.verify({ msgId: "r4-ver", text: ${js(claim)}, botName: "Bot A", at: Date.now(), verifierId: ${js(b)} })`);
  check("false claim -> ไม่ถูกต้อง (checked against the book)", verdict === "ไม่ถูกต้อง", verdict);
  const ver = await c.evaluate(`JSON.parse(localStorage.getItem("bt.verify"))["r4-ver"]`);
  check("evidence stored + badge", ver?.state === "done" && ver.text.length > 20 && /vbadge bad/.test(await c.evaluate(`App.assistant.verifyBadge("r4-ver")`)), ver?.text.replace(/\s+/g, " ").slice(0, 120));

  // ---------- trigger in watch mode ----------
  trigBefore = await c.evaluate(`localStorage.getItem("bt.triggers")`);
  await c.evaluate(`localStorage.setItem("bt.triggers", ${js(js([{ id: "r4-inv", event: "invoice", botId: b, note: "ตรวจว่าใบแจ้งหนี้ถูกต้อง (ราคา VAT ยอดรวม) แล้วรายงานสั้นๆ", on: true }]))})`);
  await until(() => c.evaluate("App.assistant.tick()"), 30000);
  const inv = acct("create_invoice", { customer_code: "C-002", lines: [{ sku: "P-002", qty: 2 }], idempotency_key: "r4-llm-" + Date.now() });
  const after = await bookLast();
  const sent = await until(async () => { await c.evaluate("App.assistant.tick()"); return js((await rk("threads/get", { botId: b })).messages).includes(inv.no); }, 30000);
  check("invoice event reaches Bot B", sent, inv.no);
  await sleep(3000);
  const done = await until(() => idle(b), 600000);
  const reply = (await rk("threads/get", { botId: b })).messages.filter(m => m.role === "bot").flatMap(m => m.blocks).filter(x => x.kind === "text").map(x => x.text).at(-1) || "";
  check("Bot B reports on the event", done && reply.length > 20, reply.replace(/\s+/g, " ").slice(0, 140));
  check("watch mode: the bot wrote nothing to the book", (await bookLast()) === after);
  await stop(b);

  // ---------- messy plan from speech -> plan card -> approve ----------
  await c.evaluate(`App.go({ type: "work", tab: "team" })`);
  await c.waitFor(`!!document.querySelector("#tm-mic")`, 15000);
  const wav = fs.readFileSync("D:/localai/thai-tts-test.wav").toString("base64");
  await c.evaluate(`window.__wav = ${js(wav)}; navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext(); await ctx.resume();
    const buf = await ctx.decodeAudioData(Uint8Array.from(atob(window.__wav), ch => ch.charCodeAt(0)).buffer);
    const src = ctx.createBufferSource(), dst = ctx.createMediaStreamDestination(); src.buffer = buf; src.connect(dst); src.start();
    window.__micDone = new Promise(r => src.onended = r); return dst.stream; }`);
  await tap("#tm-mic");
  await c.waitFor(`window.__micDone && document.querySelector("#tm-mic").classList.contains("rec")`, 10000);
  await c.evaluate("window.__micDone"); await sleep(500);
  await tap("#tm-mic");
  const heard = await until(async () => { const v = await c.evaluate(`document.querySelector("#tm-goal").value`); return /[\u0E00-\u0E7F]/.test(v) && v; }, 120000);
  check("team mic: speech -> text in the plan box", heard, heard || "");
  const plan = await c.evaluate(`App.assistant.makePlan(${js(MESSY)})`);
  const id = name => c.evaluate(`App.chat.state.bots.find(b => b.name === ${js(name)})?.id`);
  const [acc, sales] = [await id("ฝ่ายบัญชี"), await id("ฝ่ายขาย")];
  check("messy speech -> 2+ tasks: repeat for ฝ่ายบัญชี, one-off for ฝ่ายขาย", plan.tasks.length >= 2 && plan.tasks.some(t => t.botId === acc && t.repeat !== "none") && plan.tasks.some(t => t.botId === sales && t.repeat === "none"),
    plan.tasks.map(t => `${t.repeat}@${t.time || "-"}:${t.title.slice(0, 30)}`).join(" | "));
  await c.evaluate(`document.querySelector("#tm-goal").value = ${js(MESSY)}`);
  await click("#tm-plan");
  check("plan card opens with editable rows", await until(() => c.evaluate(`document.querySelectorAll(".modal .plan-row").length >= 2`), 240000));
  // approve only one row, pointed at Bot A, so no real department gets work
  await c.evaluate(`(() => { const rows = document.querySelectorAll(".modal .plan-row"); rows.forEach((r, i) => r.querySelector('[data-k="on"]').checked = i === 0);
    const r = rows[0], set = (k, v) => { const e = r.querySelector('[data-k="' + k + '"]'); e.value = v; e.dispatchEvent(new Event("change")); };
    set("title", "ทดสอบ r4 แผนจากเสียง"); set("bot", ${js(a)}); set("repeat", "daily"); set("time", "07:15"); })()`);
  await click("#pl-ok");
  const rt = await until(async () => (await rk("routines/list", { botId: a })).find(x => x.name === "ทดสอบ r4 แผนจากเสียง"), 20000);
  if (rt) routineIds.push(rt.id);
  check("อนุมัติแผน -> routine on the chosen bot", rt && js(rt.crons) === js(["15 7 * * *"]), rt?.crons);

  // ---------- morning brief (CEO, read-only) ----------
  const before = await bookLast();
  const brief = await c.evaluate(`App.assistant.makeBrief()`);
  const stored = await c.evaluate(`JSON.parse(localStorage.getItem("bt.brief") || "{}").last?.text`);
  check("CEO writes the brief, stored for the สรุปเช้า tab", brief.length > 50 && stored === brief, brief.replace(/\s+/g, " ").slice(0, 160));
  check("brief uses the sections (📊 ⚡ 👥 ✅)", ["📊", "⚡", "👥", "✅"].filter(e => brief.includes(e)).length >= 3);
  check("brief changed nothing in the book", (await bookLast()) === before);

  check("no JS errors", (await c.evaluate("window.__errors")).length === 0, await c.evaluate("window.__errors"));
} catch (e) {
  check("run", false, e.stack || e.message);
} finally {
  try {
    for (const l of [A, B]) if (l) await stop(l.bot.id);
    if (bookSaved) wsl("docker stop rakazo-demo-accounting-1 >/dev/null && cp -p /tmp/r4-book.json ~/rakazo/demo-acct/data.json && docker start rakazo-demo-accounting-1 >/dev/null && rm /tmp/r4-book.json");
    if (trigBefore !== undefined) await c.evaluate(trigBefore === null ? `localStorage.removeItem("bt.triggers")` : `localStorage.setItem("bt.triggers", ${js(trigBefore)})`);
    await c.evaluate(`(() => { const v = JSON.parse(localStorage.getItem("bt.verify") || "{}"); delete v["r4-ver"]; localStorage.setItem("bt.verify", JSON.stringify(v)); })()`);
    if (rulesBefore) {
      const now = await rk("approvalRules/list");
      for (const r of now) if (!rulesBefore.some(x => same(x, r))) await rk("approvalRules/remove", { id: r.id });
      for (const x of rulesBefore) if (!now.some(r => same(x, r))) await rk("approvalRules/set", { effect: x.effect, matchKind: x.matchKind, matchValue: x.matchValue });
    }
    if (B && acctBefore) await rk("mcp/assignments/replace", { botId: B.bot.id, assignments: acctBefore });
    for (const routineId of routineIds) await rk("routines/remove", { routineId }).catch(() => {});
    for (const l of [A, B]) if (l) { await rk("threads/clear", { botId: l.bot.id }).catch(() => {}); await l.done(); }
    await c.evaluate("App.chat.load().then(() => App.go({ type: 'home' }))");
  } catch (e) { console.log("RESTORE FAILED", e.message); }
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
