import { NextRequest, NextResponse } from "next/server";
import { messagingApi, validateSignature, webhook } from "@line/bot-sdk";
import { getFaqList } from "@/lib/sheet";
import { buildSystemInstruction } from "@/lib/prompt";
import { askGemini } from "@/lib/gemini";
import { DEFAULT_REPLY } from "@/lib/constants";
import { logConversation } from "@/lib/log";

const channelSecret = process.env.LINE_CHANNEL_SECRET!;
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

// maxDuration ของ Vercel function นี้ยืนยันแล้วจาก log จริงว่าใช้ได้ถึง 30s บน plan ปัจจุบัน
// (ดู Runtime Logs → Function Invocation → Execution Duration/Maximum)
export const maxDuration = 30;

// เดิม 8000ms ตอนใช้ thinkingLevel LOW แต่พอยกเป็น MEDIUM เพื่อความสม่ำเสมอของคำตอบ
// (ดูคอมเมนต์ใน lib/gemini.ts) เวลาคิดนานขึ้น เลยขยับ timeout ให้มี buffer พอ
// เหลือ ~10s ให้ signature validate + JSON parse + เรียก LINE reply API
const GEMINI_TIMEOUT_MS = 20000;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  if (!validateSignature(rawBody, channelSecret, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as { events: webhook.Event[] };
  await Promise.all(body.events.map(handleEvent));

  return NextResponse.json({ status: "ok" });
}

async function handleEvent(event: webhook.Event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  // replyToken เป็น optional ใน @line/bot-sdk เวอร์ชันปัจจุบัน (v11) — ต่างจากบรีฟเดิมที่สมมติว่าเป็น string เสมอ
  const { replyToken } = event;
  if (!replyToken) return;

  const question = event.message.text;
  let replyText = DEFAULT_REPLY;
  let hadCitation = false;

  try {
    const faqList = await getFaqList();
    const systemInstruction = buildSystemInstruction(faqList);
    const result = await withTimeout(
      askGemini(systemInstruction, question),
      GEMINI_TIMEOUT_MS
    );

    if (result.finishReason === "MAX_TOKENS" || !result.text.trim()) {
      // กันส่งครึ่งประโยคให้บุคลากร ตามที่กำหนดไว้
      replyText = DEFAULT_REPLY;
    } else {
      replyText = result.text.trim();
      if (result.groundingSources.length > 0) {
        // ต่อท้ายด้วยแหล่งอ้างอิงจากเอกสารที่อัปโหลดเข้า File Search (ถ้ามีการค้นจริงในรอบนี้)
        // จำกัดไม่เกิน 3 แหล่ง กันข้อความยาวเกินไป
        hadCitation = true;
        const cites = result.groundingSources
          .slice(0, 3)
          .map((s) => (s.pageNumber ? `${s.title} (หน้า ${s.pageNumber})` : s.title))
          .join(", ");
        replyText += `\n\n(อ้างอิงจากเอกสาร: ${cites})`;
      }
    }
  } catch (err) {
    console.error("[line-webhook] processing error:", err);
    replyText = DEFAULT_REPLY;
  }

  try {
    // v11: replyMessage รับ object เดียว { replyToken, messages } แทนรูปแบบเดิม (replyToken, message)
    await client.replyMessage({
      replyToken,
      messages: [{ type: "text", text: replyText }],
    });
  } catch (err) {
    console.error("[line-webhook] LINE reply failed:", err);
  }

  // log หลังตอบ LINE เสร็จแล้ว ไม่ทำให้การตอบบุคลากรช้าลงเพราะรอ log ก่อน
  await logConversation({
    question,
    answer: replyText,
    wasFallback: replyText === DEFAULT_REPLY,
    hadCitation,
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("gemini timeout")), ms)
    ),
  ]);
}
