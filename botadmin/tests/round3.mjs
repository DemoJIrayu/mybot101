// Round-3 features without the LLM: work-center tabs, approval rules UI, company knowledge (+ file import), chat
// attachments UI, Windows notification op, Thai voice (Pattara TTS + whisper STT through MediaRecorder), teach by showing
// (real mouse/keyboard events -> computer.input -> saved skill with grid coordinates), team/skills tabs, backup, JSON
// export and audit CSV. Restores rules and company knowledge; borrows Bot A.
// usage: node round3.mjs  (BotAdmin.exe --devtools-port 9223 running; ask ลุงจืด not to click the app meanwhile)
import fs from "node:fs";
import { connect, borrowBot } from "./cdp.mjs";
const c = await connect();
const js = s => JSON.stringify(s);
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${typeof info === "string" ? info : js(info)}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await sleep(400); } return null; };
const click = sel => c.evaluate(`document.querySelector(${js(sel)}).click()`);
// page-side promises that can hang (audio, host calls) get a deadline instead of blocking the whole run
const timed = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(what + " timed out after " + ms + " ms"); })]);
// a real (CDP) click gives the page user activation: audio playback and speechSynthesis need it
const activate = async sel => { const r = await c.evaluate(`(() => { const b = document.querySelector(${js(sel)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 }); };
const wav = fs.readFileSync("D:/localai/thai-tts-test.wav").toString("base64");
const same = (a, b) => a.matchKind === b.matchKind && a.matchValue === b.matchValue && a.effect === b.effect;
let lease, rulesBefore, brainDoc, skillId;
try {
  await c.waitFor(`App.chat.state.ready`, 60000);
  await c.evaluate("window.__errors.length = 0");

  // ---------- tabs ----------
  await c.evaluate(`App.go({ type: "work", tab: "rules" })`);
  const tabs = await c.evaluate(`[...document.querySelectorAll("#w-tabs button")].map(b => b.dataset.tab)`);
  check("work center has team/skills/knowledge/rules/backup tabs", ["team", "skills", "knowledge", "rules", "backup"].every(t => tabs.includes(t)), tabs.join(","));

  // ---------- approval rules ----------
  rulesBefore = await rk("approvalRules/list");
  const INV = "mcp__demo-accounting__create_invoice";
  await c.waitFor(`!!document.querySelector(".rule-seg")`, 15000);
  await click(`.rule-seg[data-v="${INV}"] button[data-e="require_approval"]`);
  check("clicking ต้องขออนุญาต creates a require_approval rule", await until(async () => (await rk("approvalRules/list")).some(r => r.matchValue === INV && r.effect === "require_approval")));
  await c.waitFor(`document.querySelector('.rule-seg[data-v="${INV}"] button.on')?.dataset.e === "require_approval"`, 10000);
  await click(`.rule-seg[data-v="${INV}"] button[data-e=""]`);
  check("clicking ปกติ removes it", await until(async () => !(await rk("approvalRules/list")).some(r => r.matchValue === INV)));
  await c.waitFor(`!!document.querySelector("#rl-rec") && !document.querySelector("#rl-rec").disabled`, 10000);
  await click("#rl-rec");
  const rec = await until(async () => { const l = await rk("approvalRules/list"); return l.filter(r => r.effect === "require_approval").length >= 8 && l; }, 30000);
  check("ชุดแนะนำ sets 8 ask-first rules (money, email, accounting writes, bot lifecycle)", rec, rec && rec.filter(r => r.effect === "require_approval").map(r => r.matchValue).join(","));

  // ---------- company knowledge ----------
  brainDoc = (await rk("memory/list", {})).find(d => !d.botId && d.path === "MEMORY.md");
  check("account has a shared memory document", brainDoc);
  await c.evaluate(`App.go({ type: "work", tab: "knowledge" })`);
  await c.waitFor(`!!document.querySelector("#br-save")`, 15000);
  await c.evaluate(`document.querySelectorAll("[data-sec]").forEach(t => t.value = ""); document.querySelector("#br-sample").click()`);
  await click("#br-save");
  const saved = await until(async () => { const d = (await rk("memory/list", {})).find(x => x.id === brainDoc.id); return d.content.includes("## สินค้าและบริการ") && d.content.includes("P-001") && d; });
  check("sample knowledge saved as sections in the shared memory", saved, saved && saved.content.slice(0, 60).replace(/\n/g, " | "));
  await c.waitFor(`!!document.querySelector("#br-file")`, 10000);
  await c.evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File(["# คู่มือทดสอบ\\nรหัสทดสอบ KB-42"], "kb-test.md", { type: "text/markdown" }));
    const i = document.querySelector("#br-file"); i.files = dt.files; i.dispatchEvent(new Event("change")); })()`);
  check("imported file becomes a knowledge section", await until(async () => (await rk("memory/list", {})).find(x => x.id === brainDoc.id).content.includes("## เอกสาร: kb-test.md\n# คู่มือทดสอบ")));
  await c.waitFor(`!!document.querySelector('[data-drop="เอกสาร: kb-test.md"]')`, 10000);
  await click('[data-drop="เอกสาร: kb-test.md"]');
  check("removing the document chip drops the section", await until(async () => !(await rk("memory/list", {})).find(x => x.id === brainDoc.id).content.includes("kb-test.md")));
  const roundTrip = await c.evaluate(`(() => { const { parseBrain, brainText } = App.company; const t = "# x\\nหัว\\n\\n## ก\\nหนึ่ง\\n\\n## ข\\nสอง"; const p = parseBrain(t); return brainText(p.head, p.sec); })()`);
  check("knowledge parse/serialize keeps sections", /หัว[\s\S]*## ก\nหนึ่ง[\s\S]*## ข\nสอง/.test(roundTrip));

  // ---------- chat attachments (UI only; sending is in round3-llm) ----------
  lease = await borrowBot(rk, "Bot A");
  const botA = lease.bot;
  await c.evaluate(`App.chat.load()`);
  await c.evaluate(`App.go({ type: "bot", id: ${js(botA.id)} })`);
  await c.waitFor(`!!document.querySelector("#c-attach")`, 15000);
  await c.evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File(["hello"], "note.txt", { type: "text/plain" })); dt.items.add(new File(["MZ"], "tool.exe"));
    const i = document.querySelector("#c-file"); i.files = dt.files; i.dispatchEvent(new Event("change")); })()`);
  const att = await c.evaluate(`({ chips: [...document.querySelectorAll("#c-att .file-chip")].map(x => x.textContent.trim()), send: !document.querySelector("#c-send").disabled })`);
  check("attaching shows a chip and enables send; .exe is refused", att.chips.length === 1 && /note\.txt/.test(att.chips[0]) && att.send, att);
  await click("[data-unattach]");
  check("removing the chip clears it", await c.evaluate(`document.querySelector("#c-att").hidden && document.querySelector("#c-send").disabled`));

  // ---------- notifications ----------
  const n = await timed(c.evaluate(`App.call("notify", { title: "BotTeam · ทดสอบ", body: "ทดสอบการแจ้งเตือน Windows", route: { type: "work", tab: "inbox" }, force: true })`), 15000, "notify").catch(e => ({ error: e.message }));
  check("Windows notification op shows a toast", n && n.shown === true, n);

  // ---------- voice ----------
  await activate("#msgs");
  const voices = await c.waitFor(`(() => { const v = speechSynthesis.getVoices().filter(v => v.lang === "th-TH").map(v => v.name); return v.length && v; })()`, 10000);
  check("a Thai voice is installed for read-aloud", voices, voices);
  await c.evaluate(`App.voice.speak("**สวัสดีครับ** นี่คือ [ลิงก์](https://www.bcaccount.com) ทดสอบ")`);
  check("read-aloud speaks, with markdown/links stripped", await c.waitFor(`speechSynthesis.speaking || speechSynthesis.pending`, 5000), await c.evaluate("App.voice.last"));
  await c.evaluate("App.voice.stop()");
  // the mic path minus the device: wav -> AudioContext -> MediaRecorder (webm/opus) -> host whisper
  const heard = await timed(c.evaluate(`(async () => {
    const ctx = new AudioContext(); await ctx.resume(); const buf = await ctx.decodeAudioData(Uint8Array.from(atob(${js(wav)}), ch => ch.charCodeAt(0)).buffer);
    const src = ctx.createBufferSource(), dst = ctx.createMediaStreamDestination(); src.buffer = buf; src.connect(dst);
    const rec = new MediaRecorder(dst.stream, { mimeType: "audio/webm;codecs=opus" }), chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(r => rec.onstop = r);
    rec.start(250); src.start(); await new Promise(r => src.onended = r); rec.stop(); await done; ctx.close();
    const b64 = await new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(",")[1]); f.readAsDataURL(new Blob(chunks, { type: "audio/webm" })); });
    const t = Date.now(), res = await App.call("stt", { audio: b64 });
    return { text: res.text, ms: Date.now() - t };
  })()`), 240000, "record + transcribe").catch(e => ({ text: "", error: e.message }));
  check("recorded Thai speech is transcribed locally (whisper)", /สวัสดี/.test(heard.text) && /ภาษาไทย/.test(heard.text), heard);

  // ---------- teach by showing ----------
  await c.evaluate(`App.go({ type: "bot", id: ${js(botA.id)}, teach: true })`);
  await c.waitFor(`!!document.querySelector("#tg-goal")`, 10000);
  await c.evaluate(`document.querySelector("#tg-goal").value = "ทดสอบสอนงาน: คลิกกลางจอแล้วพิมพ์ abc"; document.querySelector("#tg-ok").click()`);
  const ov = await c.waitFor(`(() => { const o = document.querySelector(".teach-ov"), f = document.querySelector(".teach-stage iframe"); if (!o || !f) return null;
    const r = f.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: f.width, h: f.height }; })()`, 120000);
  check("teaching opens the bot's screen with the capture overlay", ov, ov);
  if (ov) {
    skillId = await c.evaluate(`App.chat.teaching()?.skill?.id`);
    for (const type of ["mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: ov.x, y: ov.y, button: "left", clickCount: 1 });
    await sleep(300);
    for (const ch of "abc") { await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch }); await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch }); }
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    check("inputs are counted", await c.waitFor(`/^[45] /.test(document.querySelector("#tg-n")?.textContent || "")`, 5000), await c.evaluate(`document.querySelector("#tg-n")?.textContent`));
    await sleep(1500);
    await click("#tg-stop");
    const steps = await c.waitFor(`document.querySelector("#sd-steps")?.value`, 60000);
    check("stopping turns the recording into steps", steps && /Click/i.test(steps) && /abc|a.*b.*c/i.test(steps), steps && steps.replace(/\n/g, " | ").slice(0, 200));
    const xy = steps && /\((\d+), (\d+)\)/.exec(steps);
    check("click position is converted to the 0..1000 grid (centre ≈ 500,500)", xy && Math.abs(xy[1] - 500) <= 6 && Math.abs(xy[2] - 500) <= 6, xy && xy[0]);
    await c.evaluate(`document.querySelector("#sd-name").value = "ทดสอบคลิกกลางจอ"; document.querySelector("#sd-ok").click()`);
    const sk = await until(async () => (await rk("skills/list", { botId: botA.id })).find(s => s.id === skillId && s.status === "saved"), 15000);
    check("skill saved with the edited name and a grid note", sk && sk.name === "ทดสอบคลิกกลางจอ" && /0-1000/.test(sk.playbook.failureHandling), sk && sk.playbook.steps.length + " steps");
    await c.waitFor(`App.route().type === "work" && !!document.querySelector(".skill")`, 15000);
    check("skills tab lists it with สั่งทำ", await c.evaluate(`[...document.querySelectorAll(".skill")].some(x => x.textContent.includes("ทดสอบคลิกกลางจอ") && x.querySelector("[data-run]"))`));
  }

  // ---------- team tab ----------
  await c.evaluate(`App.go({ type: "work", tab: "team" })`);
  check("team tab shows the CEO hand-out box and the hand-off list", await c.waitFor(`!!document.querySelector("#tm-goal") && !!(document.querySelector(".hand") || document.querySelector("#w-body .empty"))`, 20000));

  // ---------- backup / export / audit ----------
  const ex = await timed(c.evaluate(`App.company.companyExport().then(d => ({ bots: d.bots.length, failed: d.bots.filter(b => b.error).map(b => b.error), history: d.bots.some(b => b.history?.length), groups: d.groups.length, knowledge: d.companyKnowledge.length, secret: /"secret"|apiKey/.test(JSON.stringify(d.mcpServers)), size: JSON.stringify(d).length }))`), 120000, "export");
  check("company export has every bot, room and the knowledge, no secrets", ex.bots >= 9 && !ex.failed.length && ex.history && ex.groups >= 2 && ex.knowledge >= 1 && !ex.secret, ex);
  const audit = await timed(c.evaluate(`App.company.auditCsv().then(r => ({ count: r.count, head: r.text.slice(1, 40), tool: /,เครื่องมือ,/.test(r.text) }))`), 120000, "audit").catch(e => ({ error: e.message }));
  check("audit CSV lists messages and tool steps", audit.count > 20 && audit.head.startsWith("เวลา,แชท") && audit.tool, audit);
  await c.evaluate(`App.go({ type: "work", tab: "backup" })`);
  await c.waitFor(`!!document.querySelector("#bk-full")`, 10000);
  const before = await c.evaluate(`localStorage.getItem("bt.lastBackup")`);
  await click("#bk-full");
  const bk = await until(async () => { const v = await c.evaluate(`localStorage.getItem("bt.lastBackup")`); return v && v !== before && JSON.parse(v); }, 300000);
  check("full backup writes a database dump to D:\\localai\\backups", bk && fs.existsSync(bk.dir + "\\rakazo.dump") && bk.mb > 0, bk);

  const errors = await c.evaluate("window.__errors");
  check("no JS errors", !errors.length, errors);
  await c.screenshot("D:/tmp/round3.png");
} finally {
  try { // restore: rules as they were, the shared memory, the test skill, Bot A archived
    if (rulesBefore) {
      const now = await rk("approvalRules/list");
      for (const r of now) if (!rulesBefore.some(b => same(b, r))) await rk("approvalRules/remove", { id: r.id });
      for (const b of rulesBefore) if (!now.some(r => same(b, r))) await rk("approvalRules/set", { effect: b.effect, matchKind: b.matchKind, matchValue: b.matchValue });
    }
    if (brainDoc) await rk("memory/update", { documentId: brainDoc.id, content: brainDoc.content });
    if (skillId) await rk("skills/remove", { skillId }).catch(() => {});
    if (lease) { await lease.done(); await c.evaluate("App.chat.load().then(() => App.go({ type: 'home' }))"); }
  } catch (e) { console.log("RESTORE FAILED", e.message); }
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
