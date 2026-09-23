# System Blueprint — lineaibot (LINE HR Chatbot)

> เอกสารนี้สรุปสถาปัตยกรรม การทำงาน และสถานะปัจจุบันของระบบ ทั้งหมด ไว้สำหรับผู้พัฒนา (หรือ AI) ที่จะเข้ามาต่อยอดในอนาคต อ่านไฟล์นี้ก่อนแก้โค้ดทุกครั้ง
>
> Repo: `hrnep2013-art/lineaibot` (branch `main`, auto-deploy ขึ้น Vercel ทุกครั้งที่ push)
> อัปเดตล่าสุด: ก.ย. 2569 หลังเพิ่มฟีเจอร์ Gemini File Search

---

## 1. System Architecture

| องค์ประกอบ | รายละเอียด |
|---|---|
| Framework | Next.js `14.2.35` (App Router, ไม่ใช้ Pages Router) |
| ภาษา | TypeScript (`typescript ^5`), React `^18` |
| Runtime | Node.js (Vercel Serverless Functions ค่า default ของ App Router route handler — ไม่มี route ไหน `export const runtime = "edge"`) |
| Package manager | npm (มี `package-lock.json` — ใช้ `npm install` เท่านั้น อย่าสลับไป yarn/pnpm) |
| Hosting/Deploy | Vercel — เชื่อมต่อ GitHub repo นี้โดยตรง push เข้า `main` = auto-build ขึ้น Production ทันที |
| Vercel plan | Hobby — ยืนยันจาก log จริงว่า `maxDuration` ใช้ได้ถึง 30s (ดู Known Constraints ข้อ 11) |
| LINE SDK | `@line/bot-sdk ^11.2.0` — ใช้ `messagingApi.MessagingApiClient`, `validateSignature`, `webhook.Event` (โครงสร้าง SDK v11 ต่างจาก v10 ลงมาพอสมควร ระวังเวลาดู example เก่า) |
| AI SDK | `@google/genai ^2.21.0` — ใช้ `GoogleGenAI`, `ai.models.generateContent`, `ai.fileSearchStores.*` |
| Background task | `@vercel/functions` (`waitUntil`) — ใช้ให้ `logConversation()` ทำงานเบื้องหลังไม่บล็อก response |
| AI Model | `gemini-3.5-flash` (hardcode ไว้ใน `lib/gemini.ts`) |
| External services | (1) LINE Messaging API — webhook + reply (2) Google Gemini API — ตอบคำถาม + File Search RAG (3) Google Sheets — แหล่ง FAQ แบบ publish-to-web CSV |
| Data store | **ไม่มีฐานข้อมูลจริง** ดูรายละเอียดในหัวข้อ 3 |

### โครงสร้างไฟล์หลัก
```
app/
  api/
    line-webhook/route.ts      ← endpoint หลักที่ LINE ยิงเข้ามา
    admin/
      setup-store/route.ts     ← สร้าง File Search store (ทำครั้งเดียว)
      upload-doc/route.ts      ← อัปโหลด PDF เข้า store
  admin/upload/page.tsx        ← หน้าเว็บแอดมิน (รหัสผ่าน + อัปโหลด)
  page.tsx, layout.tsx         ← หน้าแรกเปล่าๆ ไว้เช็คว่า deploy สำเร็จ
lib/
  gemini.ts                    ← เรียก Gemini API (chat + file search tool)
  genai-client.ts              ← GoogleGenAI client กลาง (ใช้ร่วมกันทุกที่)
  prompt.ts                    ← ประกอบ system instruction ทั้งหมด
  sheet.ts                     ← ดึง+parse FAQ จาก Google Sheet CSV
  regulations.ts                ← ความรู้ระเบียบที่สรุปไว้เป็น text คงที่ (7 ฉบับ ณ ตอนนี้)
  constants.ts                  ← ข้อความ fallback (DEFAULT_REPLY)
  log.ts                        ← ส่ง log คำถาม-คำตอบไปยัง Google Sheet (ถ้าตั้งค่าไว้)
  quick-replies.ts              ← ปุ่มลัด (quick reply) + ข้อความต้อนรับตอนเพิ่มเพื่อน
docs/
  apps-script-logger.gs        ← โค้ดอ้างอิงสำหรับวางใน Google Apps Script (ฝั่งรับ log)
```

---

## 2. Webhook & Routing Flow

Endpoint เดียว: `POST /api/line-webhook` — ลำดับการทำงานเต็มๆ:

1. **รับ request** — อ่าน raw body เป็น text (`req.text()`) และ header `x-line-signature`
2. **ตรวจลายเซ็น** — `validateSignature(rawBody, LINE_CHANNEL_SECRET, signature)` ถ้าไม่ผ่าน → ตอบ `401` ทันที ไม่ประมวลผลต่อ (นี่คือจุดที่เคย crash เป็น 500 ตอน `LINE_CHANNEL_SECRET` เป็น `undefined` — ดู Known Constraints)
3. **parse JSON** เป็น `{ events: webhook.Event[] }` แล้ววิ่ง `Promise.all(events.map(handleEvent))` พร้อมกันทุก event
4. **ต่อ event หนึ่งอัน (`handleEvent`)**:
   - ถ้าเป็น `event.type === "follow"` (มีคนเพิ่มบอทเป็นเพื่อน/ปลดบล็อก) → ตอบ `WELCOME_MESSAGE` พร้อมปุ่ม quick reply ทันที แล้ว `return` ไม่ทำขั้นตอนถัดไป
   - ข้ามทันทีถ้าไม่ใช่ text message หรือไม่มี `replyToken`
   - ตั้ง `replyText = DEFAULT_REPLY` ไว้ก่อนเป็นค่าเริ่มต้น (safety net)
   - **try block:**
     a. `getFaqList()` — ดึง FAQ จาก Sheet (cache 60 วิ)
     b. `buildSystemInstruction(faqList)` — ประกอบพรอมต์เต็ม (role + constraints + current_date + faq + regulations)
     c. **เรียก Gemini แบบ 2 รอบ (two-pass)**:
        - **รอบที่ 1** — `askGemini(..., useFileSearch=false)` ไม่เปิด File Search timeout 10s (เร็ว ครอบคลุม FAQ+regulations.ts ซึ่งเป็นกรณีส่วนใหญ่)
        - **รอบที่ 2** — เปิดเฉพาะตอนรอบแรก "หาไม่เจอ" (ตอบสำเร็จแต่ข้อความว่าง/`MAX_TOKENS`/ตรงกับ `DEFAULT_REPLY` เป๊ะๆ) **หรือรอบแรกล้มเหลว/timeout ไปเลยก็ตาม** (แก้เพิ่มเติม 23 ก.ย. 2569 — เดิมถ้ารอบแรก timeout จะยอมแพ้ทันทีไม่ลองรอบ 2 เลย) และมี `GEMINI_FILE_SEARCH_STORE` ตั้งไว้ → เรียกซ้ำพร้อมเปิด `fileSearch` tool timeout 16s
        - เหตุผลที่แยก 2 รอบ (ไม่เปิด tool ทุกครั้งเหมือนก่อนหน้านี้): พบจริงในการใช้งานว่าแค่ "มี tool ให้เลือก" ก็ทำให้โมเดลเผื่อคิดเรื่องค้นหาทุกข้อความ กินโทเค็น thinking จนชนเพดาน (`MAX_TOKENS`) แม้คำถามจะตอบได้จาก regulations.ts อยู่แล้วก็ตาม บางครั้งหนักถึงขั้นรวมเวลาทั้ง request เกิน 30s โดน Vercel hard-kill (504) — ดู Known Constraints
        - ภายใน `askGemini`: `thinkingLevel: MEDIUM` เสมอ, `maxOutputTokens` = 2048 ตอนไม่เปิด tool / **8192** ตอนเปิด tool (ให้ budget เผื่อโทเค็นคิดเรื่องค้นหาที่มากกว่าปกติมาก), พรอมต์บังคับให้ค้นเอกสารแค่ **1 ครั้งต่อคำถามเท่านั้น** ห้ามวนค้นหลายรูปแบบ (กันโมเดลเสียโทเค็นคิดกับการค้นซ้ำหลายรอบ), ดึง citation (ชื่อไฟล์/เลขหน้า) จาก `groundingMetadata.groundingChunks[].retrievedContext` กลับมาด้วย
     d. ถ้า `finishReason === "MAX_TOKENS"` หรือข้อความว่าง → ใช้ `DEFAULT_REPLY` แทน ไม่งั้นใช้คำตอบจริง + ต่อท้ายด้วย `(อ้างอิงจากเอกสาร: ...)` ถ้ามี citation — ทุกคำตอบ (รวม fallback) จะแนบปุ่ม quick reply (`lib/quick-replies.ts`) ไปด้วยเสมอ
   - **catch block:** error อะไรก็ตามในขั้นตอนบน (sheet fetch พัง, Gemini error, timeout ทั้ง 2 รอบ ฯลฯ) → log แล้วใช้ `DEFAULT_REPLY`
   - **try/catch ที่สอง:** เรียก `client.replyMessage({replyToken, messages: [...]})` ส่งข้อความจริงกลับ LINE — ถ้าขั้นนี้ fail (เช่น token หมดอายุ) จะแค่ log error เงียบๆ **ผู้ใช้จะไม่ได้รับคำตอบเลยโดยไม่มีการแจ้งเตือนใดๆ** (ดู Known Constraints ข้อ 6 ที่เกี่ยวข้อง)
   - **หลังตอบ LINE เสร็จ:** เรียก `logConversation()` (`lib/log.ts`) ผ่าน **`waitUntil()`** (จาก `@vercel/functions`) ไม่ใช่ `await` ตรงๆ — response จะถูกส่งกลับทันทีที่ reply เสร็จ ไม่ต้องรอ log (Apps Script Web App บางครั้งตอบช้า เคยทำให้ฟังก์ชันรวมเกิน 30s มาแล้วตอนยังใช้ `await`)
5. **ตอบ LINE** ด้วย `{status: "ok"}` (LINE ไม่สนใจ body นี้ ขอแค่ status 200)

---

## 3. Database Schema / Data Structure

**ระบบนี้ไม่มีฐานข้อมูลแบบดั้งเดิม (ไม่มี SQL/NoSQL)** ใช้ 3 แหล่งความรู้คู่ขนานกัน:

### 3.1 FAQ — Google Sheet (CSV)
ดึงสดทุกครั้งจาก `SHEET_CSV_URL`, cache ในหน่วยความจำ 60 วิ (`lib/sheet.ts`)

คอลัมน์ที่ต้องมีในหัวตาราง (เรียงแบบไหนก็ได้ แต่ชื่อต้องตรง):
```
id, category, question, keywords, answer, is_active
```
Parse เป็น `FaqItem { id, category, question, keywords, answer, isActive }`
- แถวที่ผ่านการกรอง (ใช้จริง): ต้องมีทั้ง `question` และ `answer` ไม่ว่าง และ `is_active` ≠ "FALSE"
- **`keywords` และ `category` ถูก parse เก็บไว้แต่ยังไม่ถูกใช้งานจริง** — ตอนประกอบพรอมต์ (`lib/prompt.ts`) ดึงมาแค่ `question`+`answer` เท่านั้น เอา FAQ ทุกแถวที่ active ยัดเข้าพรอมต์ทั้งหมด ไม่มีการกรองตามความเกี่ยวข้อง

### 3.2 Regulations — hardcoded text (`lib/regulations.ts`)
ค่าคงที่ `REGULATIONS_KNOWLEDGE` เป็น string ยาวเดียว สรุปโดยมนุษย์/AI จาก PDF ต้นฉบับ ฉีดเข้าพรอมต์เต็มทุกครั้ง ปัจจุบันมี 7 ฉบับ:
1. ระเบียบสำนักนายกฯ ว่าด้วยการลาของข้าราชการ พ.ศ. 2555
2. ประกาศคณะกรรมการบริหารพนักงานราชการ เรื่อง สิทธิประโยชน์ของพนักงานราชการ พ.ศ. 2554
3. ระเบียบสำนักนายกฯ ว่าด้วยพนักงานราชการ พ.ศ. 2547
4. ประกาศ พก. เรื่อง หลักเกณฑ์ประเมินผลพนักงานราชการทั่วไป (3 ก.พ. 2569)
5. ประกาศ พก. เรื่อง หลักเกณฑ์ประเมินผลข้าราชการพลเรือนสามัญ (3 ก.พ. 2569)
6. ระเบียบ พก. ว่าด้วยการจัดสวัสดิการ (ฉบับที่ 2) พ.ศ. 2568
7. ประกาศ พก. เรื่อง แนวทางปฏิบัติการลงเวลาปฏิบัติราชการ

### 3.3 File Search store (RAG) — Google-managed
Vector store ฝั่ง Google (`fileSearchStores/xxxxx`) เก็บชื่อไว้ใน env var `GEMINI_FILE_SEARCH_STORE` อัปโหลด PDF ผ่าน `/admin/upload` → Google จัดการ chunking/embedding/indexing เองทั้งหมด แอปนี้**ไม่เก็บสำเนาไฟล์ PDF ไว้เอง** อ้างอิงแค่ชื่อ store ตอนเรียก `generateContent` เท่านั้น

### 3.4 Log — Google Sheet (ผ่าน Apps Script)
`lib/log.ts` ส่ง `{question, answer, wasFallback, hadCitation}` เป็น POST JSON ไปยัง `LOG_SHEET_WEBHOOK_URL` (Apps Script Web App, โค้ดอ้างอิงอยู่ที่ `docs/apps-script-logger.gs`) ทุกครั้งหลังตอบ LINE เสร็จ Apps Script จะ append แถวใหม่ลงชีตชื่อ "Logs" (สร้างอัตโนมัติถ้ายังไม่มี) คอลัมน์: `timestamp, question, answer, was_fallback, had_citation` ป้องกันด้วยรหัสลับ (`LOG_SHEET_SECRET` ต้องตรงกับ `SECRET` ที่ hardcode ไว้ในตัว Apps Script เอง) — ถ้าไม่ได้ตั้ง `LOG_SHEET_WEBHOOK_URL` ระบบจะข้ามการบันทึกเงียบๆ ไม่กระทบการทำงานหลัก

### 3.5 อื่นๆ
- cache ใน `lib/sheet.ts` อยู่ระดับ module-level ในหน่วยความจำ ไม่ persist ข้าม instance/cold start

---

## 4. Environment Variables

**ชื่อตัวแปรทั้งหมดที่ระบบต้องใช้ (ห้ามใส่ค่าจริงในเอกสารนี้หรือที่ไหนก็ตามที่ commit เข้า git)**

ตั้งได้ที่ Vercel → Project Settings → Environment Variables (ต้องเลือก Production เป็นอย่างน้อย และ **Redeploy ทุกครั้งที่เพิ่ม/แก้ค่า** ถึงจะมีผล)

| ชื่อตัวแปร | ใช้ทำอะไร | จำเป็นไหม |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | เรียก LINE Messaging API เพื่อส่งข้อความตอบกลับ | จำเป็น |
| `LINE_CHANNEL_SECRET` | ตรวจสอบลายเซ็น webhook ว่ามาจาก LINE จริง | จำเป็น |
| `GEMINI_API_KEY` | เรียก Google Gemini API (ตอบคำถาม + File Search) | จำเป็น |
| `SHEET_CSV_URL` | ลิงก์ CSV ของ Google Sheet ที่เก็บ FAQ | จำเป็น |
| `ADMIN_UPLOAD_SECRET` | รหัสผ่านป้องกันหน้า `/admin/upload` และ API เบื้องหลัง | จำเป็นถ้าจะใช้ File Search |
| `GEMINI_FILE_SEARCH_STORE` | ชื่อ File Search store (`fileSearchStores/xxxxx`) — ได้มาจากการกด "สร้าง Store" ครั้งแรก | ไม่บังคับ — ถ้าไม่ตั้ง บอททำงานแบบเดิมได้ปกติ (ไม่มี File Search) |
| `LOG_SHEET_WEBHOOK_URL` | Apps Script Web App URL สำหรับบันทึก log คำถาม-คำตอบลง Google Sheet | ไม่บังคับ — ถ้าไม่ตั้ง จะไม่มีการบันทึก log |
| `LOG_SHEET_SECRET` | รหัสลับที่ต้องตรงกับตัวแปร `SECRET` ใน Apps Script (`docs/apps-script-logger.gs`) | จำเป็นถ้าจะใช้ logging |

---

## 5. Known Constraints / Technical Debts

1. **FAQ ไม่มีการกรองตามความเกี่ยวข้อง** — ทุกแถวที่ active ถูกยัดเข้าพรอมต์ทุกครั้งไม่ว่าคำถามจะเรื่องอะไร คอลัมน์ `keywords`/`category` มีอยู่แต่ไม่ได้ใช้งาน ถ้า Sheet โตมากจะกินโทเค็น/ค่าใช้จ่าย/latency มากขึ้นเรื่อยๆ
2. **`regulations.ts` เป็น text คงที่ที่ต้องแก้โค้ด + push ทุกครั้ง** ต่างจาก FAQ Sheet และ File Search ที่แก้ได้โดยไม่ต้อง deploy ใหม่ มีความเสี่ยงเรื่องการสรุป/ตีความผิดจากต้นฉบับ (เคยเจอจริง: OCR อ่านวันที่ผิดจาก "๑๐" เป็น "๙๐" ในรอบก่อน แก้ไขแล้ว)
3. **Cache ของ FAQ (60 วิ) อยู่แค่ระดับ instance เดียว** ไม่ใช่ cache กลางที่แชร์กันทุก serverless instance
4. **Logging เป็นแบบ opt-in ผ่าน Google Sheet เท่านั้น** (ดูหัวข้อ 3.4) ไม่ใช่ระบบ analytics ที่มี dashboard สรุปให้ ต้องเปิดสเปรดชีตเองเพื่อดู ไม่มีการแจ้งเตือนอัตโนมัติเมื่อคำถามตกไปเป็น fallback บ่อยผิดปกติ, การเขียนแบบ `sheet.appendRow()` ผ่าน Apps Script ก็ไม่ได้ออกแบบมารองรับ traffic สูงมาก (ดูตัวเลือกอื่นในหัวข้อ Roadmap ถ้าจำเป็นต้องขยาย)
5. **คำตอบเชิงคำนวณ (อายุงาน/สิทธิลาตามวันบรรจุ) ยังเป็นการอนุมานของ LLM** แม้จะบังคับให้อิงตัวเลขจากระเบียบจริงเท่านั้นและต้องแนบคำแนะนำให้เช็ค HR ทุกครั้ง แต่ก็ไม่ใช่การการันตีความถูกต้อง 100% ควรสุ่มตรวจคำตอบกลุ่มนี้เป็นระยะ
6. **ระบบยืนยันตัวตนของ `/admin/*` เป็นรหัสผ่านเดียวแบบธรรมดา** ไม่ timing-safe comparison, ไม่มี rate limit, ไม่มี audit log ว่าใครอัปโหลดอะไรเมื่อไหร่ เหมาะกับทีมเล็กที่ไว้ใจกันเท่านั้น ห้ามแชร์ลิงก์ `/admin/upload` ออกนอกหน่วยงาน
7. **File Search ยังไม่มีระบบจัดการเอกสารซ้ำ/เวอร์ชัน** — อัปโหลด PDF ฉบับแก้ไขใหม่ จะเป็นการ "เพิ่ม" เอกสารใหม่เข้า store ไม่ใช่แทนที่ของเดิม เอกสารเก่ากับใหม่จะถูกค้นเจอพร้อมกันทั้งคู่ ยังไม่มี UI ให้ลบ/ดูรายการเอกสารที่อัปโหลดไปแล้ว
8. **เคยเจอจริง (13 ก.ย. 2569): เปิด File Search ทุกข้อความทำให้ thinking กินโทเค็นจนตอบไม่จบ + บาง request โดน Vercel hard-kill ที่ 30s (504)** — สาเหตุคือแค่ "มี fileSearch tool ให้เลือก" ก็ทำให้โมเดลเผื่อคิดเรื่องค้นหาทุกครั้ง แม้คำถามจะตอบได้จาก regulations.ts อยู่แล้ว (เจอเคส `thoughtsTokenCount: 1967` จาก budget 2048 ทั้งที่ `groundingSourceCount: 0` คือค้นแล้วไม่เจออะไรเลย) **แก้แล้ว**ด้วยสถาปัตยกรรม 2 รอบ (two-pass): รอบแรกไม่เปิด tool (เร็ว, timeout 10s), เปิด tool เฉพาะรอบสองตอนรอบแรกหาไม่เจอเป๊ะๆ เท่านั้น (timeout 16s, maxOutputTokens ยกเป็น 8192, บังคับในพรอมต์ให้ค้นแค่ 1 ครั้งไม่วนค้นหลายรอบ) และย้าย `logConversation()` ไปใช้ `waitUntil()` แทน `await` ตรงๆ กันไปแย่งเวลากับ critical path — **ความเสี่ยงนี้ยังไม่ได้หมดไปทั้งหมด** ยิ่งอัปโหลดเอกสารเข้า File Search เยอะขึ้นเรื่อยๆ ในอนาคต โอกาสที่รอบสองจะกินโทเค็นจนชนเพดานอีกก็มีสูงขึ้นตามไปด้วย (ทั้งจากการคิดเรื่องค้นหาที่ซับซ้อนขึ้น และจากเนื้อหาที่ค้นเจอจริงที่นับเป็นโทเค็นปกติ) ควรสังเกตคอลัมน์ `was_fallback`/`had_citation` ใน log Sheet เป็นระยะ ถ้าอัตรา fallback ขยับสูงขึ้นตามจำนวนเอกสารที่เพิ่ม ให้กลับมาทบทวนจุดนี้อีกครั้ง ถ้าในอนาคตมีอาการ MAX_TOKENS/504 อีก ให้เช็คจุดนี้ก่อน เพราะ time budget รวม 2 รอบ (10s+16s=26s) ยังค่อนข้างชิดกับเพดาน 30s ของ Vercel
9. **`GEMINI_TIMEOUT_MS_PASS1` (10s) / `PASS2` (16s) เป็นค่าที่ประมาณจาก log จริงตอนแก้ปัญหาข้อ 8** ไม่ใช่การการันตีตายตัว ถ้า Gemini ช้าลงกว่านี้ในอนาคต (เช่น เอกสารใน File Search เยอะขึ้นมาก) อาจต้องปรับสัดส่วนใหม่ หรือพิจารณาย้ายไปใช้สถาปัตยกรรมอื่น (เช่น ตอบ LINE แบบ async ไม่รอ reply ทันที)
10. **เคยเจอจริง (23 ก.ย. 2569): thinkingLevel MEDIUM คิดหนักจนชนเพดานได้เองแม้ใน "รอบที่ 1" ที่ไม่เปิด File Search เลย** (เจอ `thoughtsTokenCount: 1965/2048` พร้อม timeout ทั้งที่ `useFileSearch: false`) ยืนยันว่าปัญหาการคิดเยอะเกินไม่ได้ผูกกับ File Search อย่างเดียว เป็นคุณสมบัติที่ค่อนข้างไม่แน่นอนของ thinkingLevel MEDIUM เอง **แก้แล้ว**บางส่วนด้วยการปรับ flow ให้ลองรอบที่ 2 (เปิด File Search) ต่อแม้รอบแรกจะ timeout/error ไปเลยก็ตาม (เดิมถ้ารอบแรก timeout จะยอมแพ้ทันที) แต่ไม่ได้แก้ที่ต้นเหตุการคิดหนักเกินจำเป็นของรอบแรกเอง — ถ้าพบว่าคำถามบางแบบ (เช่น พิมพ์ยาว/อ้อมค้อม/หลายประเด็นในคำถามเดียว) ทำให้เกิดซ้ำบ่อย ควรพิจารณาปรับพรอมต์ให้กระชับ/ชัดเจนขึ้น หรือทดลองปรับ thinkingLevel ใหม่
9. **ชื่อโมเดล `gemini-3.5-flash` hardcode ไว้จุดเดียว** ใน `lib/gemini.ts` ไม่มี fallback ถ้า Google เปลี่ยน/เลิกซัพพอร์ตชื่อนี้
10. **ไม่มี automated test เลยในโปรเจกต์นี้** ตรวจสอบทุกครั้งด้วย `tsc --noEmit` + `next build` + ทดสอบจริงบน LINE มือ
11. **สมมติฐานเรื่อง Vercel Hobby plan ไม่ตรงกับที่เจอจริง** — คอมเมนต์เก่าในโค้ดเคยเขียนว่า Hobby จำกัด 10s แต่ log จริงแสดงว่าใช้ได้ถึง 30s (อาจเพราะ Fluid Compute) ยังไม่ได้ไปยืนยันสาเหตุแน่ชัด ถ้า deploy เริ่ม timeout ผิดปกติให้กลับมาเช็คจุดนี้
12. **`getThaiDateString()` ใน `lib/prompt.ts` ใช้ offset UTC+7 ตายตัว** ไม่ได้ใช้ timezone library จริงจัง — ใช้ได้เพราะไทยไม่มี DST แต่ถ้าจะเอาโค้ดนี้ไปใช้ที่อื่นต้องระวัง

---

## 6. Future Roadmap (คุยกันไว้แต่ยังไม่ได้ทำ)

1. **เปิด Google Search grounding tool** — เคยออกแบบเงื่อนไขไว้ครบแล้ว (ใช้เป็นทางเลือกสุดท้ายเท่านั้น, เชื่อเฉพาะโดเมนราชการ `.go.th`, ต้องแนบลิงก์แหล่งที่มาเสมอ) แต่ผู้ใช้ยกเลิกก่อนลงมือเขียนโค้ดจริง — ยังไม่มีบรรทัดโค้ดไหนเกี่ยวกับเรื่องนี้ในระบบตอนนี้เลย พิจารณาใหม่ได้ถ้าต้องการให้บอทหาข้อมูลสาธารณะนอกเหนือจากเอกสารภายใน
2. **Migrate `regulations.ts` เข้า File Search ทั้งหมด** — ตอนนี้จงใจเก็บคู่ขนานกันไป (ของเดิมไม่แตะ + File Search เป็นชั้นเสริม) ในอนาคตอาจอัปโหลด PDF ต้นฉบับทั้ง 7 ฉบับเข้า File Search โดยตรง จะได้ citation หน้าอัตโนมัติ และเลิกต้องแก้โค้ด/push ทุกครั้งที่มีระเบียบใหม่
3. **หน้าจัดการเอกสารใน File Search store** — list/delete/replace เอกสารที่อัปโหลดไปแล้ว (แก้ Known Constraint ข้อ 7)
4. **ใช้คอลัมน์ `keywords`/`category` ของ FAQ ให้เกิดประโยชน์** — กรองเฉพาะแถวที่เกี่ยวข้องก่อนยัดเข้าพรอมต์ แทนที่จะส่งทั้งหมดทุกครั้ง (สำคัญขึ้นเรื่อยๆ ถ้า Sheet โตขึ้น)
5. ~~เก็บ log คำถาม-คำตอบ~~ — **ทำแล้ว** (ก.ย. 2569) ผ่าน Google Sheet + Apps Script ดูหัวข้อ 3.4 ไอเดียต่อยอด: ทำรายงานสรุปอัตโนมัติ (เช่น แจ้งเตือนถ้า `was_fallback` เกินกี่ % ต่อสัปดาห์) หรือย้ายไป Vercel Marketplace database (Neon/Upstash) ถ้า traffic สูงขึ้นจนการเขียน Sheet ตามไม่ทัน
6. ~~เพิ่มปุ่ม quick-reply ใน LINE~~ — **ทำแล้ว** (ก.ย. 2569) ดู `lib/quick-replies.ts` แนบไปกับทุกคำตอบ + ข้อความต้อนรับตอนเพิ่มเพื่อนใหม่ (`event.type === "follow"`) ไอเดียต่อยอด: ปรับปุ่มให้ dynamic ตามหมวดที่คุยล่าสุด แทนที่จะเป็นชุดเดิมทุกครั้ง
7. **ระบบยืนยันตัวตนที่แข็งแรงขึ้นสำหรับ `/admin/upload`** ถ้ามีคนใช้งานมากกว่านี้ (login รายคน + audit log)
