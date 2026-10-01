// Computer-use probe: does Gemma drive the desktop itself (mouse/keyboard via computer_act)? usage: node cu.mjs "<task>" [botName]
import { connect, borrowBot } from "./cdp.mjs";

const c = await connect();
const js = JSON.stringify;
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const [task, name = "Bot A"] = process.argv.slice(2);

const lease = await borrowBot(rk, name), bot = lease.bot;
const seen = new Set((await rk("threads/get", { botId: bot.id })).messages.map(m => m.id));
const t0 = Date.now();
await rk("threads/send", { botId: bot.id, text: task, clientNonce: "cu-" + t0 });
let snap;
for (;;) {
  await sleep(3000);
  snap = await rk("threads/get", { botId: bot.id });
  const fresh = snap.messages.filter(m => !seen.has(m.id));
  if (snap.run?.status === "waiting_input" || (fresh.some(m => m.role === "bot") && (!snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status)))) break;
  if (Date.now() - t0 > 360000) { console.log("TIMEOUT"); break; }
}
const fresh = snap.messages.filter(m => !seen.has(m.id));
const steps = fresh.flatMap(m => m.blocks.filter(b => b.kind === "steps").flatMap(b => b.steps.map(s => `${s.label}${s.count > 1 ? "×" + s.count : ""}`)));
const reply = fresh.filter(m => m.role === "bot").flatMap(m => m.blocks.map(b => b.text || (b.kind !== "steps" ? `[${b.kind}]` : ""))).join(" ").replace(/\s+/g, " ");
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s run=${snap.run?.status ?? "done"}\nsteps: ${js(steps)}\nreply: ${reply.slice(0, 400)}`);
await lease.done();
c.close();
