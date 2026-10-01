# ไฟล์ตั้งค่าและ hotfix ของ Rakazo

ไฟล์ในโฟลเดอร์ `hotfix/` มาจาก [Rakazo](https://github.com/elie222/rakazo) v0.1.6 ซึ่งใช้สัญญาอนุญาต Apache License 2.0 (สำเนาอยู่ที่ `LICENSE-rakazo`)

- `*.orig.ts` = ไฟล์ต้นฉบับของ Rakazo v0.1.6 ไม่ได้แก้ (ใช้เป็นฐานให้สคริปต์ patch)
- `*.patch.py` / `*.patch.mjs` = สคริปต์ที่อ่าน `.orig.ts` แล้วเขียนไฟล์ที่แก้แล้ว
- ไฟล์ `.ts` อื่น ๆ = ไฟล์ของ Rakazo ที่**ถูกแก้ไข**แล้ว ดังนี้

| ไฟล์ | สิ่งที่แก้ |
|---|---|
| `web-ssrf.ts`, `keyless-http-web.ts`, `undici-fetch.ts` | ให้ web_search / web_fetch ใช้งานได้ (undici 8 + Node 22 ชนกัน, upstream #808) |
| `remote-mcp.ts` | ให้ MCP ระยะไกลเชื่อมต่อได้ (upstream #875/#876) |
| `computer-tools.ts` | แปลงพิกัดคลิกสเกล 0–1000 ของ Gemma เป็นพิกเซล และรับ argument ที่รูปแบบเพี้ยนได้ |
| `pi-openai-compatible-provider.ts` | ตั้งเพดานการคิดของโมเดลต่อขั้น computer/browser และปิดการคิดเมื่อบอทตั้ง thinking=off (llama-server ไม่รองรับ `reasoning_effort`) |

`docker-compose.override.yml` เมานต์ไฟล์เหล่านี้ทับของเดิมในคอนเทนเนอร์ (ใช้กับ v0.1.6 เท่านั้น — อัปเกรด Rakazo แล้วต้องทบทวนใหม่)
`computer-th/Dockerfile` = ภาพเครื่องของบอทที่เพิ่มฟอนต์ไทย
