# RUNBOOK — BotTeam (Rakazo + Gemma 4 แบบ local ทั้งหมด)

## 1. ภาพรวมระบบ

```
Windows
├─ llama-server (Gemma 4 26B-A4B)  :8080   D:\localai\serve-th.bat, คีย์ใน D:\localai\llm-api-key.txt
├─ BotTeam app (WPF+WebView2)              D:\localai\botadmin\dist\BotAdmin.exe
│    บัญชีซ่อน owner@botteam.local → %LOCALAPPDATA%\BotTeam\owner.json (บอทในแอป ≠ บอทในเว็บ Rakazo)
├─ ออฟฟิศ 3D (Next.js)              127.0.0.1:3300   D:\localai\botoffice
├─ stt.py (faster-whisper medium, CPU)           ไมค์ในแชท → ข้อความไทย (แอปเปิด/ปิดเอง ไม่มี port)
└─ WSL Ubuntu-24.04 (systemd, networkingMode=mirrored)
     ├─ Docker Engine ของ WSL (ไม่ใช่ Docker Desktop ที่มีข้อมูลลูกค้า)
     ├─ ~/rakazo  Rakazo v0.1.6: web 127.0.0.1:5173 · api 127.0.0.1:3110 · postgres · worker · supervisor
     │    Computer ของบอท = container rakazo-bot-* (2 CPU / 3 GB ต่อเครื่อง, เปิดค้างตลอด — ดูข้อ 4)
     │    demo-accounting = MCP ระบบบัญชีสาธิต (ข้อมูลสมมติ) อยู่ใน network ของ worker → localhost:7788/mcp
     ├─ llama-bridge.service    socat 172.17.0.1:18080 → llama-server 127.0.0.1:8080 (เฉพาะ docker bridge)
     ├─ rakazo-lan-block.service  กันบอทเข้า LAN/IP ภายใน (DOCKER-USER)
     └─ keep-alive  wsl --exec sleep infinity (BotTeam เปิดให้เอง)
```

## 2. เปิด / ปิด / ตรวจสถานะ

```powershell
powershell -ExecutionPolicy Bypass -File D:\localai\botteam.ps1 status   # ดูทั้ง 4 ส่วน
powershell -ExecutionPolicy Bypass -File D:\localai\botteam.ps1 start    # เปิด BotTeam (เปิด LLM+Rakazo เอง) + ออฟฟิศ
powershell -ExecutionPolicy Bypass -File D:\localai\botteam.ps1 stop     # ปิดทั้งหมด ข้อมูลอยู่ครบ
```
- เปิดจากศูนย์จนพร้อมราว 50 วินาที (วัด 2026-09-30); บอทที่ใช้ Computer ครั้งแรกหลังบูต +1–3 นาที
- Rakazo อย่างเดียว: `wsl -d Ubuntu-24.04 -- bash /mnt/d/localai/botadmin/rakazo.sh status|start|stop|logs <service>|backup`
- ห้ามใช้ `docker compose down -v` (ลบฐานข้อมูลและ home ของบอททั้งหมด)
- ออฟฟิศ 3D: แก้โค้ดแล้ว `npm --prefix D:\localai\botoffice run build` ก่อน `start`; log ที่ `D:\localai\logs\botoffice.log`

- build แอป BotTeam ใหม่ (SDK อยู่ `%LOCALAPPDATA%\Microsoft\dotnet\dotnet.exe` — `dotnet` ใน PATH ไม่มี SDK, ปิดแอปก่อน): `dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o dist` → ตรวจ `dist\BotAdmin.exe --selftest` · แก้แค่ UI: `cp ui/*.js ui/*.css ui/*.html dist/ui/ && node tests/reload.mjs`

## 3. เพิ่ม/แก้บอท
- เพิ่มในแอป BotTeam ปุ่ม + (เลือก template หรือเปล่า) → โหมด Computer: `team` (ใช้เครื่องร่วม ประหยัด) หรือ `dedicated` (เครื่องส่วนตัว)
- ทีมบริษัท 9 ตัว (CEO, ฝ่ายจัดซื้อ, ฝ่ายขาย, ฝ่ายการตลาด, ฝ่ายบริการลูกค้า, ฝ่ายบัญชี, ฝ่ายบุคคล, ฝ่ายคลังสินค้า, ฝ่ายไอที) แต่ละตัวมี Computer ส่วนตัว (`dedicated` = 1 บอท 1 container, ว่าง ~400MB/ตัว เพดาน 3GB) + 2 ห้อง: "ห้องประชุมทีมบริหาร" (5 ฝ่ายเดิม) และ "ห้องประชุมฝ่ายปฏิบัติการ" (CEO + 4 ฝ่ายใหม่) — Rakazo จำกัดห้องละ 2-6 บอท: `node D:\localai\botadmin\seed-bots.mjs` (แอปต้องเปิดด้วย `--devtools-port 9223`) — รันซ้ำได้ ไม่สร้างซ้ำ
- ปุ่ม **Terminal** หัวแชทบอท (เฉพาะบอท `dedicated`): เปิด bash ใน Linux ของบอทตัวนั้น (user `rakazo` ไม่มี sudo) ถ้า Computer ปิดอยู่จะเปิดให้ก่อน และComputer เปิดค้างตลอดอยู่แล้ว (ข้อ 4)
- **โหมด LLM** (สวิตช์มุมซ้ายล่างของแอป): `🖥 Local` = Gemma บน llama-server (ข้อมูลไม่ออกนอกเครื่อง) / `⚡ DeepSeek` = cloud เร็วกว่า (~120 tok/s, งาน computer use ~15 วิ เทียบ local 27–48 วิ) — สลับ = เปลี่ยน default model ของ Rakazo ทันทีไม่ต้อง restart; บอทที่ไม่ได้ตั้งโมเดลเองตามโหมดนี้ทุกตัว
  - คีย์: `D:\localai\deepseek-api-key.txt` (บรรทัดที่ขึ้นต้น `sk-`) ถูก connect เข้า Rakazo ครั้งแรกที่กด DeepSeek (เก็บเข้ารหัสใน DB) — เปลี่ยนคีย์: แก้ไฟล์ + ลบ credential deepseek เดิมใน Rakazo web → Settings → Models แล้วกดสลับใหม่
  - model id `deepseek-v4-flash-vision-exp` (ชื่อที่ pi-ai ใน v0.1.6 รู้จักและประกาศว่ารับภาพ; DeepSeek เสิร์ฟด้วย deepseek-flash) — ราคา deepseek-flash ต่อ 1M token: input $0.15 / output $0.60 (off-peak), ×2 ช่วง peak 08–11 และ 13–17 น. เวลาไทย จ.–ศ. (api-docs.deepseek.com/quick_start/pricing, ตรวจ 2026-09-30)
- ปุ่ม Stop / สถานะ "กำลังทำงาน…": ถ้า event จบงานหลุด แชทจะเทียบกับ server เองทุก 15 วิ (และทันทีหลังกด Stop) แล้วปิดงานที่ server จบไปแล้ว + ดึงข้อความที่ตกหล่น
- บอทขอให้ช่วยบนหน้าจอ (CAPTCHA/ล็อกอิน): แถบสีเหลืองเหนือช่องพิมพ์ → "ช่วยบนหน้าจอ" (เปิด Computer + ควบคุมเอง) → ทำเสร็จกด "ให้บอททำต่อ" / "ข้าม" หรือพิมพ์ในแชทได้เลย. Rakazo v0.1.6 ไม่ resume run หลังคืนหน้าจอ แอปจึงหยุด run ที่ค้างแล้วส่งข้อความต่อเป็น run ใหม่ (บอทเห็นแชท+หน้าจอเดิม). คำถามแบบมีตัวเลือกแสดงเป็นปุ่ม; พิมพ์ตอบแทนการกดก็ได้ (ใช้ทางเดียวกัน)
- **ศูนย์งาน** (แถบซ้ายล่าง, ตัวเลขสีเหลือง = จำนวนงานที่รอคุณ; มี toast เตือนเมื่อบอทเริ่มรอ) — แนวคิดจาก OpenAI Dots / Meta Muse, ใช้ข้อมูลของ Rakazo ตรง ๆ (`ui/work.js`):
  - **รอคุณ**: คำขออนุมัติ/คำถามจากทุกบอท ตอบได้ในการ์ดเลย (ปุ่มตัวเลือก หรือพิมพ์คำตอบ) · ขอให้ช่วยบนจอ → ปุ่มไปที่แชท (แถบช่วยเหลืออยู่ที่นั่น)
  - **กิจกรรม**: งานที่กำลังทำ + 20 งานล่าสุด (ขีดจำกัดของ `runs/list` ใน Rakazo) คลิกแถวเพื่อเปิดแชท
  - **งานประจำ**: Rakazo routines เวลาไทย (`Asia/Bangkok`) มีตัวอย่าง 5 ฝ่ายให้กดตั้ง · "รันเลย" ทดลองทันที · ผลอยู่ในแชทของบอทตัวนั้น · ทุกรอบกิน GPU (Local) หรือเงิน (DeepSeek)
  - **ความจำ**: MEMORY.md ของแต่ละบอท (บอทเขียนเองด้วยเครื่องมือ remember) เพิ่ม/แก้/ลืมทั้งหมดได้ — บอทใช้ในงานถัดไปทันที · Rakazo ไม่มีคำสั่งลบเอกสาร "ลืมทั้งหมด" = เหลือแค่หัวข้อ
  - **ผลงาน**: ไฟล์ที่บอทสร้าง (แชทบอท + ไฟล์ในห้องรวมจาก file block) เปิดดูในแอป (markdown/ข้อความ/รูป) และบันทึกไฟล์ได้ · ในแชทไฟล์เป็นชิป 📎 กดเปิดได้ (เดิมขึ้นแค่ [ไฟล์])
  - **ค่าใช้จ่าย**: ยอดรวมทั้งหมดจาก `usage/summary` + แยกรายบอท/Local-DeepSeek จาก 100 ครั้งล่าสุด (Rakazo ให้แค่ 100 แถว) · ค่า DeepSeek = ราคาทางการ deepseek-flash แยก peak/off-peak คิดแบบ cache miss (ตัวเลขสูงสุด) ตรวจราคา 2026-09-30
- **ห้องควบคุม** (แถบซ้ายล่าง): จอสดของบอททุกตัวพร้อมกัน (9 ตัว = ตาราง 3×3 พอดีหน้าจอ, ดูอย่างเดียว) + สถานะ/งานที่ทำ · "เปิดจอทุกตัว" = boot ทุกเครื่อง · สวิตช์ "เปิดค้างตลอด" (ค่าเริ่ม = เปิด) แอปเช็คทุก 60 วิ เครื่องไหนดับจะ boot ให้ · บอทส่งงานให้กัน = ลูกศร 📨 จากผู้ส่งไปผู้รับบนจอ
- **ค้นหาทุกแชท**: พิมพ์ในช่องค้นหาแถบซ้าย ≥2 ตัวอักษร → ผลจากทุกแชท/ไฟล์/งานประจำ (Rakazo `search/query`, ภาษาไทยได้) กดข้อความ = เปิดแชท, กดไฟล์ = เปิดดูไฟล์
  - หน้าเว็บเรียกได้เพิ่ม: `routines/*`, `memory/list|update`, `usage/list|summary`, `search/query`, `artifacts/list|get` (ตั้งค่า memory provider/credential ยังอยู่ฝั่ง C# เท่านั้น)
- MCP: หน้า MCP ในแอป → เพิ่ม URL (https, จบด้วย `/sse` = SSE) → กำหนดให้บอท; Rakazo รับแค่ https หรือ `http://localhost` ซึ่งคือ loopback ของ container worker (IP ใน LAN ถูกบล็อก, stdio ปิด) — MCP ในเครื่องต้องเป็น sidecar แบบ demo-accounting
- ปุ่มอนุมัติ: บอทหยุดรอที่การ์ด "ขออนุญาต" (อนุญาตครั้งนี้ / อนุญาตเสมอ / ปฏิเสธ) สถานะหัวแชทขึ้น "รออนุมัติจากคุณ"

## 3b. ฟีเจอร์บริษัท (รอบ 3, 2026-10-01)
| ฟีเจอร์ | อยู่ตรงไหน | หมายเหตุ |
|---|---|---|
| ความรู้บริษัท | ศูนย์งาน → ความรู้บริษัท | = เอกสาร MEMORY.md ระดับบัญชี (บอททุกตัวเห็นทุกงาน) แบ่งหัวข้อ ธุรกิจ/สินค้า/น้ำเสียง/FAQ/นโยบาย + นำเข้าไฟล์ .txt/.md/.csv/.json ≤16 KB · เพดาน 32 KB รวมความจำของบอท · "ใส่ตัวอย่าง" = บริษัทสมมติ |
| แนบไฟล์ในแชท | ปุ่ม 📎 ช่องพิมพ์ | รูป/PDF/txt/md/csv/json ≤10 MB, ≤4 ไฟล์ต่อข้อความ · รูปส่งให้โมเดลดู, ไฟล์อื่นไปอยู่ `attachments/` ใน Computer บอท |
| กฎอนุมัติ | ศูนย์งาน → กฎอนุมัติ | ต่อเครื่องมือ: ปกติ / ต้องขออนุญาต / อนุญาตเสมอ + ชุดแนะนำ 8 ข้อ · กฎมีผลกับ**ทุกบอท** (Rakazo ไม่มีกฎรายบอท และไม่มี "ห้ามเด็ดขาด") · กด "อนุญาตเสมอ" บนการ์ด = สร้างกฎ |
| แจ้งเตือน Windows | อัตโนมัติ | บอลลูนที่ถาดระบบเมื่อบอทรอคุณ (เฉพาะตอนแอปไม่อยู่หน้าหรือย่อ) คลิก = เปิดแชทนั้น |
| สอนงาน (skills) | หัว Computer → 🎓 สอนงาน | ตั้งเป้าหมาย → ทำให้ดูบนจอบอท (คลิก/พิมพ์/เลื่อน) → หยุด = ร่างขั้นตอน แก้ได้ → บันทึก · ใช้: ศูนย์งาน → ทักษะ → "ลองรัน" หรือสั่งในแชท "ทำ <ชื่อทักษะ>" · พิกัดในขั้นตอนเป็นสเกล 0–1000 (ตาม hotfix พิกัด) |
| ทีมงาน / มอบหมาย | ศูนย์งาน → ทีมงาน | ส่งเป้าหมายให้ CEO → CEO แตกงานด้วย `message_bot` → กระดานแสดง ผู้ส่ง ➜ ผู้รับ + สถานะ (รับงาน/กำลังทำ/ได้ผลแล้ว) · บอทตั้งนัดติดตามงานเองด้วย `schedule_create` |
| Backup / Export / Audit | ศูนย์งาน → สำรองข้อมูล | สำรองทั้งระบบ (= `rakazo.sh backup`) · ส่งออก JSON ทั้งบริษัท (ไม่มี secret) · Audit CSV ทุกแชท (UTF-8 BOM เปิดใน Excel ได้) |
| เสียงไทย | 🎤 ช่องพิมพ์ / 🔊 ใต้ข้อความบอท | พูด ≤60 วิ → whisper (CPU ~3–9 วิ) → ส่งเอง → คำตอบอ่านออกเสียง (เสียง Windows "Pattara") · ครั้งแรกโหลดโมเดล ~10–30 วิ |
| ระบบบัญชีสาธิต | บอท CEO/จัดซื้อ/ขาย/บัญชี/คลัง | MCP `mcp__demo-accounting__*`: สินค้า ลูกค้า ใบแจ้งหนี้ ลูกหนี้ค้างชำระ ยอดขาย งบทดลอง ออกใบแจ้งหนี้ รับชำระ ซื้อสินค้า · เงินเป็นสตางค์ (ไม่มี float) VAT 7% ปัดครึ่งขึ้น สมุดรายวันแบบเพิ่มอย่างเดียว + idempotency · ข้อมูลเก็บใน `~/rakazo/demo-acct/data.json` (รีสตาร์ตแล้วยังอยู่; ลบไฟล์ = กลับเป็นข้อมูลตั้งต้น) · ทดสอบตัวเอง: `docker exec rakazo-demo-accounting-1 node /demo/server.mjs --selftest` |

## 3c. ผู้ช่วยผู้บริหาร (รอบ 4, 2026-10-01 — โค้ดหลัก `botadmin/ui/assistant.js` + `Company.cs`)
| ฟีเจอร์ | อยู่ตรงไหน | หมายเหตุ |
|---|---|---|
| สรุปงานเช้า | ศูนย์งาน → สรุปเช้า | ตั้งเวลาทุกวัน หรือกด "สรุปตอนนี้" → CEO อ่านงานที่รอ/งานล่าสุด + ลูกหนี้/ยอดขาย (อ่านอย่างเดียว) → ≤12 บรรทัด 📊⚡👥✅ + แจ้งเตือน + 🔊 · รันเฉพาะตอนแอปเปิด (ภายใน 2 ชม. หลังเวลาที่ตั้ง) |
| การ์ดตัดสินใจรวม | ศูนย์งาน → กล่องงาน (มี ≥2 เรื่อง) | Gemma สรุปทุกเรื่อง + แนะนำ อนุญาต/ปฏิเสธ/ตอบเอง → ปุ่ม "ทำตามคำแนะนำ" (ยืนยันก่อน) · โมเดลไม่ว่าง = แสดงข้อความแทน ตอบทีละการ์ดได้ตามปกติ |
| แจ้งเตือนรวม | อัตโนมัติ | เรื่องที่รอเข้ามาใกล้กันรวมเป็นแจ้งเตือนเดียว "N เรื่องรอคุณ" (หน่วง 4–12 วิ) |
| พูดแผนยาวๆ → การ์ดแผน | ศูนย์งาน → ทีมงาน → 🎤 / 🗂 แตกเป็นแผน | พูด/พิมพ์มั่วได้ → การ์ดแก้ได้ (งาน ฝ่าย กำหนดส่ง ทำซ้ำ เวลา) → อนุมัติ: งานครั้งเดียว CEO แจกด้วย `message_bot` · งานซ้ำ = งานประจำ (routine) ของฝ่ายนั้น |
| ตรวจข้อเท็จจริง | 🔎 ใต้ข้อความบอท | บอทผู้ตรวจ (ค่าเริ่มต้น ฝ่ายบัญชี) ตรวจกับระบบบัญชี + ความรู้บริษัท → ป้าย ✅/❌/❓ กดดูหลักฐานได้ |
| ทริกเกอร์ | ศูนย์งาน → ทริกเกอร์ | ใบแจ้งหนี้ใหม่ / รับชำระ / ซื้อเข้า (อ่าน data.json ของระบบบัญชีสาธิต) / ไฟล์ใหม่ใน `D:\localai\inbox` (แนบให้บอท ≤10 MB) → ปลุกบอท **โหมดเฝ้าดู** (อ่าน/ตรวจได้ ห้ามสร้าง/แก้/ส่งเอง) · ตรวจทุก 10 วิ ขณะแอปเปิด · เริ่มนับจากตอนเปิด (ไม่ย้อนประวัติ) |
| สตูดิโอตัวตน | ศูนย์งาน → ตัวตนบอท | อีโมจิ (หน้า title) สี ตำแหน่ง บุคลิก (บล็อกใน instructions) เสียง pitch/rate (เก็บในเครื่อง) · การ์ด PNG ดาวน์โหลดแชร์ได้ |
| คำติ → กฎ | ช่องแชท | พิมพ์ "ต่อไป…ให้ถามก่อน / อย่า…เอง" → แถบเสนอ "ตั้งกฎ" ต้องขออนุญาต (จากเครื่องมือที่บอทเพิ่งใช้ หรือคำสำคัญ เช่น อีเมล ไฟล์ ใบแจ้งหนี้) · ปุ่ม "อนุญาตเสมอ" ถามยืนยันก่อนทุกครั้ง |

op ใหม่ของ host: `llm.ask` (Gemma ตรง, ปิด thinking, ขอ JSON ใน prompt — **ไม่ใช้ `response_format`**) · `acct.events` (อ่าน `\\wsl.localhost\Ubuntu-24.04\home\rakazo\rakazo\demo-acct\data.json`) · `inbox.list` / `inbox.read` (ชื่อไฟล์เปล่าเท่านั้น ≤10 MB)
ข้อจำกัด: `llm.ask` เรียก Gemma ในเครื่องเสมอ — โหมด DeepSeek ไม่ครอบ (การ์ดแผน/การ์ดตัดสินใจใช้ไม่ได้ถ้า llama-server ปิด)

## 3d. ธีมมืด/สว่าง (2026-10-01)
- **BotTeam**: ปุ่ม 🖥 ระบบ / ☀️ สว่าง / 🌙 มืด ใต้ปุ่ม Local/DeepSeek ที่ sidebar · "ระบบ" = ตาม Windows (เปลี่ยนตามทันที) · จำใน localStorage `bt.theme` · title bar + พื้นหลังหน้าต่างตามธีม (จำใน `%LOCALAPPDATA%\BotTeam\theme.txt` เพื่อเปิดครั้งต่อไปไม่กระพริบ) · การ์ด PNG ของบอทตามธีม
- สี: ตัวแปรชุดเดียวใน `ui/app.css` (`:root` = มืด, `:root[data-theme="light"]` = สว่าง) · พื้นโปร่ง/hover ใช้ `rgba(var(--fg-rgb), a)` — **ห้ามเขียน `rgba(255,255,255,…)` หรือสีเข้มตายตัวใหม่** (ยกเว้นตัวอักษรบน avatar สี) · ตรวจด้วย `node tests/theme.mjs` (สแกน contrast ทุกหน้า)
- **ออฟฟิศ 3D**: ปุ่มไอคอนมุมขวาบนของการ์ด "ออฟฟิศบอท" กดวน ระบบ → สว่าง → มืด (localStorage `office.theme` ของเว็บ :3300) · ท้องฟ้าในฉากยังเปลี่ยนตามเวลาจริงกรุงเทพฯ ไม่ขึ้นกับธีม · แก้ CSS/TSX แล้วต้อง `npm --prefix botoffice run build` + รีสตาร์ทเซิร์ฟเวอร์

## 4. Hotfix ที่ต้องรู้ (`~/rakazo/docker-compose.override.yml` + `~/rakazo/hotfix/`)

| ไฟล์ | ทำไม | เอาออกเมื่อ |
|---|---|---|
| web-ssrf.ts, keyless-http-web.ts, undici-fetch.ts | web_search/web_fetch พัง (undici 8 + Node 22) | release ที่มี fix #808 |
| remote-mcp.ts | MCP ระยะไกลพัง | release ที่มี fix #875/#876 |
| computer-tools.ts (+ .orig) | Gemma ชี้พิกัด 0–1000 → แปลงเป็นพิกเซล, รับ args ผิดรูปได้ | เลิกใช้ Gemma หรือ upstream รองรับ |
| pi-openai-compatible-provider.ts (+ .orig) | llama-server ไม่สน `reasoning_effort`; ตั้งเพดานคิด `RAKAZO_GUI_THINKING_BUDGET` (ตอนนี้ 1024) ต่อขั้น computer/browser และปิดคิดจริงเมื่อบอทตั้ง thinking=off | upstream ส่ง chat_template_kwargs ให้ llama.cpp |
| env `RAKAZO_COMPUTER_COORDINATE_GRID=1000` | คู่กับ computer-tools.ts | พร้อมกัน |
| supervisor `RAKAZO_COMPUTER_IMAGE=botteam/computer:v0.1.6-th` | Computer บอทมีฟอนต์ไทย (`~/rakazo/computer-th`) | — ต้อง build ใหม่ทุกครั้งที่เปลี่ยน tag |
| worker+api `SANDBOX_IDLE_MS=2592000000` (30 วัน, ค่าเดิม 10 นาที) | Computer ไม่ปิดเองตอนว่าง (เดิมดับทุก 10 นาที = "ติดๆ ดับๆ") + แอป boot เครื่องที่ดับทุก 60 วิ | อยากประหยัด RAM (9 เครื่อง × ~0.4–3 GB) |
| service `demo-accounting` (`network_mode: service:worker`, โค้ด `~/rakazo/demo-acct/server.mjs`, token `~/rakazo/demo-acct/token` mode 600) | MCP ระบบบัญชีสาธิต — Rakazo เรียก MCP ได้แค่ localhost ของ worker · `rakazo.sh start` สร้างใหม่ถ้า worker ถูกสร้างใหม่ | เลิกใช้ demo บัญชี |

- สร้าง hotfix ใหม่จากไฟล์ต้นฉบับของเวอร์ชันใหม่: `hotfix/*.patch.mjs|py` (อ่าน `.orig.ts` → เขียน `.ts`) — ถ้า patch หา anchor ไม่เจอ แปลว่า upstream เปลี่ยน ต้องตรวจเอง
- ปรับเพดานคิด: แก้ค่าใน override แล้ว `rakazo.sh start` (ผลวัด: 256 → 4,5,0/10 · **1024 → 6,5,5/10 ~90 วิ** · ไม่จำกัด → 0/10 เกิน 15 นาที)
- build ภาพ Computer ไทยใหม่: `cd ~/rakazo/computer-th && docker build -t botteam/computer:v0.1.6-th .` (แก้ `FROM` ให้ตรง tag ใหม่)
- `rakazo.sh start` ต่อ supervisor เข้า network ของบอททุกครั้ง (supervisor ที่ถูกสร้างใหม่จะไม่กลับเข้า network เดิม → computer_act 500)

## 5. อัปเกรด Rakazo (ทำตามเอกสาร Rakazo; ถามก่อนทุกครั้ง)
1. `rakazo.sh backup`
2. อ่าน release notes: fix #808/#875/#876/#881 เข้าแล้วหรือยัง → ถอดบรรทัด hotfix ที่ไม่ต้องใช้ออกจาก override
3. แก้ `RAKAZO_IMAGE_TAG` และ `RAKAZO_COMPUTER_IMAGE_TAG` ใน `~/rakazo/.env`, build computer-th ใหม่ (FROM tag ใหม่), แก้ tag ใน override
4. `docker compose --env-file .env -f docker-compose.images.yml -f docker-compose.override.yml pull` แล้ว `rakazo.sh start`
5. ทดสอบตามข้อ 8

**Rollback:** คืนค่า tag เดิมใน `.env`/override → `rakazo.sh start`; ถ้า migration ของเวอร์ชันใหม่แก้ฐานข้อมูลไปแล้ว ให้กู้คืนจาก backup (ข้อ 6)

## 6. Backup / Restore
- `rakazo.sh backup` (หรือปุ่มในแอป ศูนย์งาน → สำรองข้อมูล) → `D:\localai\backups\rakazo-<วันเวลา>\` = `rakazo.dump` (pg_dump) + `appdata.tgz` (home บอท/ไฟล์) + override + hotfix + `demo-acct` (ขนาดราว 600 MB, 2026-10-01)
- ไฟล์ backup มีข้อมูลบอทและ secret ที่เข้ารหัส — เก็บในเครื่อง ห้ามแชร์
- ทดสอบกู้คืนแล้ว (2026-09-30): pg_restore เข้าฐานทดลอง จำนวนบอทตรงกัน 68/68
- กู้คืนจริง (ระบบหยุดก่อน):
  ```bash
  cd ~/rakazo && bash /mnt/d/localai/botadmin/rakazo.sh stop
  dc() { docker compose --env-file .env -f docker-compose.images.yml -f docker-compose.override.yml "$@"; }
  dc up -d --wait postgres
  docker exec -i rakazo-postgres-1 pg_restore -U rakazo -d rakazo --clean --if-exists < /mnt/d/localai/backups/<ชุด>/rakazo.dump
  docker run --rm -v rakazo_appdata:/data -v /mnt/d/localai/backups/<ชุด>:/in:ro busybox:1 sh -c 'rm -rf /data/* && tar xzf /in/appdata.tgz -C /data'
  bash /mnt/d/localai/botadmin/rakazo.sh start
  ```

## 7. แก้ปัญหา

| อาการ | สาเหตุที่พบจริง | ทางแก้ |
|---|---|---|
| บอทตอบ "Request timed out" / LLM ช้ามาก (~6 tok/s จากปกติ ~66) | VRAM เต็ม มีแอปอื่นใช้ GPU (เช่น Snipping Tool ขณะอัดจอกิน ~12 GB) โมเดลล้นไป RAM | ปิดแอปนั้น → Monitor ในแอป กด restart LLM; ดู VRAM ด้วย `nvidia-smi` |
| บอท "กำลังทำงาน…" ค้างนาน, LLM /health ok แต่ Monitor ไม่ขึ้นตัวเลข | llama-server ค้างกลาง decode (bug llama.cpp #27388/#21375 ยังไม่มี fix, เจอ 2 ครั้ง 2026-09-30) | BotTeam มี watchdog: /metrics ไม่ตอบ 3 นาที → restart LLM อัตโนมัติ + เก็บ log เป็น `logs\llama-server.wedged-<เวลา>.log`; run ที่ค้างจะล้ม ให้ส่งใหม่ |
| computer_act ได้ 500 "fetch failed" | supervisor ถูกสร้างใหม่แล้วไม่อยู่ใน network ของบอท | `rakazo.sh start` |
| computer_act ได้ 500 "unsupported computer action" | บอทเรียก `open_path`/`launch_app` ซึ่ง Computer แบบ docker ไม่รองรับ | ไม่ต้องแก้ (บอทควรเปลี่ยนวิธีเอง) |
| เว็บไทยในจอบอทเป็นกล่อง | ใช้ image computer ที่ไม่มีฟอนต์ไทย | ตรวจ `RAKAZO_COMPUTER_IMAGE` ใน override |
| WSL ดับเองหลัง ~15 วิ | ไม่มี keep-alive | เปิดผ่าน BotTeam หรือ `botteam.ps1 start` |
| web_search/web_fetch พัง "invalid onRequestStart" | override ไม่ถูกโหลด | `rakazo.sh start` (โหลด override อัตโนมัติ) |
| ออฟฟิศ 3D ตอบ 403 | เปิดผ่านชื่อ host อื่น / POST ข้ามเว็บ | เปิดที่ http://127.0.0.1:3300 เท่านั้น |
| llama-server ค้าง "Loading model" นาน / Event Viewer มี nvlddmkm 14/153 | ไดรเวอร์ GPU ล่ม (TDR) กลางงาน — CUDA context ค้าง รีสตาร์ท llama อย่างเดียวไม่หาย | ปิดแอปที่ใช้ GPU แล้วรีสตาร์ท llama 1 ครั้ง · ไม่หาย = รีสตาร์ท Windows (ขออนุมัติผู้ดูแลเครื่องก่อน) |

log: `rakazo.sh logs api|worker|supervisor`, `D:\localai\logs\llama-server.log`, `D:\localai\logs\botoffice.log`

## 8. ชุดทดสอบ (รันซ้ำได้; แอปต้องเปิดด้วย `BotAdmin.exe --devtools-port 9223`)

บอททดสอบ Bot A/B เก็บแบบ archive: ชุดทดสอบยืมมาใช้ (`borrowBot` ใน `tests/cdp.mjs` = restore → ใช้ → archive คืน) รายชื่อบอทจริงจึงเหลือ 5 ตัวเสมอ; ชื่อบอทที่ active อยู่ (เช่น `CEO`) ใช้ได้โดยไม่ถูก archive

| สคริปต์ (`D:\localai\botadmin\tests`) | ตรวจอะไร | ผลล่าสุด |
|---|---|---|
| `node e2e.mjs` | สร้างบอท/ห้อง แชท ขั้นตอนเครื่องมือ คำตอบ | 14/14 |
| `node approval.mjs` | การ์ดอนุมัติไทย + รออนุมัติ + ปฏิเสธแล้วไม่ทำจริง | 6/6 |
| `node takeover.mjs` | บอทขอให้ช่วยบนจอ/ถามกลับ → ปุ่มให้บอททำต่อ, พิมพ์ "ทำต่อ", พิมพ์ตอบคำถาม, กดตัวเลือก ทุกทางทำงานต่อได้ | 20/20 |
| `node work.mjs` | ศูนย์งาน: ตอบคำถามบอทจากกล่องรอคุณ, กิจกรรม, ตั้ง/เปิด/รัน/ลบงานประจำ, สอนความจำแล้วบอทใช้จริง, ลืมทั้งหมด (คืนค่าความจำ/งานประจำของ Bot A ให้เอง) | 19/19 |
| `node extra.mjs` | 9 บอท, ผลงาน+พรีวิว (รวมไฟล์ในห้องรวม), ชิปไฟล์ในแชท, ค่าใช้จ่ายตรงกับ summary, ห้องควบคุม (ทุกบอท/จอสด/พอดีหน้า/คลิกเข้าแชท), ค้นหาไทย+ไฟล์ — ไม่ใช้ LLM | 16/16 |
| `node mcp.mjs` | เพิ่ม MCP + บอทใช้เครื่องมือ MCP | 6/6 |
| `node phase3.mjs` | Bot A/B เครื่องแยกกัน มองไม่เห็นไฟล์กัน ทำงานพร้อมกัน write_file รออนุมัติ | 14/14 |
| `node round3.mjs` | รอบ 3 ไม่ใช้ LLM: แท็บใหม่, กฎอนุมัติ, ความรู้บริษัท+นำเข้าไฟล์, แนบไฟล์ (.exe ถูกปฏิเสธ), แจ้งเตือน, เสียงพูด+whisper, สอนงาน (คลิก/พิมพ์ → ขั้นตอน, พิกัด 0–1000), ทีมงาน, export/audit/backup (คืนกฎ/ความรู้/ทักษะให้เอง) | 26/26 |
| `node round3-llm.mjs` | รอบ 3 กับ LLM จริง: บอทตอบจากความรู้บริษัท, อ่านไฟล์แนบ, ดึงลูกหนี้จากระบบบัญชี, กฎอนุมัติหยุดการออกใบแจ้งหนี้ → อนุญาต → ออกครั้งเดียว งบทดลองยังสมดุล, Bot A ส่งงาน Bot B (ลูกศรในห้องควบคุม + กระดานทีมงาน), วงจรเสียง | 15/15 (~12 นาที, Gemma local) |
| `node round4.mjs` | รอบ 4 ไม่ใช้ LLM: แท็บใหม่, สตูดิโอตัวตน (คลิกจริง→bots/update, อีโมจิ, เสียง, การ์ด PNG), ทริกเกอร์ (ใบแจ้งหนี้จริง + ไฟล์ inbox → ข้อความโหมดเฝ้าดู), คำติ→กฎ (จำลอง + แชทจริง), ยืนยันอนุญาตเสมอ, อนุมัติแผน→routine, การ์ดตัดสินใจตอนโมเดลไม่ว่าง · คืน book/กฎ/บอท | 33/33 (2026-10-01) |
| `node round4-llm.mjs` | รอบ 4 กับ LLM: 2 เรื่องรอ→แจ้งเตือนเดียว+การ์ดสรุป+ทำตามคำแนะนำ, อนุญาตเสมอบนการ์ดจริง, ตรวจข้อเท็จจริง (ข้อความเท็จ→❌), ทริกเกอร์โหมดเฝ้าดู (บอทไม่เขียน book), ไมค์→แผน→การ์ด→routine, สรุปเช้า CEO · ออก exit 2 ถ้า LLM ยังไม่พร้อม | 21/21 (2026-10-01) |
| `node theme.mjs` | ธีม: ปุ่ม 3 แบบ, สว่าง/มืดเปลี่ยน token + title bar + ไฟล์จำธีม, "ระบบ" ตาม Windows (จำลอง prefers-color-scheme), 8 หน้าในธีมสว่าง + กล่องงานธีมมืด ไม่มีตัวอักษร contrast < 3, การ์ด PNG ตามธีม · ภาพที่ `D:\tmp\theme-*.png` | 18/18 (2026-10-01) |
| `node cu.mjs "<งาน>" "Bot A"` | บอทคุมเมาส์/คีย์บอร์ดเอง | www.bcaccount.com 9 วิ (2026-10-01; บอทเลือกใช้ browser tool) |
| `node cubench.mjs rules` | 10 ภารกิจ (คลิก พิมพ์ไทย/อังกฤษ dropdown ดับเบิลคลิก ลาก Enter ปุ่มจิ๋ว เลื่อนหน้า) ตรวจด้วยรหัสบนจอ | 5–6/10, ~90 วิ |
| `node botoffice\tests\office.mjs 9333` | ออฟฟิศ 3D: เดินไม่ทะลุ/ไม่ชน ฟิสิกส์ลูกบอล ประชุม (ต้อง `npm run dev` + Edge `--headless=new --remote-debugging-port=9333` แล้วเปิดหน้า: `curl -X PUT "http://127.0.0.1:9333/json/new?http://127.0.0.1:3300"`; เสร็จแล้ว `botteam.ps1 start` คืน production) | 11/11 (5 บอท ประชุม 5/5) |

## 9. ขีดความสามารถ (วัดบนเครื่องนี้ RTX 5060 Ti 16 GB, 2026-09-30)
- LLM: 2 งานพร้อมกัน (`-np 2`, context รวม 65,536); งานที่ 3 ขึ้นไปต่อคิวใน llama-server เอง (run ของบอทอยู่ในคิว graphile-worker ของ Rakazo อีกชั้น ไม่ต้องทำคิวเพิ่ม) — คอขวดหลักของทั้งระบบ; แถบ Monitor ในแอปแสดง "🧠 n กำลังคิด · n รอคิว"
- ความเร็ว: generate ~66 tok/s, อ่าน prompt ~1,100–2,500 tok/s; ภาพหน้าจอเข้ารหัสบน CPU ~6.7 วิ/ภาพ (VRAM ไม่พอย้ายขึ้น GPU)
- Computer use: ~5 วิ/ขั้น (หลัง hotfix เพดานคิด; เดิม ~27 วิ); งานเว็บ 10 ข้อ ~90 วิ ทำสำเร็จ 5–6 ข้อ
- เครื่องบอท: 2 CPU / 3 GB ต่อเครื่อง; WSL มี RAM 80 GB → เปิดพร้อมกันได้หลายเครื่อง แต่ LLM รับได้ 2 งานพร้อมกัน
- VRAM ใช้ ~15.5/16 GB ตลอด — แอปอื่นที่ใช้ GPU (อัดจอ เกม WebGL) ทำให้ LLM ช้าลงราว 10 เท่า

## 10. ข้อจำกัดและความเสี่ยงที่ควรรู้
1. ลิงก์หน้าจอ Computer ของบอทเป็น capability token — ห้ามแชร์
2. Gemma มีข้อจำกัด: หยุดงานกลางทาง รายงานเกินจริง/อ้างว่าเครื่องมือเสียทั้งที่ไม่เสีย, กะพิกัดแกน Y พลาด 80–150 px → ตรวจงานสำคัญเอง; โมเดล GUI เฉพาะทาง (เช่น Holo) ต้องดาวน์โหลด
3. บอทตัวอย่างใช้ Computer `team` ร่วมกัน — งานพร้อมกันบนเครื่องเดียวกันอาจชนกัน
4. Hotfix ผูกกับ v0.1.6 — อัปเกรดแล้วต้องทบทวนตามข้อ 4 ทุกครั้ง; stdio MCP ยังไม่เปิด (เสี่ยงรันคำสั่งบนเครื่อง)
5. โหมด DeepSeek ส่งแชท ผลเครื่องมือ และภาพหน้าจอของบอทออกไปที่ DeepSeek (cloud) — ใช้กับข้อมูลตัวอย่างเท่านั้น
6. Computer เปิดค้างตลอด 9 เครื่อง — กิน RAM ของ WSL ตลอดเวลา (ปิดสวิตช์ในห้องควบคุม + ลด `SANDBOX_IDLE_MS` ถ้าต้องการคืน RAM)
7. กฎอนุมัติมีผลทุกบอท ไม่มีกฎรายบอท/ห้ามเด็ดขาด — งานเสี่ยงให้ตั้ง "ต้องขออนุญาต" แล้วกดปฏิเสธเอง
