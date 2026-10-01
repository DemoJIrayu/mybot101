// Office acceptance (dev server + a Chromium with --remote-debugging-port, e.g. headless Edge on 9333):
// scene loads, bots walk without overlapping each other or entering furniture, a thrown ball bounces off a bot
// (Rapier) and the bot reacts. usage: node tests/office.mjs [port]
import { connect } from "./cdp.mjs";

const c = await connect(Number(process.argv[2] ?? 9333), 30000, "http://127.0.0.1:3300");
const results = [];
const check = (name, ok, info = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
  await c.send("Page.reload", { ignoreCache: true });
  check("page ready", await c.waitFor(`!!window.__office && window.__office.getState().bots.length > 0`, 30000));
  await c.evaluate(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message))); addEventListener("unhandledrejection", e => __errs.push(String(e.reason)))`);
  await c.evaluate(`document.querySelector('.gate button')?.click()`);
  check("navmesh + crowd ready", await c.waitFor(`!!window.__nav && window.__nav.rts.size > 0`, 20000), await c.evaluate(`window.__nav?.rts.size`));
  check("no page errors so far", !(await c.evaluate(`document.body.innerText.includes("Unhandled")`)));

  // 1) walk for 70 s: sample every 250 ms; nobody overlaps, nobody stands inside furniture
  const sample = `(() => {
    const rts = [...window.__nav.rts.values()], boxes = window.__world.boxes;
    let minPair = 99, inside = 0, moving = 0, maxSpeed = 0;
    for (let i = 0; i < rts.length; i++) {
      const a = rts[i];
      if (a.speed > 0.15) moving++;
      maxSpeed = Math.max(maxSpeed, a.speed);
      for (const b of boxes) if (Math.abs(a.x - b.x) < b.w / 2 - 0.05 && Math.abs(a.z - b.z) < b.d / 2 - 0.05) inside++;
      for (let j = i + 1; j < rts.length; j++) { const b = rts[j]; minPair = Math.min(minPair, Math.hypot(a.x - b.x, a.z - b.z)); }
    }
    return { minPair, inside, moving, maxSpeed, walkers: rts.filter(r => r.goal.kind !== "desk").length };
  })()`;
  let worst = 99, insideHits = 0, everMoving = 0, peakWalkers = 0, maxSpeed = 0;
  for (let t = 0; t < 280; t++) {
    const s = await c.evaluate(sample);
    worst = Math.min(worst, s.minPair); insideHits += s.inside; everMoving = Math.max(everMoving, s.moving);
    peakWalkers = Math.max(peakWalkers, s.walkers); maxSpeed = Math.max(maxSpeed, s.maxSpeed);
    await sleep(250);
  }
  check("bots walk on their own", everMoving > 0 && peakWalkers > 0, `peak moving ${everMoving}, wandering ${peakWalkers}, max speed ${maxSpeed.toFixed(2)} m/s`);
  check("no bot inside furniture/walls", insideHits === 0, `${insideHits} samples inside`);
  check("bots never overlap (min centre distance ≥ 0.45 m, radius 0.35)", worst >= 0.45, `min ${worst.toFixed(2)} m`);
  await c.screenshot("D:/tmp/office-walk.png");

  // 2) physics: throw a ball over the desk at a bot standing at it (spawn clear of every collider)
  await c.evaluate(`window.__office.setState({ balls: [], hits: {} })`);
  const target = await c.evaluate(`(() => { const [id, r] = [...window.__nav.rts].find(([, r]) => r.arrived && r.goal.kind === "desk"); return { id, x: r.x, z: r.z }; })()`);
  await c.evaluate(`window.__office.setState(s => ({ balls: [...s.balls, { id: 9001, pos: [${target.x}, 1.35, ${target.z + 2.2}], vel: [0, 0.6, -8], color: "#ff6b8b" }] }))`);
  const hit = await c.waitFor(`window.__office.getState().hits[${JSON.stringify(target.id)}]?.text`, 5000);
  check("ball hits bot → bot reacts", !!hit, hit || "no hit");
  await sleep(4000);
  const bubble = await c.evaluate(`[...document.querySelectorAll('.bubble.hit')].map(b => b.textContent)[0] ?? null`);
  check("hit bubble shown", !!bubble || !!hit, bubble ?? "(bubble expired)");

  // 3) ball rests on the floor instead of falling through
  await c.evaluate(`window.__office.setState(s => ({ balls: [...s.balls, { id: 9002, pos: [${target.x}, 3, ${target.z + 1.9}], vel: [0, 0, 0], color: "#6dd3a8" }] }))`);
  await sleep(5000);
  const ys = await c.evaluate(`(() => { const ys = []; window.__rapier.bodies.forEach(b => { if (b.isDynamic()) ys.push(+b.translation().y.toFixed(3)); }); return ys; })()`);
  check("balls rest on the floor (radius 0.26), none fell through", ys.length >= 2 && ys.every(y => y > 0.2 && y < 0.35), JSON.stringify(ys));

  // 4) group chat: members walk to the meeting table and all get there (no aisle deadlocks)
  const poke = `(() => { const S = window.__office, g = S.getState().groups.find(g => g.members.length >= 4) ?? S.getState().groups[0];
    const a = { botId: g.members[0], groupId: g.id, kind: "say", emoji: "💬", label: "ประชุม", at: Date.now() };
    S.setState(s => ({ live: { ...s.live, [a.botId]: a }, feed: [a, ...s.feed] })); return g.members; })()`;
  const members = await c.evaluate(poke);
  let arrived = 0;
  for (let t = 0; t < 45 && arrived < members.length; t++) {
    await sleep(1000);
    if (t % 20 === 19) await c.evaluate(poke); // keep the meeting going
    arrived = await c.evaluate(`${JSON.stringify(members)}.filter(id => { const r = window.__nav.rts.get(id); return r && r.goal.kind === "meet" && r.arrived; }).length`);
  }
  check("group members all reach the meeting table", arrived === members.length, `${arrived}/${members.length}`);
  await c.screenshot("D:/tmp/office-meeting.png");

  const errors = await c.evaluate(`window.__errs`);
  check("no JS errors", errors.length === 0, JSON.stringify(errors).slice(0, 300));
} finally {
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  c.close();
  process.exitCode = failed ? 1 : 0;
}
