// Phase-3 acceptance: Bot A / Bot B on private (dedicated) computers, isolation, concurrency, approval gate.
// Runs through the app's authenticated proxy (BotAdmin.exe --devtools-port 9223). usage: node phase3.mjs
import { connect, borrowBot } from "./cdp.mjs";
import { execFileSync } from "node:child_process";

const c = await connect();
const js = JSON.stringify;
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${js({ path, input })})`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`); };
const text = m => m.blocks.map(b => b.text || "").join(" ");
const wsl = cmd => execFileSync("wsl.exe", ["-d", "Ubuntu-24.04", "-u", "rakazo", "--", "bash", "-lc", cmd], { encoding: "utf8" }).trim();
const vram = () => +execFileSync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8" }).trim();

const leases = [];
async function bot(name, instructions) {
  const l = await borrowBot(rk, name, { instructions });
  leases.push(l);
  return l.bot;
}
// send and wait until the run ends; returns { ms, reply, snap }
async function ask(botId, textIn, timeoutMs = 600000) {
  const seen = new Set((await rk("threads/get", { botId })).messages.map(m => m.id));
  const t0 = Date.now();
  const receipt = await rk("threads/send", { botId, text: textIn, clientNonce: "p3-" + t0 });
  let snap;
  for (;;) {
    await sleep(2000);
    snap = await rk("threads/get", { botId });
    const done = !snap.run || ["completed", "failed", "cancelled", "waiting_input"].includes(snap.run.status);
    const replied = snap.messages.some(m => !seen.has(m.id) && m.role === "bot");
    if ((done && replied) || snap.run?.status === "waiting_input") break;
    if (Date.now() - t0 > timeoutMs) throw new Error("timeout " + textIn.slice(0, 30));
  }
  const reply = snap.messages.filter(m => !seen.has(m.id) && m.role === "bot").map(text).join("\n");
  return { ms: Date.now() - t0, reply, snap, runId: receipt.runId };
}

try {
  const rules = "ตอบภาษาไทยสั้นๆ รายงานผลตามจริงเท่านั้น ห้ามเดา";
  const A = await bot("Bot A", rules), B = await bot("Bot B", rules);
  check("Bot A/B are private computers", A.computerMode === "dedicated" && B.computerMode === "dedicated");

  // 1) Bot A: screenshot, uname, file
  const a1 = await ask(A.id, "ทำ 3 อย่างบน Computer ของคุณ: (1) เปิด https://www.bcaccount.com ใน browser แล้วบอกหัวข้อหน้าเว็บ (2) รันคำสั่ง `uname -a` ใน terminal แล้วแปะผลลัพธ์ (3) สร้างไฟล์ ~/isolation-test.txt มีข้อความ bot-a-only แล้วรัน `cat ~/isolation-test.txt` ยืนยัน");
  console.log(`   Bot A ${(a1.ms / 1000).toFixed(1)}s: ${a1.reply.replace(/\s+/g, " ").slice(0, 200)}`);
  check("Bot A opened www.bcaccount.com", /BC Account/i.test(a1.reply));
  check("Bot A ran uname -a", /Linux/.test(a1.reply));
  const boxA = wsl(`docker ps --filter label=rakazo.botId=${A.id} --format '{{.Names}}' | head -1`);
  const boxB0 = wsl(`docker ps -a --filter label=rakazo.botId=${B.id} --format '{{.Names}}' | head -1`);
  check("Bot A has its own container", !!boxA, boxA);
  check("file exists in Bot A home", wsl(`docker exec ${boxA} cat /home/rakazo/isolation-test.txt 2>&1 || true`).includes("bot-a-only"));

  // 2) Bot B must not see Bot A's file
  const b1 = await ask(B.id, "รันคำสั่ง `ls -la ~/isolation-test.txt` ใน terminal ของคุณ แล้วแปะผลลัพธ์ตามจริง");
  console.log(`   Bot B ${(b1.ms / 1000).toFixed(1)}s: ${b1.reply.replace(/\s+/g, " ").slice(0, 200)}`);
  const boxB = wsl(`docker ps --filter label=rakazo.botId=${B.id} --format '{{.Names}}' | head -1`);
  check("Bot B has a different container", boxB && boxB !== boxA, `${boxB0 || "(new)"} -> ${boxB}`);
  check("Bot B cannot see the file (docker)", wsl(`docker exec ${boxB} test -e /home/rakazo/isolation-test.txt && echo FOUND || echo MISSING`) === "MISSING");
  check("Bot B reports no such file", /No such file|ไม่พบ|ไม่มี/i.test(b1.reply));

  // 3) concurrency: both at once, sample VRAM
  const samples = [];
  let sampling = true;
  const sampler = (async () => { while (sampling) { samples.push(vram()); await sleep(1000); } })();
  const t0 = Date.now();
  const [ca, cb] = await Promise.all([
    ask(A.id, "รัน `date; nproc; free -m` ใน terminal แล้วแปะผลลัพธ์"),
    ask(B.id, "เปิด https://www.bcaccount.com ใน browser แล้วบอกหัวข้อหน้าเว็บ"),
  ]);
  sampling = false; await sampler;
  const snap = await c.evaluate(`App.call("snapshot")`);
  check("concurrent Bot A reply", /Mem|nproc|\d{2}:\d{2}/.test(ca.reply), `${(ca.ms / 1000).toFixed(1)}s`);
  check("concurrent Bot B reply", /BC Account/i.test(cb.reply), `${(cb.ms / 1000).toFixed(1)}s`);
  console.log(`   both done in ${((Date.now() - t0) / 1000).toFixed(1)}s; VRAM peak ${Math.max(...samples)} MiB of ${snap.gpu?.vramTotal ?? "?"}; RAM ${snap.ramUsedGb?.toFixed?.(1)} / ${snap.ramTotalGb?.toFixed?.(1)} GB`);
  const stats = wsl(`docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' ${boxA} ${boxB}`);
  console.log("   " + stats.replace(/\n/g, "\n   "));

  // 4) approval gate: a require_approval rule makes the tool ask; deny it from the app's approval card
  const rule = await rk("approvalRules/set", { effect: "require_approval", matchKind: "tool", matchValue: "write_file" });
  try {
    const ap = await ask(A.id, "ใช้เครื่องมือ write_file สร้างไฟล์ /home/rakazo/approval-test.txt ข้อความ hello (ห้ามใช้ shell)", 300000);
    const askMsg = ap.snap.messages.find(m => m.blocks.some(b => b.kind === "ask" && b.approvalEffectId && b.status !== "answered"));
    check("write_file waits for approval", ap.snap.run?.status === "waiting_input" && askMsg, ap.snap.run?.status + " " + ap.reply.slice(0, 100));
    if (askMsg) {
      await c.evaluate(`App.go({ type: "bot", id: ${js(A.id)} })`);
      check("approval card shown in app", await c.waitFor(`!!document.querySelector('[data-answer="deny"]')`, 15000));
      await c.screenshot("D:/tmp/p3-approval.png");
      await c.evaluate(`document.querySelector('[data-answer="deny"]').click()`);
      await sleep(12000);
      const exists = wsl(`docker exec ${boxA} sh -c "test -e /home/rakazo/approval-test.txt && echo YES || echo NO"`);
      check("denied write_file never ran (no file)", exists === "NO", exists);
      const after = await rk("threads/get", { botId: A.id });
      check("ask marked answered", after.messages.some(m => m.id === askMsg.id && m.blocks.some(b => b.kind === "ask" && b.status === "answered")));
    }
  } finally { await rk("approvalRules/remove", { id: rule.id }); }
} finally {
  for (const l of leases) await l.done();
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  await c.evaluate("App.chat.load()");
  c.close();
  process.exitCode = failed ? 1 : 0;
}
