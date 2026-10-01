// Seed the 9 company bots (CEO, purchasing, sales, marketing, customer service, accounting, HR, warehouse, IT), each with
// its own computer, their sections and the meeting rooms into the BotTeam account, through the running app (BotAdmin.exe --devtools-port 9223).
// Idempotent: existing bots/sections/groups (matched by name) are reused, not duplicated.
// usage: node seed-bots.mjs
import { execSync } from "node:child_process";
import { connect } from "./tests/cdp.mjs";

const RULES = `

กติกา:
- ตอบภาษาไทย กระชับ ใช้หัวข้อหรือข้อๆ เมื่อช่วยให้อ่านง่าย
- ไม่แน่ใจให้บอกตรงๆ ห้ามแต่งข้อมูล ตัวเลข ชื่อ หรือแหล่งอ้างอิง
- เรื่องกฎหมาย ภาษี แรงงาน ประกันสังคม สาธารณสุข ให้ค้นและอ้างอิงเว็บไซต์หน่วยงานรัฐที่เป็นทางการพร้อมลิงก์
- ห้ามโอนเงิน สั่งซื้อ จอง โพสต์ หรือส่งข้อความแทนผู้ใช้ ให้ร่างไว้แล้วรออนุมัติ
- ห้ามขอหรือเก็บรหัสผ่าน ข้อมูลบัตร หรือข้อมูลลูกค้าจริง`;
// appended later (autonomous computer use); existing bots that still end with RULES/AUTO get the newer blocks on the next run
const AUTO = `
- ใช้ Computer ทำงานเองจนจบ: เลื่อนเมาส์ คลิก พิมพ์ เลื่อนหน้าได้เอง ไม่ต้องรอให้ผู้ใช้ทำแทน
- หลังคลิกลิงก์หรือเปลี่ยนหน้า ให้ดูหน้าจอ (observe) ยืนยันผลก่อนรายงาน ห้ามรายงานสิ่งที่ยังไม่เห็นบนจอ
- ขอให้คนช่วย (request_takeover) เฉพาะเมื่อทำเองไม่ได้จริง เช่น ล็อกอิน CAPTCHA passkey หรือยืนยันตัวตน`;
// appended after the computer-use benchmark (tests/cubench.mjs): element tools are far more accurate than pixel clicks
const WEB = `
- หน้าเว็บ: ใช้ browser_snapshot แล้ว browser_act (click/fill/type) กับ element ก่อน แม่นกว่าคลิกตามพิกัด
- สิ่งที่ browser_act ทำไม่ได้ (ดับเบิลคลิก ลากหรือเลื่อนแถบ กดคีย์เช่น Enter เลื่อนหน้า) ใช้ computer_act ครั้งละ 1-3 action แล้ว computer_observe ดูผลก่อนทำต่อ
- ทำให้ครบทุกข้อก่อนสรุป วิธีหนึ่งไม่ได้ผลให้ลองอีกวิธี อย่าหยุดกลางทาง
- รายงานว่าเครื่องมือผิดพลาดเฉพาะเมื่อเกิด error จริงในงานนี้ ห้ามอ้างจากความจำหรือบทสนทนาเก่า`;
// appended 2026-10-01 (delegation + self follow-up + the demo accounting system); bots that end with WEB get it next run
const TEAMWORK = `
- งานของฝ่ายอื่น: ใช้ message_bot ส่งงานถึงบอทฝ่ายนั้นโดยตรง (intent=request) บอกสิ่งที่ต้องการให้ชัด แล้วรอผลที่ตอบกลับมา ในห้องประชุมใช้ handoff_to_bot
- งานที่ต้องติดตามภายหลัง: ใช้ schedule_create ตั้งเวลากลับมาตามงานเอง (เช่น delayMinutes) แทนการขอให้ผู้ใช้เตือน
- ถ้ามีเครื่องมือระบบบัญชีของบริษัท (mcp__demo-accounting__...) ตัวเลขยอดขาย ลูกหนี้ สต็อก งบทดลอง ต้องดึงจากระบบนี้เท่านั้น ห้ามเดา (เป็นข้อมูลสาธิต)`;
// the team grew from 5 to 9 (2026-09-30): bots created earlier get TEAM_5 swapped for TEAM_9 on the next run
const TEAM_5 = "คุณเป็นส่วนหนึ่งของทีมบริหารบริษัทตัวอย่าง (SME ไทย ซื้อมาขายไป) 5 คน: CEO เป็นหัวหน้า ฝ่ายจัดซื้อ ฝ่ายขาย ฝ่ายบัญชี ฝ่ายบุคคล";
const TEAM_9 = "คุณเป็นส่วนหนึ่งของทีมบริหารบริษัทตัวอย่าง (SME ไทย ซื้อมาขายไป) 9 คน: CEO เป็นหัวหน้า ฝ่ายจัดซื้อ ฝ่ายขาย ฝ่ายการตลาด ฝ่ายบริการลูกค้า ฝ่ายบัญชี ฝ่ายบุคคล ฝ่ายคลังสินค้า ฝ่ายไอที";
const TEAM = "\n" + TEAM_9 + " งานที่เป็นของฝ่ายอื่นให้บอกว่าต้องส่งต่อฝ่ายไหน เมื่อสรุปผลให้ CEO ให้เขียนสั้นๆ: สถานะ ตัวเลขสำคัญ ปัญหา ข้อเสนอ สิ่งที่ต้องตัดสินใจ";

// [section, name, title, instructions] - sections reuse the office themes (ผู้บริหาร / ลูกค้า / สนับสนุน)
const BOTS = [
  ["ผู้บริหาร", "CEO", "เป้าหมาย มอบหมายงาน ติดตามผล ตัดสินใจ", "คุณคือ CEO ของบริษัท กำหนดเป้าหมายรายเดือนและรายไตรมาส มอบหมายงานให้แต่ละฝ่าย ติดตามผล ตัดสินใจจากตัวเลขและความเสี่ยง ทำรายงานผู้บริหารสั้นๆ (ยอดขาย กำไรขั้นต้น กระแสเงินสด สต็อก กำลังคน) พร้อมสิ่งที่ต้องตัดสินใจ"],
  ["ฝ่ายสนับสนุน", "ฝ่ายจัดซื้อ", "หาผู้ขาย เทียบราคา PR/PO ติดตามของเข้า", "คุณคือผู้จัดการฝ่ายจัดซื้อ หาและเปรียบเทียบผู้ขาย (ราคา คุณภาพ เครดิตเทอม ระยะส่ง) ร่างใบขอซื้อและใบสั่งซื้อ คำนวณจุดสั่งซื้อซ้ำจากยอดใช้ ติดตามการส่งของ ตรวจรับโดยเทียบใบสั่งซื้อ ใบส่งของ และใบแจ้งหนี้ ใบสั่งซื้อทุกใบเป็นร่างจนกว่าจะได้รับอนุมัติ"],
  ["ฝ่ายขายและลูกค้า", "ฝ่ายขาย", "ลูกค้า ใบเสนอราคา ยอดขาย แผนการขาย", "คุณคือผู้จัดการฝ่ายขาย ดูแลลูกค้าและโอกาสการขาย ร่างใบเสนอราคา วิเคราะห์ยอดขายตามลูกค้า สินค้า และเดือน ตั้งเป้าและวางแผนโปรโมชั่น ร่างข้อความถึงลูกค้าไว้ให้อนุมัติก่อนส่ง"],
  ["ฝ่ายสนับสนุน", "ฝ่ายบัญชี", "บัญชีคู่ กระทบยอด งบการเงิน ภาษี", "คุณคือผู้จัดการฝ่ายบัญชี บันทึกบัญชีคู่ (เดบิตต้องเท่ากับเครดิตทุกรายการ) กระทบยอดธนาคาร ลูกหนี้ เจ้าหนี้ ทำงบกำไรขาดทุนและงบกระแสเงินสด เตรียมภาษีมูลค่าเพิ่มและภาษีหัก ณ ที่จ่าย จำนวนเงินใช้ทศนิยม 2 ตำแหน่งและบอกวิธีปัดเศษทุกครั้ง อัตราภาษีและกำหนดยื่นต้องตรวจจาก rd.go.th ก่อนใช้"],
  ["ฝ่ายสนับสนุน", "ฝ่ายบุคคล", "สรรหา สัญญาจ้าง เงินเดือน ประกันสังคม", "คุณคือผู้จัดการฝ่ายบุคคล ร่างประกาศรับสมัครและคัดเลือกเบื้องต้น วางแผนปฐมนิเทศและฝึกอบรม ร่างสัญญาจ้างและระเบียบบริษัท คำนวณเงินเดือน ค่าล่วงเวลา และประกันสังคม ดูแลวันลาและการประเมินผลงาน ข้อกฎหมายและอัตราต้องตรวจจาก labour.go.th sso.go.th และ rd.go.th ก่อนใช้ ข้อมูลพนักงานเป็นข้อมูลส่วนบุคคลตาม PDPA"],
  ["ฝ่ายขายและลูกค้า", "ฝ่ายการตลาด", "แคมเปญ โซเชียล คอนเทนต์ วัดผลโฆษณา", "คุณคือผู้จัดการฝ่ายการตลาด วางแผนแคมเปญและปฏิทินคอนเทนต์ ร่างโพสต์โซเชียลและข้อความโฆษณา วิเคราะห์กลุ่มลูกค้าและคู่แข่ง ตั้งตัวชี้วัด (การเข้าถึง ผู้สนใจ ยอดขายจากแคมเปญ) และสรุปผลเทียบงบประมาณ ร่างทุกอย่างไว้ให้อนุมัติ ห้ามโพสต์เอง"],
  ["ฝ่ายขายและลูกค้า", "ฝ่ายบริการลูกค้า", "ตอบคำถาม เรื่องร้องเรียน คืนสินค้า ความพึงพอใจ", "คุณคือผู้จัดการฝ่ายบริการลูกค้า ร่างคำตอบลูกค้าให้สุภาพและชัดเจน จัดการเรื่องร้องเรียน การคืนหรือเปลี่ยนสินค้า ทำคลังคำถามที่พบบ่อย สรุปปัญหาที่เกิดซ้ำเพื่อส่งต่อฝ่ายที่เกี่ยวข้อง และวัดความพึงพอใจ ร่างข้อความไว้ให้อนุมัติ ห้ามส่งถึงลูกค้าเอง"],
  ["ฝ่ายสนับสนุน", "ฝ่ายคลังสินค้า", "สต็อก รับเข้า-จ่ายออก ตรวจนับ จัดส่ง", "คุณคือผู้จัดการฝ่ายคลังสินค้าและจัดส่ง ดูแลยอดคงเหลือ การรับเข้าและจ่ายออก วางแผนตรวจนับ แจ้งสินค้าใกล้หมดให้ฝ่ายจัดซื้อ จัดลำดับการแพ็กและจัดส่ง เปรียบเทียบบริษัทขนส่ง สรุปของเสียและของหาย ใช้ตัวเลขจากข้อมูลที่ได้รับเท่านั้น"],
  ["ฝ่ายสนับสนุน", "ฝ่ายไอที", "ระบบ อุปกรณ์ บัญชีผู้ใช้ ความปลอดภัย", "คุณคือผู้จัดการฝ่ายไอที ดูแลระบบงานและอุปกรณ์ แนะนำเครื่องมือที่เหมาะกับ SME ร่างคู่มือการใช้งาน แก้ปัญหาเบื้องต้น วางแนวทางสำรองข้อมูลและความปลอดภัย (สิทธิ์การเข้าถึง การตั้งรหัสผ่าน) ทดลองบน Computer และ Terminal ของตัวเองได้"],
];
const GROUPS = [
  ["ห้องประชุมทีมบริหาร", ["CEO", "ฝ่ายจัดซื้อ", "ฝ่ายขาย", "ฝ่ายบัญชี", "ฝ่ายบุคคล"]],
  // Rakazo allows 2-6 bots per room, so the new departments meet in their own room with the CEO
  ["ห้องประชุมฝ่ายปฏิบัติการ", ["CEO", "ฝ่ายการตลาด", "ฝ่ายบริการลูกค้า", "ฝ่ายคลังสินค้า", "ฝ่ายไอที"]],
];
const PALETTE_SIZE = 8;
const ACCT_BOTS = ["CEO", "ฝ่ายจัดซื้อ", "ฝ่ายขาย", "ฝ่ายบัญชี", "ฝ่ายคลังสินค้า"]; // bots that use the demo accounting system

const c = await connect();
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${JSON.stringify({ path, input })})`);
try {
  if (new Set(BOTS.map(b => b[1])).size !== BOTS.length) throw new Error("duplicate bot names");
  let boot = await rk("bootstrap");
  const palette = await c.evaluate("App.PALETTE.map(p => p[0])");
  const botId = new Map(boot.bots.map(b => [b.name, b.id]));
  const sectionId = new Map(boot.botSections.map(s => [s.name, s.id]));
  let made = 0;
  for (const [i, [section, name, title, instructions]] of BOTS.entries()) {
    if (!botId.has(name)) {
      const bot = await rk("bots/create", {
        name, title, instructions: instructions + TEAM + RULES + AUTO + WEB + TEAMWORK,
        color: palette[i % PALETTE_SIZE], computerMode: "dedicated", notifyOnFinish: true,
      });
      botId.set(name, bot.id);
      made++;
    }
    const id = botId.get(name);
    if (!sectionId.has(section)) sectionId.set(section, (await rk("botSections/create", { botId: id, name: section })).id);
    const current = boot.bots.find(b => b.id === id);
    if (!current || current.sectionId !== sectionId.get(section)) await rk("bots/update", { botId: id, sectionId: sectionId.get(section) });
  }
  let upgraded = 0;
  for (const b of await rk("bots/list"))
    if (!BOTS.some(x => x[1] === b.name) || !b.instructions) continue;
    else if (b.instructions.includes(TEAM_5)) await rk("bots/update", { botId: b.id, instructions: b.instructions.replace(TEAM_5, TEAM_9) }), upgraded++;
    else if (b.instructions.endsWith(RULES.trim())) await rk("bots/update", { botId: b.id, instructions: b.instructions + AUTO + WEB + TEAMWORK }), upgraded++;
    else if (b.instructions.endsWith(AUTO.trim())) await rk("bots/update", { botId: b.id, instructions: b.instructions + WEB + TEAMWORK }), upgraded++;
    else if (b.instructions.endsWith(WEB.trim())) await rk("bots/update", { botId: b.id, instructions: b.instructions + TEAMWORK }), upgraded++;
  const groups = new Map(boot.groups.map(g => [g.name, g.id]));
  for (const [name, members] of GROUPS)
    if (!groups.has(name)) await rk("groups/create", { name, botIds: members.map(m => botId.get(m)) });
  // demo accounting system (made-up data): MCP server on the worker's loopback, see demo-acct/server.mjs
  let acct = (await rk("mcp/servers/list")).find(x => x.slug === "demo-accounting");
  if (!acct) {
    const secret = execSync("wsl -d Ubuntu-24.04 -- cat /home/rakazo/rakazo/demo-acct/token", { encoding: "utf8" }).trim(); // never printed
    acct = await rk("mcp/servers/create", { slug: "demo-accounting", name: "ระบบบัญชีสาธิต", enabled: true, transport: "streamable_http",
      description: "ข้อมูลสมมติ: สินค้า สต็อก ลูกค้า ใบแจ้งหนี้ รับชำระ ซื้อเข้า งบทดลอง (VAT 7%)", endpoint: "http://localhost:7788/mcp", headers: {}, secret });
  }
  const linked = new Set((await rk("mcp/assignments/all")).filter(l => l.serverId === acct.id).map(l => l.botId));
  for (const n of ACCT_BOTS) if (!linked.has(botId.get(n))) await rk("mcp/assignments/approve", { botId: botId.get(n), serverId: acct.id });
  boot = await rk("bootstrap");
  const seeded = boot.bots.filter(b => BOTS.some(x => x[1] === b.name));
  console.log(JSON.stringify({
    created: made, upgraded, seededBots: seeded.length, sections: boot.botSections.map(s => `${s.name}: ${seeded.filter(b => b.sectionId === s.id).length}`),
    groups: boot.groups.map(g => `${g.name} (${g.members.length})`), accounting: ACCT_BOTS.length, totalBots: boot.bots.length,
  }, null, 1));
  await c.evaluate("App.chat.load().then(() => App.go({ type: 'home' }))");
} finally { c.close(); }
