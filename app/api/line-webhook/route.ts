import { NextRequest, NextResponse } from "next/server";
import { messagingApi, validateSignature, webhook } from "@line/bot-sdk";
import { getFaqList } from "@/lib/sheet";
import { buildSystemInstruction } from "@/lib/prompt";
import { askGemini } from "@/lib/gemini";
import { DEFAULT_REPLY } from "@/lib/constants";

const channelSecret = process.env.LINE_CHANNEL_SECRET!;
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

// สำคัญ: ต้องอยู่บน Vercel plan ที่รองรับ duration พอ (Hobby = 10s เต็มเพดาน)
// ปรับ TIMEOUT_MS ด้านล่างให้เหลือ buffer เผื่อ verify signature + reply call
export const maxDuration = 30;

const GEMINI_TIMEOUT_MS = 8000;

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
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("gemini timeout")), ms)
    ),
  ]);
}
