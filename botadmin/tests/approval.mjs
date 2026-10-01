// Approval UI: a temporary global "require approval" rule on scratchpad_add makes Bot A pause; the chat must show
// "รออนุมัติ" status, Thai buttons, no typing dots under the card; ปฏิเสธ ends the run. The rule is always removed.
// usage: node approval.mjs  (BotAdmin.exe --devtools-port 9223 running)
import { connect, borrowBot } from "./cdp.mjs";
const c = await connect();
const js = s => JSON.stringify(s);
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${info}`); };
let rule = null, lease = null;
try {
  lease = await borrowBot(rk, "Bot A");
  const bot = lease.bot;
  await rk("threads/clear", { botId: bot.id }); // earlier denials in the history make the model avoid the tool
  await c.evaluate("App.chat.load()");
  rule = await rk("approvalRules/set", { effect: "require_approval", matchKind: "tool", matchValue: "scratchpad_add" });
  await c.evaluate(`App.go({ type: "bot", id: ${js(bot.id)} })`);
  await c.waitFor(`!!document.querySelector("#c-input") && !document.querySelector("#msgs-inner .empty .typing")`, 10000);
  await c.evaluate(`(() => { const e = document.querySelector("#c-input"); e.value = "ใช้เครื่องมือ scratchpad_add เพิ่มรายการ ทดสอบอนุมัติ"; e.dispatchEvent(new Event("input")); document.querySelector("#c-send").click(); })()`);
  const card = await c.waitFor(`!!document.querySelector(".approval [data-answer]")`, 120000);
  check("approval card shown", card);
  await new Promise(r => setTimeout(r, 1500));
  const ui = await c.evaluate(`({ status: document.querySelector("#c-status").textContent,
    buttons: [...document.querySelectorAll(".approval [data-answer]")].map(b => b.textContent),
    dots: !!document.querySelector(".msg.bot .typing") })`);
  check("status says รออนุมัติ", /รออนุมัติ/.test(ui.status), ui.status);
  check("buttons in Thai", ui.buttons.length > 0 && ui.buttons.every(t => /[\u0E00-\u0E7F]/.test(t)), ui.buttons.join(" | "));
  check("card text in Thai (no Rakazo 'Review before')", !/Review before/.test(await c.evaluate(`document.querySelector(".approval").textContent`)), await c.evaluate(`document.querySelector(".approval > div:nth-child(2)")?.textContent.slice(0, 60)`));
  check("no typing dots while waiting", !ui.dots);
  await c.screenshot("D:/tmp/approval.png");
  await c.evaluate(`[...document.querySelectorAll(".approval [data-answer]")].find(b => b.dataset.answer === "deny").click()`);
  const answered = await c.waitFor(`/ตอบแล้ว: ปฏิเสธ/.test(document.querySelector(".approval")?.textContent || "")`, 30000);
  check("answer shown in Thai", answered, await c.evaluate(`document.querySelector(".approval")?.textContent.slice(-40)`));
  const idle = await c.waitFor(`!/รออนุมัติ/.test(document.querySelector("#c-status").textContent) && !App.chat.state.bots.find(x => x.id === ${js(bot.id)})?.working`, 120000);
  check("run finishes after deny", idle, await c.evaluate(`document.querySelector("#c-status").textContent`));
} finally {
  if (lease) await lease.done();
  if (rule?.id) console.log("rule removed:", js(await rk("approvalRules/remove", { id: rule.id }).catch(e => e.message)));
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
