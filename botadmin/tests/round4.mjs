// Round-4 company features without the LLM: new tabs (สรุปเช้า/ทริกเกอร์/ตัวตนบอท), persona studio (editor -> bots/update,
// avatar emoji, voice, PNG card), event triggers (accounting book event + inbox file -> watch-mode message), correction ->
// rule suggestion (synthetic + real chat path), "always allow" confirm, plan approval (routine + hand-out message), digest
// fallback when the model is busy. Restores the book, rules, triggers, Bot A/B and their persona.
// usage: node round4.mjs  (BotAdmin.exe --devtools-port 9223 running; ask ลุงจืด not to click the app meanwhile)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { connect, borrowBot } from "./cdp.mjs";
const c = await connect();
const js = s => JSON.stringify(s);
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${typeof info === "string" ? info : js(info)}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await sleep(500); } return null; };
const click = sel => c.evaluate(`document.querySelector(${js(sel)}).click()`);
const tab = async t => { await c.evaluate(`document.querySelector('#w-tabs [data-tab="${t}"]').click()`); await c.waitFor(`!document.querySelector("#w-body .skeleton")`, 20000); };
const text = sel => c.evaluate(`document.querySelector(${js(sel)})?.innerText || ""`);
const wsl = cmd => execFileSync("wsl", ["-d", "Ubuntu-24.04", "--", "bash", "-lc", cmd], { encoding: "utf8" }).trim();
const acct = (tool, args = {}) => JSON.parse(execFileSync("wsl", ["-d", "Ubuntu-24.04", "--", "bash", "/mnt/d/localai/botadmin/tests/acct-call.sh", tool, js(args)], { encoding: "utf8" }));
const threadText = async id => js((await rk("threads/get", { botId: id })).messages);
const stop = id => rk("threads/stop", { botId: id }).catch(() => {});
const same = (a, b) => a.matchKind === b.matchKind && a.matchValue === b.matchValue && a.effect === b.effect;
const INBOX = "D:/localai/inbox/r4-test.txt";
let A, B, origA, rulesBefore, trigBefore, bookSaved = false, routineIds = [];
try {
  await c.waitFor(`App.chat.state.ready`, 60000);
  await c.evaluate("window.__errors.length = 0");
  A = await borrowBot(rk, "Bot A"); B = await borrowBot(rk, "Bot B");
  const a = A.bot.id, b = B.bot.id;
  for (const id of [a, b]) { await stop(id); await rk("threads/clear", { botId: id }); }
  await c.evaluate("App.chat.load()");
  origA = (await rk("bots/list")).find(x => x.id === a);
  rulesBefore = await rk("approvalRules/list");

  // ---------- tabs ----------
  await c.evaluate(`App.go({ type: "work", tab: "inbox" })`);
  const tabs = await c.evaluate(`[...document.querySelectorAll("#w-tabs button")].map(b => b.dataset.tab)`);
  check("work center has brief/triggers/persona tabs", ["brief", "triggers", "persona"].every(t => tabs.includes(t)), tabs.join(","));
  await tab("brief"); check("brief tab renders (toggle + สรุปตอนนี้)", /สรุปตอนนี้/.test(await text("#w-body")) && await c.evaluate(`!!document.querySelector("#bf-on")`));
  await tab("triggers"); check("triggers tab renders presets + inbox folder button", /เปิดโฟลเดอร์ inbox/.test(await text("#w-body")) && await c.evaluate(`document.querySelectorAll("[data-preset]").length === 4`));

  // ---------- persona studio (real editor clicks) ----------
  await tab("persona");
  await click(`[data-edit="${a}"]`);
  await c.waitFor(`!!document.querySelector("#ps-ok")`, 5000);
  check("persona editor opens for Bot A", /ตัวตนของ Bot A/.test(await text(".modal")));
  await click(`.modal [data-e="🦊"]`); await click(`.modal [data-c="2"]`);
  await c.evaluate(`(() => { const m = document.querySelector(".modal"); m.querySelector("#ps-title").value = "ผู้ช่วยทดสอบ"; m.querySelector("#ps-mood").value = "พูดสุภาพ ตอบสั้น";
    m.querySelector("#ps-pitch").value = "1.25"; m.querySelector("#ps-rate").value = "0.85"; })()`);
  check("editor preview shows the chosen emoji", await c.evaluate(`document.querySelector("#ps-av .av-emoji")?.textContent === "🦊"`));
  await click("#ps-ok");
  const saved = await until(async () => { const x = (await rk("bots/list")).find(y => y.id === a); return x.title === "🦊 ผู้ช่วยทดสอบ" && x; });
  check("save -> bots/update: emoji title", saved, saved?.title);
  check("save -> colour changed to a palette colour", saved && saved.color !== origA.color && /^#[0-9a-f]{6}$/i.test(saved.color), saved?.color);
  check("save -> personality block in instructions, original kept", saved && saved.instructions.includes("## บุคลิก (ตั้งจากสตูดิโอตัวตน)\nพูดสุภาพ ตอบสั้น\n## จบบุคลิก") && saved.instructions.startsWith(origA.instructions.trimEnd()));
  check("save -> voice stored", js(await c.evaluate(`App.persona.voiceOf(${js(a)})`)) === js({ pitch: 1.25, rate: 0.85 }));
  await c.evaluate(`App.assistant.savePersona(App.work.botOf(${js(a)}), { name: "Bot A", emoji: "🦊", color: 2, title: "ผู้ช่วยทดสอบ", mood: "ร่าเริง", pitch: 1.25, rate: 0.85 })`);
  const again = (await rk("bots/list")).find(y => y.id === a).instructions;
  check("re-save replaces the block (no duplicate)", again.split("## บุคลิก").length === 2 && again.includes("ร่าเริง") && !again.includes("พูดสุภาพ ตอบสั้น"));
  check("avatar shows emoji everywhere (App.persona + persona tab)", await c.evaluate(`App.persona.emojiOf("Bot A") === "🦊"`) && await until(() => c.evaluate(`[...document.querySelectorAll("#w-body .av-emoji")].some(x => x.textContent === "🦊")`), 8000));
  const png = await c.evaluate(`App.assistant.cardPng(App.work.botOf(${js(a)}))`);
  check("shareable card is a PNG data URL", png.startsWith("data:image/png;base64,") && png.length > 30000, png.length + " chars");

  // ---------- event triggers ----------
  wsl("cp -p ~/rakazo/demo-acct/data.json /tmp/r4-book.json"); bookSaved = true;
  trigBefore = await c.evaluate(`localStorage.getItem("bt.triggers")`);
  if (fs.existsSync(INBOX)) fs.unlinkSync(INBOX);
  await c.evaluate(`localStorage.setItem("bt.triggers", ${js(js([{ id: "r4-inv", event: "invoice", botId: a, note: "ทดสอบ r4 ใบแจ้งหนี้", on: true }, { id: "r4-file", event: "file", botId: a, note: "ทดสอบ r4 ไฟล์", on: true }]))})`);
  check("first look runs (starts from now)", await until(() => c.evaluate("App.assistant.tick()"), 30000)); // false = another tick was busy
  check("no replay of old book entries / old files", !/เหตุการณ์อัตโนมัติ/.test(await threadText(a)));
  const inv = acct("create_invoice", { customer_code: "C-001", lines: [{ sku: "P-001", qty: 1 }], idempotency_key: "r4-trigger-" + Date.now() });
  const got = await until(async () => { await c.evaluate("App.assistant.tick()"); const t = await threadText(a); return /เหตุการณ์อัตโนมัติ: 🧾 มีใบแจ้งหนี้ใหม่/.test(t) && t; }, 30000);
  check("new invoice in the book -> Bot A gets a watch-mode message", got && got.includes("โหมดเฝ้าดู") && got.includes("ทดสอบ r4 ใบแจ้งหนี้"), inv.no || "");
  check("event carries the invoice number and baht amount", got && (!inv.no || got.includes(inv.no)) && /ยอด [\d,]+\.\d\d บาท/.test(got));
  fs.writeFileSync(INBOX, "ใบเสนอราคาทดสอบ r4: กระดาษ A4 10 รีม");
  const gotFile = await until(async () => { await c.evaluate("App.assistant.tick()");
    return (await rk("threads/get", { botId: a })).messages.find(m => js(m).includes("เหตุการณ์อัตโนมัติ: 📥") && js(m).includes("r4-test.txt")); }, 30000);
  check("file dropped in inbox -> Bot A gets it as an attachment", gotFile?.blocks.some(x => x.kind === "file" && x.artifactId));
  const log = await c.evaluate(`JSON.parse(localStorage.getItem("bt.triggerLog") || "[]").slice(0, 2)`);
  check("trigger log has both fires, ok", log.length === 2 && log.every(x => x.ok), log.map(x => x.event + ":" + x.ok).join(","));
  await tab("triggers");
  check("triggers tab lists the 2 triggers + log", await c.evaluate(`document.querySelectorAll("[data-test]").length === 2`) && /ทดสอบ r4 ไฟล์/.test(await text("#w-body")));
  await click(`[data-test="0"]`);
  check("ทดสอบ button sends a (ทดสอบ) event", await until(async () => /เหตุการณ์อัตโนมัติ \(ทดสอบ\)/.test(await threadText(a)), 15000));
  await stop(a);

  // ---------- corrections -> rule ----------
  const WF = "write_file";
  for (const r of rulesBefore.filter(r => r.matchValue === WF)) await rk("approvalRules/remove", { id: r.id }); // clean slate for this rule
  await c.evaluate(`(() => { const d = document.createElement("div"); d.id = "r4bar"; d.hidden = true; document.body.append(d); })()`);
  const fake = js([{ author: "Bot A", tools: [{ label: "Write file" }] }]);
  check("non-correction text -> no suggestion", await c.evaluate(`App.assistant.correction("ช่วยสรุปยอดขายเดือนนี้", ${fake}, document.querySelector("#r4bar"))`) === null);
  check("correction after a Write file step -> suggests write_file", await c.evaluate(`App.assistant.correction("คราวหน้าทำแบบนี้ให้ขออนุญาตก่อนนะ", ${fake}, document.querySelector("#r4bar"))`) === WF
    && await c.evaluate(`!document.querySelector("#r4bar").hidden`) && /เขียนไฟล์/.test(await text("#r4bar")));
  await click(`#r4bar [data-sg="yes"]`);
  check("ตั้งกฎ -> require_approval rule created", await until(async () => (await rk("approvalRules/list")).some(r => r.matchValue === WF && r.effect === "require_approval")));
  check("same correction again -> no duplicate suggestion", await c.evaluate(`App.assistant.correction("คราวหน้าทำแบบนี้ให้ขออนุญาตก่อนนะ", ${fake}, document.querySelector("#r4bar"))`) === null);
  await c.evaluate(`document.querySelector("#r4bar").remove()`);
  const hadEmail = (await rk("approvalRules/list")).some(r => r.matchValue === "email" && r.effect === "require_approval");
  await c.evaluate(`App.go({ type: "bot", id: ${js(a)} })`);
  await c.waitFor(`!!document.querySelector("#c-input")`, 10000);
  await c.evaluate(`(() => { const i = document.querySelector("#c-input"); i.value = "ต่อไปถ้าจะส่งอีเมลให้ถามก่อนนะ"; i.dispatchEvent(new Event("input")); })()`);
  await click("#c-send");
  const bar = hadEmail ? "skip" : await until(async () => { const t = await text("#c-sugg"); return await c.evaluate(`!document.querySelector("#c-sugg").hidden`) && t; }, 10000);
  check("real chat: correction message shows the rule bar (อีเมล)", hadEmail || /ส่งอีเมล/.test(bar), hadEmail ? "email rule already on" : "");
  if (!hadEmail) { await click(`#c-sugg [data-sg="no"]`); check("ไม่ต้อง hides the bar", await c.evaluate(`document.querySelector("#c-sugg").hidden`)); }
  await stop(a);

  // ---------- "always allow" asks first ----------
  for (const [btn, want] of [["no", false], ["yes", true]]) {
    await c.evaluate(`window.__ca = "pending"; App.assistant.confirmAlways("Write file").then(v => window.__ca = v); true`);
    const last = `[...document.querySelectorAll(".modal")].at(-1)`; // the previous one may still be fading out
    await c.waitFor(`/อนุญาตเสมอ\\?/.test(${last}?.innerText || "")`, 5000);
    await c.evaluate(`${last}.querySelector('[data-a="${btn}"]').click()`);
    check(`confirmAlways: ${btn === "no" ? "ยกเลิก -> false" : "อนุญาตเสมอ -> true"}`, await until(() => c.evaluate(`window.__ca === ${want}`), 5000));
  }

  // ---------- plan approval ----------
  const rows = [{ title: "ทดสอบ r4 รายงานยอดขายประจำวัน", bot: a, due: "", repeat: "daily", time: "08:30" },
    { title: "ทดสอบ r4 สรุปลูกค้าค้างชำระ", bot: a, due: "พรุ่งนี้", repeat: "none", time: "" }];
  const res = await c.evaluate(`App.assistant.approvePlan(${js(rows)}, ${js(b)})`);
  check("approvePlan: 1 routine + 1 hand-out", res.routines === 1 && res.once === 1, res);
  const rt = (await rk("routines/list", { botId: a })).find(x => x.name === rows[0].title);
  routineIds = (await rk("routines/list", { botId: a })).filter(x => x.name.startsWith("ทดสอบ r4")).map(x => x.id);
  check("repeat row -> routine daily 08:30 Bangkok", rt && js(rt.crons) === js(["30 8 * * *"]) && rt.timezone === "Asia/Bangkok", rt && { crons: rt.crons, tz: rt.timezone });
  const lead = await threadText(b);
  check("one-off row -> lead bot gets the approved plan for Bot A", lead.includes("แผนงานที่ผู้บริหารอนุมัติแล้ว") && lead.includes('ถึง \\"Bot A\\"') && lead.includes("สรุปลูกค้าค้างชำระ"));
  await stop(b);

  // ---------- digest fallback (model busy/loading) ----------
  await c.evaluate(`(() => { const d = document.createElement("div"); d.id = "r4dg"; document.body.append(d);
    const items = [{ r: { runId: "r4-x1", botId: ${js(a)}, botName: "Bot A", promptSnippet: "ออกใบแจ้งหนี้" }, block: { kind: "ask", text: "ขออนุญาตออกใบแจ้งหนี้", actions: [{ id: "allow" }, { id: "deny" }], approvalEffectId: "e1" } },
      { r: { runId: "r4-x2", botId: ${js(b)}, botName: "Bot B", promptSnippet: "ถามเรื่องราคา" }, block: null }];
    App.assistant.digest(items, d, d, () => {}); })()`);
  const dg = await until(async () => { const t = await text("#r4dg"); return /สรุปจากผู้ช่วย · 2 เรื่อง/.test(t) && !/กำลัง/.test(t) && t; }, 200000);
  check("digest card renders for 2 waiting items (summary or busy fallback)", dg, dg ? dg.split("\n")[1]?.slice(0, 70) : "");
  await c.evaluate(`document.querySelector("#r4dg")?.remove()`);

  check("no JS errors", (await c.evaluate("window.__errors")).length === 0, await c.evaluate("window.__errors"));
} catch (e) {
  check("run", false, e.stack || e.message);
} finally {
  try { // restore: book, triggers, rules, routines, persona, Bot A/B archived
    if (A) { await stop(A.bot.id); } if (B) { await stop(B.bot.id); }
    if (bookSaved) wsl("docker stop rakazo-demo-accounting-1 >/dev/null && cp -p /tmp/r4-book.json ~/rakazo/demo-acct/data.json && docker start rakazo-demo-accounting-1 >/dev/null && rm /tmp/r4-book.json");
    if (fs.existsSync(INBOX)) fs.unlinkSync(INBOX);
    if (trigBefore !== undefined) await c.evaluate(trigBefore === null ? `localStorage.removeItem("bt.triggers")` : `localStorage.setItem("bt.triggers", ${js(trigBefore)})`);
    if (rulesBefore) {
      const now = await rk("approvalRules/list");
      for (const r of now) if (!rulesBefore.some(x => same(x, r))) await rk("approvalRules/remove", { id: r.id });
      for (const x of rulesBefore) if (!now.some(r => same(x, r))) await rk("approvalRules/set", { effect: x.effect, matchKind: x.matchKind, matchValue: x.matchValue });
    }
    for (const routineId of routineIds) await rk("routines/remove", { routineId }).catch(() => {});
    if (origA) { await rk("bots/update", { botId: origA.id, name: origA.name, color: origA.color, title: origA.title, instructions: origA.instructions }); await c.evaluate(`localStorage.removeItem("bt.voice.${origA.id}")`); }
    for (const l of [A, B]) if (l) { await rk("threads/clear", { botId: l.bot.id }).catch(() => {}); await l.done(); }
    await c.evaluate("App.chat.load().then(() => App.go({ type: 'home' }))");
  } catch (e) { console.log("RESTORE FAILED", e.message); }
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
