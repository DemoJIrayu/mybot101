// Computer-use benchmark: the bot does the 10 tasks of bench.html in its own Chrome. Each finished task reveals a code
// on the page; the codes the bot reads back prove which tasks were really done (it cannot guess them).
// Clears the bot's chat before each round. usage: node cubench.mjs [free|mouse|browser|rules] [botName]   free = any tools, mouse = computer_* only, browser = browser_* only, rules = the bot instruction rules decide
import { execFileSync } from "node:child_process";
import { connect, borrowBot } from "./cdp.mjs";

const [mode = "free", name = "Bot A"] = process.argv.slice(2);
const c = await connect();
const js = JSON.stringify;
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wsl = sh => execFileSync("wsl.exe", ["-d", "Ubuntu-24.04", "-u", "root", "--", "sh", "-c", sh], { encoding: "utf8", timeout: 15000 });
const CODE = { start: "K3", typeEn: "M8", typeTh: "P2", check: "R5", select: "T9", dbl: "W4", drag: "X7", enter: "Z6", tiny: "Q1", scroll: "H5" }; // = bench.html

const lease = await borrowBot(rk, name), bot = lease.bot;
if (bot.computerMode !== "dedicated") throw new Error(name + " needs a dedicated computer (its home is where bench.html goes)");
const home = `/var/lib/docker/volumes/rakazo_appdata/_data/homes/${bot.id}`;
wsl(`cp /mnt/d/localai/botadmin/tests/bench.html ${home}/bench.html && chown 1000:1000 ${home}/bench.html`);

const how = {
  mouse: "ใช้เฉพาะ computer_observe และ computer_act (เมาส์และคีย์บอร์ด) เท่านั้น ห้ามใช้เครื่องมือ browser_*",
  browser: "ใช้เฉพาะ browser_navigate, browser_snapshot และ browser_act (อ้างอิง element จาก snapshot) ห้ามใช้ computer_act",
  free: "ใช้เครื่องมือที่เร็วและแม่นที่สุด",
  // candidate bot rule: element tools where possible, pixel tools in small observed batches for the rest
  rules: "ทำตามกติกาการใช้เครื่องมือของคุณ", // relies on the WEB block of seed-bots.mjs in the bot instructions
}[mode];
const task = `ขั้นแรกใช้ shell รัน nohup python3 -m http.server 8765 --bind 127.0.0.1 --directory /home/rakazo >/dev/null 2>&1 & แล้วเปิด http://127.0.0.1:8765/bench.html ใน Chrome จากนั้นทำภารกิจทั้ง 10 ข้อบนหน้านั้นให้ครบ (ข้อที่เสร็จจะขึ้นเครื่องหมายถูก) ${how} เสร็จแล้วอ่าน "รหัสยืนยัน" ที่ด้านบนของหน้ามารายงานตามที่เห็นบนจอ พร้อมบอกว่าข้อไหนทำไม่สำเร็จ`;

await rk("threads/clear", { botId: bot.id }); // earlier rounds in the history bias the next one (e.g. a mistaken "tool broken" claim)
const seen = new Set((await rk("threads/get", { botId: bot.id })).messages.map(m => m.id));
const t0 = Date.now();
await rk("threads/send", { botId: bot.id, text: task, clientNonce: "bench-" + t0 });
let snap;
for (;;) {
  await sleep(2000);
  snap = await rk("threads/get", { botId: bot.id });
  const fresh = snap.messages.filter(m => !seen.has(m.id));
  if (snap.run?.status === "waiting_input" || snap.run?.status === "waiting_takeover") break;
  if (fresh.some(m => m.role === "bot") && (!snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status))) break;
  if (Date.now() - t0 > 900000) { console.log("TIMEOUT"); await rk("threads/stop", { botId: bot.id }).catch(() => {}); break; }
}
const fresh = snap.messages.filter(m => !seen.has(m.id));
const steps = fresh.flatMap(m => m.blocks.filter(b => b.kind === "steps").flatMap(b => b.steps.map(s => `${s.label}${s.count > 1 ? "×" + s.count : ""}`)));
const reply = fresh.filter(m => m.role === "bot").flatMap(m => m.blocks.map(b => b.text || "")).join(" ").replace(/\s+/g, " ");
console.log(`mode=${mode} ${((Date.now() - t0) / 1000).toFixed(0)}s run=${snap.run?.status ?? "done"}`);
const got = Object.entries(CODE).filter(([, v]) => reply.includes(v)).map(([k]) => k);
console.log(`verified: ${got.length}/10 ${got.join(",")}`);
console.log(`steps: ${steps.join(", ")}`);
console.log(`reply: ${reply.slice(0, 500)}`);
await lease.done();
c.close();
