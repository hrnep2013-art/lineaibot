import { NextRequest, NextResponse } from "next/server";
import { messagingApi, validateSignature, webhook } from "@line/bot-sdk";
import { waitUntil } from "@vercel/functions";
import { getFaqList } from "@/lib/sheet";
import { buildSystemInstruction } from "@/lib/prompt";
import { askGemini } from "@/lib/gemini";
import { DEFAULT_REPLY } from "@/lib/constants";
import { logConversation } from "@/lib/log";
import { quickReplyItems, WELCOME_MESSAGE } from "@/lib/quick-replies";

const channelSecret = process.env.LINE_CHANNEL_SECRET!;
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

// maxDuration ของ Vercel function นี้ยืนยันแล้วจาก log จริงว่าใช้ได้ถึง 30s บน plan ปัจจุบัน
// (ดู Runtime Logs → Function Invocation → Execution Duration/Maximum)
export const maxDuration = 30;

// แยก timeout เป็น 2 รอบ (ดูเหตุผลเต็มที่ lib/gemini.ts และ BLUEPRINT.md หัวข้อ Known Constraints):
// รอบแรกไม่เปิด File Search ควรเร็ว (พบว่าปกติจบใน 2-4 วิ) ให้ buffer พอประมาณ
// รอบสอง (เปิด File Search) เจอว่ากินเวลา/โทเค็นคิดเยอะกว่ามาก ให้ budget ที่เหลือเกือบทั้งหมด
// รวมสองรอบ + reply ต้องไม่เกิน 30s (maxDuration) เผื่อ buffer ไว้ ~2s
const GEMINI_TIMEOUT_MS_PASS1 = 10000;
const GEMINI_TIMEOUT_MS_PASS2 = 16000;

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
  // ตอนมีคนเพิ่มบอทเป็นเพื่อน (หรือปลดบล็อก) — ส่งข้อความต้อนรับพร้อมปุ่มลัดทันที
  if (event.type === "follow") {
    try {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          {
            type: "text",
            text: WELCOME_MESSAGE,
            quickReply: { items: quickReplyItems },
          },
        ],
      });
    } catch (err) {
      console.error("[line-webhook] follow reply failed:", err);
    }
    return;
  }

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

    // รอบที่ 1: ไม่เปิด File Search — เร็ว เบา ครอบคลุม FAQ + regulations.ts ซึ่งเป็นกรณีส่วนใหญ่
    const pass1 = await withTimeout(
      askGemini(systemInstruction, question, false),
      GEMINI_TIMEOUT_MS_PASS1
    );

    let result = pass1;

    // รอบที่ 2: ลองใหม่พร้อมเปิด File Search เฉพาะตอนรอบแรก "หาไม่เจอ" เป๊ะๆ เท่านั้น
    // (เทียบ string ตรงตัวกับ DEFAULT_REPLY เพราะพรอมต์บังคับให้ตอบคำต่อคำแบบนี้เวลาไม่พบข้อมูล)
    // ป้องกันการเปิด tool โดยไม่จำเป็น ซึ่งเคยทำให้โมเดลกินโทเค็นคิดจนตอบไม่จบ (MAX_TOKENS) มาแล้ว
    if (
      process.env.GEMINI_FILE_SEARCH_STORE &&
      (pass1.finishReason === "MAX_TOKENS" || !pass1.text.trim() || pass1.text.trim() === DEFAULT_REPLY)
    ) {
      try {
        const pass2 = await withTimeout(
          askGemini(systemInstruction, question, true),
          GEMINI_TIMEOUT_MS_PASS2
        );
        result = pass2;
      } catch (err) {
        console.error("[line-webhook] pass2 (file search) failed, ใช้ผลรอบแรกแทน:", err);
        // เก็บ result เป็น pass1 ต่อไป (จะกลายเป็น DEFAULT_REPLY ตามเงื่อนไขด้านล่างอยู่แล้ว)
      }
    }

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
      messages: [
        {
          type: "text",
          text: replyText,
          quickReply: { items: quickReplyItems },
        },
      ],
    });
  } catch (err) {
    console.error("[line-webhook] LINE reply failed:", err);
  }

  // log แบบไม่บล็อก — ใช้ waitUntil แทน await เพื่อไม่ให้การเรียก Apps Script (บางทีช้า)
  // ไปแย่งเวลาจนฟังก์ชันรวมเกิน 30s ของ Vercel (เคยเกิดจริงจนโดน hard timeout มาแล้ว)
  // response จะถูกส่งกลับ LINE ทันทีที่ reply เสร็จ ไม่ต้องรอ log
  waitUntil(
    logConversation({
      question,
      answer: replyText,
      wasFallback: replyText === DEFAULT_REPLY,
      hadCitation,
    })
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("gemini timeout")), ms)
    ),
  ]);
}
