// Help bar (request_takeover): Bot A asks the user for help on its screen; "ให้บอททำต่อ" and typing "ทำต่อ" must
// both end the paused run and start a new one that answers. Rakazo v0.1.6 never resumes the paused run itself.
// Typing also has to work when the bot paused on a question card instead (threads/send refuses while an ask waits).
// usage: node takeover.mjs  (BotAdmin.exe --devtools-port 9223 running)
import { connect, borrowBot } from "./cdp.mjs";
const c = await connect();
const js = s => JSON.stringify(s);
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${info}`); };
const send = text => c.evaluate(`(() => { const e = document.querySelector("#c-input"); e.value = ${js(text)}; e.dispatchEvent(new Event("input")); document.querySelector("#c-send").click(); })()`);
const barShown = `!document.querySelector("#c-help").hidden`;
const paused = async id => { const s = await rk("threads/get", { botId: id }); return [s.run, ...(s.activeRuns || [])].filter(r => r && /^waiting_(takeover|input)$/.test(r.status)).length; };
let lease = null;
try {
  lease = await borrowBot(rk, "Bot A");
  const bot = lease.bot;
  const askShown = `!!document.querySelector(".approval [data-answer]")`; // question card with choice buttons
  const ASK = "ทดสอบระบบ: ถามผมกลับหนึ่งคำถามแบบมีตัวเลือก 2 ข้อ (ใช้เครื่องมือถามผู้ใช้) ว่าจะให้สรุปงานแบบสั้นหรือยาว แล้วรอคำตอบ";
  for (const [label, prompt, resume, shown] of [
    ["button", "ทดสอบระบบ: เรียกเครื่องมือ request_takeover ทันที ขอให้ผมช่วยกดปุ่มบนหน้าจอ (ยังไม่ต้องทำอย่างอื่น)", () => c.evaluate(`document.querySelector("#c-help-done").click()`), barShown],
    ["typed ทำต่อ", "ทดสอบระบบ: เรียกเครื่องมือ request_takeover ทันที ขอให้ผมช่วยกดปุ่มบนหน้าจอ (ยังไม่ต้องทำอย่างอื่น)", () => send("ทำต่อ"), `${barShown} || ${askShown}`],
    ["typed reply to a question card", ASK, () => send("เอาแบบสั้น"), askShown],
    ["clicked a choice on the question card", ASK, () => c.evaluate(`document.querySelector(".approval [data-answer]").click()`), askShown]]) {
    let shownOk = null, t0, tries = 0;
    while (!shownOk && tries++ < 2) { // the model sometimes answers without pausing: one more try from an empty chat
      await rk("threads/stop", { botId: bot.id }).catch(() => {});
      await rk("threads/clear", { botId: bot.id });
      await c.evaluate("App.chat.load()");
      await c.evaluate(`App.go({ type: "bot", id: ${js(bot.id)} })`);
      await c.waitFor(`!!document.querySelector("#c-input")`, 10000);
      t0 = Date.now();
      await send(prompt);
      shownOk = await c.waitFor(shown, 120000);
    }
    check(`[${label}] bot paused for the user`, shownOk, `${((Date.now() - t0) / 1000).toFixed(1)}s, try ${tries}`);
    check(`[${label}] run is paused`, await paused(bot.id), await c.evaluate(`document.querySelector("#c-status").textContent`));
    const before = await c.evaluate(`document.querySelectorAll(".msg.bot").length`);
    await resume();
    check(`[${label}] help bar hidden`, await c.waitFor(`document.querySelector("#c-help").hidden && !document.querySelector(".toast .dot.bad")`, 10000));
    check(`[${label}] paused run ended`, !(await paused(bot.id)));
    const replied = await c.waitFor(`document.querySelectorAll(".msg.bot").length > ${before} && !/กำลัง/.test(document.querySelector("#c-status").textContent)`, 180000);
    check(`[${label}] bot continued and answered`, replied, await c.evaluate(`[...document.querySelectorAll(".msg.bot")].at(-1)?.textContent.slice(0, 80)`));
  }
  await c.screenshot("D:/tmp/takeover.png");
} finally {
  if (lease) { await rk("threads/stop", { botId: lease.bot.id }).catch(() => {}); await lease.done(); }
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
