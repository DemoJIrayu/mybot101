// Demo accounting system for the bots (MADE-UP data only — never real customers or production).
// MCP over Streamable HTTP, stateless JSON responses, zero dependencies. Runs as a sidecar sharing rakazo-worker's
// network namespace, because Rakazo only lets bots reach http://localhost (the worker's loopback) or public https.
// Money: integer satang in storage, decimal strings ("1234.50") in and out; VAT 7% (6.3% + local tax, Royal Decree
// No. 807, until 30 Sep 2027) rounded half-up per invoice. Journal is append-only double entry; every mutating call
// takes an idempotency key.
// usage: node server.mjs            (serves 127.0.0.1:7788/mcp, bearer token from ./token, data in ./data.json)
//        node server.mjs --selftest (accounting checks on a fresh in-memory book, no network)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(DIR, "data.json"), PORT = 7788;
const VAT_BP = 700; // basis points
const ACCOUNTS = {
  "1100": "เงินสดและเงินฝากธนาคาร", "1130": "ลูกหนี้การค้า", "1150": "สินค้าคงเหลือ", "1160": "ภาษีซื้อ",
  "2110": "เจ้าหนี้การค้า", "2150": "ภาษีขาย", "3100": "ทุน", "4100": "รายได้จากการขาย", "5100": "ต้นทุนขาย",
};

// ---------- money ----------
export const toSatang = s => {
  if (typeof s === "number") s = String(s);
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(String(s ?? "").replace(/,/g, "").trim());
  if (!m) throw new Error(`จำนวนเงินไม่ถูกต้อง: ${s} (ใช้รูปแบบ 1234.50)`);
  return Number(m[1]) * 100 + Number((m[2] || "0").padEnd(2, "0"));
};
export const baht = n => (n < 0 ? "-" : "") + Math.floor(Math.abs(n) / 100) + "." + String(Math.abs(n) % 100).padStart(2, "0");
const thb = n => { const [i, f] = baht(n).split("."); return i.replace(/\B(?=(\d{3})+$)/g, ",") + "." + f + " บาท"; };
export const vatOf = subtotal => Math.floor((subtotal * VAT_BP + 5000) / 10000); // half-up to the satang

// ---------- book ----------
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // Asia/Bangkok date
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);

export function freshBook() {
  const b = {
    company: "บริษัท สาธิตการค้า จำกัด (ข้อมูลสมมติ)",
    products: [
      { sku: "P-001", name: "ปุ๋ยอินทรีย์ 25 กก.", unit: "กระสอบ", price: 45000, cost: 32000, stock: 0, reorder: 40 },
      { sku: "P-002", name: "เมล็ดพันธุ์ข้าวโพด 10 กก.", unit: "ถุง", price: 89000, cost: 65000, stock: 0, reorder: 20 },
      { sku: "P-003", name: "สายยางรดน้ำ 20 ม.", unit: "ม้วน", price: 35000, cost: 21000, stock: 0, reorder: 15 },
      { sku: "P-004", name: "เครื่องพ่นยาแบตเตอรี่ 16 ลิตร", unit: "เครื่อง", price: 249000, cost: 185000, stock: 0, reorder: 5 },
      { sku: "P-005", name: "ถุงมือยางทำสวน", unit: "คู่", price: 4500, cost: 2200, stock: 0, reorder: 100 },
      { sku: "P-006", name: "กรรไกรตัดกิ่ง", unit: "อัน", price: 29000, cost: 17500, stock: 0, reorder: 10 },
    ],
    customers: [
      { code: "C-001", name: "ร้านเกษตรรุ่งเรือง (สมมติ)", creditDays: 30 },
      { code: "C-002", name: "สวนผักบ้านสุข (สมมติ)", creditDays: 15 },
      { code: "C-003", name: "หจก. ไร่ทองดี (สมมติ)", creditDays: 45 },
      { code: "C-004", name: "ลูกค้าหน้าร้าน (เงินสด)", creditDays: 0 },
    ],
    suppliers: [
      { code: "S-001", name: "บริษัท ปุ๋ยไทยพัฒนา (สมมติ)" },
      { code: "S-002", name: "บริษัท อุปกรณ์สวนสยาม (สมมติ)" },
    ],
    invoices: [], purchases: [], journal: [], keys: {}, seq: { INV: 0, PO: 0, JV: 0 },
  };
  const d0 = addDays(today(), -60);
  post(b, { date: d0, ref: "OPEN", memo: "ทุนจดทะเบียน (ยอดยกมา)", key: "seed-open", lines: [["1100", 50000000, 0], ["3100", 0, 50000000]] });
  createPurchase(b, { supplier_code: "S-001", lines: [{ sku: "P-001", qty: 120 }, { sku: "P-002", qty: 30 }, { sku: "P-005", qty: 300 }], idempotency_key: "seed-po1" }, d0);
  createPurchase(b, { supplier_code: "S-002", lines: [{ sku: "P-003", qty: 25 }, { sku: "P-004", qty: 8 }, { sku: "P-006", qty: 12 }], idempotency_key: "seed-po2" }, d0);
  const i1 = createInvoice(b, { customer_code: "C-001", lines: [{ sku: "P-001", qty: 60 }, { sku: "P-005", qty: 100 }], idempotency_key: "seed-inv1" }, addDays(today(), -50));
  createInvoice(b, { customer_code: "C-003", lines: [{ sku: "P-004", qty: 4 }, { sku: "P-002", qty: 14 }], idempotency_key: "seed-inv2" }, addDays(today(), -40));
  const i3 = createInvoice(b, { customer_code: "C-002", lines: [{ sku: "P-003", qty: 12 }, { sku: "P-006", qty: 5 }], idempotency_key: "seed-inv3" }, addDays(today(), -20));
  createInvoice(b, { customer_code: "C-004", lines: [{ sku: "P-005", qty: 150 }], idempotency_key: "seed-inv4" }, addDays(today(), -3));
  recordPayment(b, { invoice_no: i1.no, amount: baht(i1.total), idempotency_key: "seed-pay1" }, addDays(today(), -25));
  recordPayment(b, { invoice_no: i3.no, amount: "3000.00", idempotency_key: "seed-pay3" }, addDays(today(), -5));
  return b;
}

function post(b, { date, ref, memo, key, lines }) {
  const dr = lines.reduce((s, l) => s + l[1], 0), cr = lines.reduce((s, l) => s + l[2], 0);
  if (dr !== cr || dr <= 0) throw new Error(`รายการบัญชีไม่สมดุล: เดบิต ${baht(dr)} เครดิต ${baht(cr)}`);
  const je = { id: `JV-${String(++b.seq.JV).padStart(5, "0")}`, date, ref, memo, key, at: new Date().toISOString(),
    lines: lines.filter(l => l[1] || l[2]).map(([account, debit, credit]) => ({ account, debit, credit })) };
  b.journal.push(je); // append-only: mistakes are corrected with a reversing entry, never edited
  return je;
}

function once(b, key, fn) {
  if (key && b.keys[key]) return { ...b.keys[key], duplicate: true };
  const r = fn();
  if (key) b.keys[key] = r;
  return r;
}

const product = (b, sku) => b.products.find(p => p.sku === String(sku).toUpperCase()) || (() => { throw new Error(`ไม่พบสินค้า ${sku}`); })();
const qtyOf = q => { if (!Number.isInteger(Number(q)) || Number(q) <= 0 || Number(q) > 100000) throw new Error(`จำนวนไม่ถูกต้อง: ${q}`); return Number(q); };
const linesOf = lines => { if (!Array.isArray(lines) || !lines.length || lines.length > 50) throw new Error("ต้องมีรายการสินค้า 1-50 รายการ"); return lines; };

export function createInvoice(b, a, date = today()) {
  const c = b.customers.find(x => x.code === String(a.customer_code).toUpperCase());
  if (!c) throw new Error(`ไม่พบลูกค้า ${a.customer_code}`);
  return once(b, a.idempotency_key, () => {
    const lines = linesOf(a.lines).map(l => { const p = product(b, l.sku), qty = qtyOf(l.qty); return { sku: p.sku, name: p.name, qty, price: p.price, cost: p.cost, amount: p.price * qty }; });
    for (const l of lines) { const p = product(b, l.sku); if (p.stock < l.qty) throw new Error(`${p.name} คงเหลือ ${p.stock} ${p.unit} ไม่พอขาย ${l.qty}`); }
    const subtotal = lines.reduce((s, l) => s + l.amount, 0), vat = vatOf(subtotal), cost = lines.reduce((s, l) => s + l.cost * l.qty, 0);
    const no = `INV-${date.slice(0, 4)}-${String(++b.seq.INV).padStart(4, "0")}`;
    post(b, { date, ref: no, memo: `ขายสินค้า ${c.name}`, key: a.idempotency_key, lines: [["1130", subtotal + vat, 0], ["4100", 0, subtotal], ["2150", 0, vat], ["5100", cost, 0], ["1150", 0, cost]] });
    for (const l of lines) product(b, l.sku).stock -= l.qty;
    const inv = { no, date, due: addDays(date, c.creditDays), customer: c.code, customerName: c.name, lines, subtotal, vat, total: subtotal + vat, paid: 0 };
    b.invoices.push(inv);
    return inv;
  });
}

export function recordPayment(b, a, date = today()) {
  const inv = b.invoices.find(x => x.no === String(a.invoice_no).toUpperCase());
  if (!inv) throw new Error(`ไม่พบใบแจ้งหนี้ ${a.invoice_no}`);
  return once(b, a.idempotency_key, () => {
    const amt = toSatang(a.amount);
    if (amt <= 0 || amt > inv.total - inv.paid) throw new Error(`ยอดรับชำระต้องไม่เกินยอดค้าง ${thb(inv.total - inv.paid)}`);
    post(b, { date, ref: inv.no, memo: `รับชำระจาก ${inv.customerName}`, key: a.idempotency_key, lines: [["1100", amt, 0], ["1130", 0, amt]] });
    inv.paid += amt;
    return { invoice_no: inv.no, received: amt, outstanding: inv.total - inv.paid };
  });
}

export function createPurchase(b, a, date = today()) {
  const s = b.suppliers.find(x => x.code === String(a.supplier_code).toUpperCase());
  if (!s) throw new Error(`ไม่พบผู้ขาย ${a.supplier_code}`);
  return once(b, a.idempotency_key, () => {
    const lines = linesOf(a.lines).map(l => { const p = product(b, l.sku), qty = qtyOf(l.qty), cost = l.unit_cost != null ? toSatang(l.unit_cost) : p.cost; return { sku: p.sku, qty, cost, amount: cost * qty }; });
    const subtotal = lines.reduce((x, l) => x + l.amount, 0), vat = vatOf(subtotal);
    const no = `PO-${date.slice(0, 4)}-${String(++b.seq.PO).padStart(4, "0")}`;
    post(b, { date, ref: no, memo: `ซื้อสินค้าจาก ${s.name}`, key: a.idempotency_key, lines: [["1150", subtotal, 0], ["1160", vat, 0], ["2110", 0, subtotal + vat]] });
    for (const l of lines) { const p = product(b, l.sku); p.cost = l.cost; p.stock += l.qty; } // ponytail: last cost, not weighted average
    const po = { no, date, supplier: s.code, supplierName: s.name, lines, subtotal, vat, total: subtotal + vat };
    b.purchases.push(po);
    return po;
  });
}

export function trialBalance(b) {
  const t = {};
  for (const je of b.journal) for (const l of je.lines) { t[l.account] ??= { debit: 0, credit: 0 }; t[l.account].debit += l.debit; t[l.account].credit += l.credit; }
  const rows = Object.keys(ACCOUNTS).filter(k => t[k]).map(k => { const n = t[k].debit - t[k].credit; return { account: k, name: ACCOUNTS[k], debit: n > 0 ? n : 0, credit: n < 0 ? -n : 0 }; });
  const debit = rows.reduce((s, r) => s + r.debit, 0), credit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, debit, credit, balanced: debit === credit };
}

// ---------- MCP tools ----------
const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const LINES = { type: "array", minItems: 1, maxItems: 50, items: S({ sku: { type: "string" }, qty: { type: "integer", minimum: 1 } }, ["sku", "qty"]) };
const KEY = { type: "string", description: "คีย์กันบันทึกซ้ำ (เช่น เลขที่คำสั่งซื้อ) — เรียกซ้ำด้วยคีย์เดิมจะไม่บันทึกซ้ำ" };
const invOut = i => ({ no: i.no, date: i.date, due: i.due, customer: i.customerName, subtotal: baht(i.subtotal), vat: baht(i.vat), total: baht(i.total), paid: baht(i.paid), outstanding: baht(i.total - i.paid), status: i.paid >= i.total ? "ชำระแล้ว" : i.due < today() ? "เกินกำหนด" : "ค้างชำระ" });

const TOOLS = {
  list_products: {
    description: "ดูรายการสินค้า ราคาขาย ต้นทุน และจำนวนคงเหลือ (low_stock_only=true เพื่อดูเฉพาะสินค้าที่ต่ำกว่าจุดสั่งซื้อ)",
    inputSchema: S({ low_stock_only: { type: "boolean" } }),
    run: (b, a) => {
      const ps = b.products.filter(p => !a.low_stock_only || p.stock <= p.reorder);
      return { text: ps.map(p => `${p.sku} ${p.name}: คงเหลือ ${p.stock} ${p.unit} (จุดสั่งซื้อ ${p.reorder}) ราคา ${thb(p.price)}${p.stock <= p.reorder ? " ⚠️ ใกล้หมด" : ""}`).join("\n") || "ไม่มีสินค้าที่ใกล้หมด",
        data: ps.map(p => ({ ...p, price: baht(p.price), cost: baht(p.cost) })) };
    },
  },
  list_customers: {
    description: "ดูรายชื่อลูกค้าและเครดิตเทอม", inputSchema: S({}),
    run: b => ({ text: b.customers.map(c => `${c.code} ${c.name} เครดิต ${c.creditDays} วัน`).join("\n"), data: b.customers }),
  },
  list_invoices: {
    description: "ดูใบแจ้งหนี้ขาย (status: unpaid=ค้างชำระ, overdue=เกินกำหนด, paid=ชำระแล้ว, all=ทั้งหมด)",
    inputSchema: S({ status: { type: "string", enum: ["unpaid", "overdue", "paid", "all"] } }),
    run: (b, a) => {
      const st = a.status || "all", rows = b.invoices.map(invOut).filter(i => st === "all" || (st === "paid" ? i.status === "ชำระแล้ว" : st === "overdue" ? i.status === "เกินกำหนด" : i.status !== "ชำระแล้ว"));
      return { text: rows.map(i => `${i.no} ${i.date} ${i.customer} ยอด ${i.total} ค้าง ${i.outstanding} บาท · ${i.status} (ครบกำหนด ${i.due})`).join("\n") || "ไม่มีใบแจ้งหนี้ตามเงื่อนไข", data: rows };
    },
  },
  get_ar_aging: {
    description: "สรุปลูกหนี้ค้างชำระแยกตามอายุหนี้ (ยังไม่ถึงกำหนด / เกิน 1-30 / 31-60 / 60+ วัน)", inputSchema: S({}),
    run: b => {
      const buckets = { "ยังไม่ถึงกำหนด": 0, "เกิน 1-30 วัน": 0, "เกิน 31-60 วัน": 0, "เกิน 60 วัน": 0 };
      for (const i of b.invoices) {
        const due = i.total - i.paid; if (!due) continue;
        const late = Math.floor((Date.parse(today()) - Date.parse(i.due)) / 86400e3);
        buckets[late <= 0 ? "ยังไม่ถึงกำหนด" : late <= 30 ? "เกิน 1-30 วัน" : late <= 60 ? "เกิน 31-60 วัน" : "เกิน 60 วัน"] += due;
      }
      const total = Object.values(buckets).reduce((s, n) => s + n, 0);
      return { text: Object.entries(buckets).map(([k, n]) => `${k}: ${thb(n)}`).join("\n") + `\nรวมลูกหนี้ค้างชำระ ${thb(total)}`,
        data: { ...Object.fromEntries(Object.entries(buckets).map(([k, n]) => [k, baht(n)])), total: baht(total) } };
    },
  },
  get_sales_summary: {
    description: "สรุปยอดขาย ภาษีขาย ต้นทุน และกำไรขั้นต้น ในช่วงวันที่ (YYYY-MM-DD, ไม่ระบุ = ทั้งหมด)",
    inputSchema: S({ from: { type: "string" }, to: { type: "string" } }),
    run: (b, a) => {
      const inv = b.invoices.filter(i => (!a.from || i.date >= a.from) && (!a.to || i.date <= a.to));
      const sales = inv.reduce((s, i) => s + i.subtotal, 0), vat = inv.reduce((s, i) => s + i.vat, 0), cost = inv.reduce((s, i) => s + i.lines.reduce((x, l) => x + l.cost * l.qty, 0), 0);
      return { text: `ใบแจ้งหนี้ ${inv.length} ใบ\nยอดขายก่อน VAT ${thb(sales)}\nภาษีขาย ${thb(vat)}\nต้นทุนขาย ${thb(cost)}\nกำไรขั้นต้น ${thb(sales - cost)}`,
        data: { invoices: inv.length, sales: baht(sales), vat: baht(vat), cost: baht(cost), grossProfit: baht(sales - cost) } };
    },
  },
  get_trial_balance: {
    description: "งบทดลอง (ยอดคงเหลือทุกบัญชี) พร้อมตรวจว่าเดบิตเท่ากับเครดิต", inputSchema: S({}),
    run: b => {
      const t = trialBalance(b);
      return { text: t.rows.map(r => `${r.account} ${r.name}: ${r.debit ? "Dr " + thb(r.debit) : "Cr " + thb(r.credit)}`).join("\n") + `\nรวมเดบิต ${thb(t.debit)} = รวมเครดิต ${thb(t.credit)} ${t.balanced ? "✅ สมดุล" : "❌ ไม่สมดุล"}`,
        data: { ...t, rows: t.rows.map(r => ({ ...r, debit: baht(r.debit), credit: baht(r.credit) })), debit: baht(t.debit), credit: baht(t.credit) } };
    },
  },
  create_invoice: {
    description: "ออกใบแจ้งหนี้ขายสินค้า (ตัดสต็อก, คิด VAT 7%, บันทึกบัญชีคู่อัตโนมัติ)",
    inputSchema: S({ customer_code: { type: "string" }, lines: LINES, idempotency_key: KEY }, ["customer_code", "lines"]),
    run: (b, a) => { const i = createInvoice(b, a); return { text: `${i.duplicate ? "(มีอยู่แล้ว ไม่บันทึกซ้ำ) " : ""}ออกใบแจ้งหนี้ ${i.no} ให้ ${i.customerName} ยอดก่อน VAT ${thb(i.subtotal)} VAT ${thb(i.vat)} รวม ${thb(i.total)} ครบกำหนด ${i.due}`, data: invOut(i), wrote: !i.duplicate }; },
  },
  record_payment: {
    description: "บันทึกรับชำระเงินตามใบแจ้งหนี้ (amount เป็นสตริงทศนิยม เช่น \"1500.00\")",
    inputSchema: S({ invoice_no: { type: "string" }, amount: { type: "string" }, idempotency_key: KEY }, ["invoice_no", "amount"]),
    run: (b, a) => { const r = recordPayment(b, a); return { text: `${r.duplicate ? "(บันทึกไปแล้ว) " : ""}รับชำระ ${r.invoice_no} ${thb(r.received)} คงค้าง ${thb(r.outstanding)}`, data: { ...r, received: baht(r.received), outstanding: baht(r.outstanding) }, wrote: !r.duplicate }; },
  },
  create_purchase: {
    description: "บันทึกซื้อสินค้าเข้าสต็อกจากผู้ขาย S-001/S-002 (unit_cost ไม่ระบุ = ต้นทุนล่าสุด)",
    inputSchema: S({ supplier_code: { type: "string" }, lines: { ...LINES, items: S({ sku: { type: "string" }, qty: { type: "integer", minimum: 1 }, unit_cost: { type: "string" } }, ["sku", "qty"]) }, idempotency_key: KEY }, ["supplier_code", "lines"]),
    run: (b, a) => { const p = createPurchase(b, a); return { text: `${p.duplicate ? "(มีอยู่แล้ว) " : ""}บันทึกซื้อ ${p.no} จาก ${p.supplierName} รวม ${thb(p.total)} (VAT ${thb(p.vat)})`, data: { no: p.no, total: baht(p.total), vat: baht(p.vat) }, wrote: !p.duplicate }; },
  },
};

// ---------- server ----------
function load() { try { return JSON.parse(fs.readFileSync(DATA, "utf8")); } catch { const b = freshBook(); save(b); return b; } }
function save(b) { fs.writeFileSync(DATA + ".tmp", JSON.stringify(b)); fs.renameSync(DATA + ".tmp", DATA); }

function rpc(book, msg) {
  const ok = result => ({ jsonrpc: "2.0", id: msg.id, result }), fail = (code, message) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  switch (msg.method) {
    case "initialize": return ok({ protocolVersion: msg.params?.protocolVersion || "2025-06-18", capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "demo-accounting", version: "1.0.0" }, instructions: `ระบบบัญชีสาธิตของ ${book.company} — ข้อมูลสมมติทั้งหมด เงินเป็นบาท VAT 7%` });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
    case "tools/call": {
      const t = TOOLS[msg.params?.name];
      if (!t) return fail(-32602, "unknown tool " + msg.params?.name);
      try {
        const r = t.run(book, msg.params.arguments || {});
        if (r.wrote) save(book);
        return ok({ content: [{ type: "text", text: r.text }], structuredContent: { result: r.data } });
      } catch (e) { return ok({ content: [{ type: "text", text: "ผิดพลาด: " + e.message }], isError: true }); }
    }
    default: return msg.id == null ? null : fail(-32601, "method not found");
  }
}

function serve() {
  const token = fs.readFileSync(path.join(DIR, "token"), "utf8").trim();
  const book = load();
  http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, body ? { "content-type": "application/json" } : {}); res.end(body ? JSON.stringify(body) : undefined); };
    if (req.url !== "/mcp") return send(404);
    const auth = Buffer.from(req.headers.authorization || ""), want = Buffer.from("Bearer " + token);
    if (auth.length !== want.length || !crypto.timingSafeEqual(auth, want)) return send(401, { error: "unauthorized" });
    if (req.method !== "POST") return send(405); // no server-initiated stream: JSON responses only
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      let msg;
      try { msg = JSON.parse(body); } catch { return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
      const out = Array.isArray(msg) ? msg.map(m => rpc(book, m)).filter(Boolean) : rpc(book, msg);
      return out && (!Array.isArray(out) || out.length) ? send(200, out) : send(202);
    });
  }).listen(PORT, "127.0.0.1", () => console.log(`demo-accounting on 127.0.0.1:${PORT}/mcp`));
}

function selftest() {
  const assert = (c, m) => { if (!c) throw new Error("FAIL " + m); console.log("PASS " + m); };
  assert(toSatang("0.1") + toSatang("0.2") === toSatang("0.3"), "0.1 + 0.2 == 0.3 in satang");
  assert(toSatang("1,234.5") === 123450 && baht(123450) === "1234.50" && baht(-5) === "-0.05", "decimal string round-trip");
  assert(thb(123456789) === "1,234,567.89 บาท" && thb(-100000) === "-1,000.00 บาท", "display format");
  assert(vatOf(15) === 1 && vatOf(7) === 0 && vatOf(100000) === 7000, "VAT 7% half-up at satang (0.15 -> 0.01, 0.07 -> 0.00)");
  let bad = false; try { toSatang("1.234"); } catch { bad = true; } assert(bad, "rejects 3 decimals");
  const b = freshBook();
  assert(trialBalance(b).balanced, "seed book: debit == credit");
  assert(b.journal.every(j => j.lines.reduce((s, l) => s + l.debit - l.credit, 0) === 0), "every journal entry balances");
  const n = b.journal.length, stock = product(b, "P-006").stock;
  const i = createInvoice(b, { customer_code: "C-002", lines: [{ sku: "P-006", qty: 2 }], idempotency_key: "t1" });
  const again = createInvoice(b, { customer_code: "C-002", lines: [{ sku: "P-006", qty: 2 }], idempotency_key: "t1" });
  assert(again.duplicate && again.no === i.no && b.journal.length === n + 1 && product(b, "P-006").stock === stock - 2, "idempotent invoice: posted and stocked once");
  assert(i.total === 58000 + vatOf(58000) && baht(i.vat) === "40.60", "invoice total = subtotal + VAT");
  recordPayment(b, { invoice_no: i.no, amount: "300.00", idempotency_key: "t2" });
  recordPayment(b, { invoice_no: i.no, amount: "300.00", idempotency_key: "t2" });
  assert(b.invoices.find(x => x.no === i.no).paid === 30000, "duplicate payment ignored");
  bad = false; try { recordPayment(b, { invoice_no: i.no, amount: "999999.00" }); } catch { bad = true; } assert(bad, "overpayment rejected");
  bad = false; try { createInvoice(b, { customer_code: "C-001", lines: [{ sku: "P-004", qty: 999 }] }); } catch { bad = true; } assert(bad, "cannot sell more than stock");
  assert(trialBalance(b).balanced, "book still balances after sales and payments");
  const ar = b.invoices.reduce((s, x) => s + x.total - x.paid, 0), tb = trialBalance(b).rows.find(r => r.account === "1130");
  assert(tb.debit === ar, "AR ledger reconciles with open invoices");
  console.log("ALL PASS");
}

if (process.argv.includes("--selftest")) selftest(); else serve();
