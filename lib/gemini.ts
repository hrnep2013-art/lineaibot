import { ThinkingLevel, type Tool } from "@google/genai";
import { ai } from "./genai-client";

export interface GroundingSource {
  title: string;
  pageNumber?: number;
}

export interface GeminiResult {
  text: string;
  finishReason: string | undefined;
  thoughtsTokenCount: number;
  candidatesTokenCount: number;
  groundingSources: GroundingSource[];
}

export async function askGemini(
  systemInstruction: string,
  userQuestion: string
): Promise<GeminiResult> {
  const tools: Tool[] = [];
  // เปิด File Search เฉพาะตอนตั้งค่า store ไว้แล้วเท่านั้น (ดูขั้นตอนที่ /admin/upload)
  // กันพังตอนยังไม่ได้ตั้งค่า GEMINI_FILE_SEARCH_STORE — บอทจะทำงานแบบเดิมเป๊ะถ้ายังไม่ตั้ง
  if (process.env.GEMINI_FILE_SEARCH_STORE) {
    tools.push({
      fileSearch: {
        fileSearchStoreNames: [process.env.GEMINI_FILE_SEARCH_STORE],
      },
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [{ role: "user", parts: [{ text: userQuestion }] }],
    config: {
      systemInstruction,
      // หมายเหตุ: ถอด temperature ออกแล้ว เพราะ Gemini 3.x ตระกูลนี้ (รวม 3.5 Flash)
      // เพิกเฉยค่า temperature/top_p/top_k โดยสมบูรณ์ตามประกาศ migration ล่าสุดของ Google
      // ตัวคุมความสม่ำเสมอ/คุณภาพคำตอบจริงคือ thinkingLevel แทน
      maxOutputTokens: 2048,
      thinkingConfig: {
        // ยกจาก LOW เป็น MEDIUM (ค่า default ใหม่ของ Google เอง) เพราะงานตอบคำถามเชิงคำนวณ
        // (เช่น นับวันจากวันบรรจุ) ต้องคิดหลายขั้นตอน LOW ทำให้บางครั้งคิดไม่ครบแล้ว
        // เลือกทางลัดตอบ fallback แทน ทำให้คำถามเดิมได้คำตอบไม่เหมือนกันในแต่ละครั้ง
        thinkingLevel: ThinkingLevel.MEDIUM,
      },
      ...(tools.length > 0 ? { tools } : {}),
    },
  });

  const candidate = response.candidates?.[0];
  const usage = response.usageMetadata;

  // ดึงแหล่งอ้างอิงจาก File Search (ถ้ามีการค้นจริงในรอบนี้) — ใช้ต่อท้ายคำตอบ
  // ให้บุคลากรเช็คย้อนกลับได้ว่ามาจากเอกสารไหน หน้าไหน
  const groundingSources: GroundingSource[] =
    candidate?.groundingMetadata?.groundingChunks
      ?.map((chunk) => ({
        title: chunk.retrievedContext?.title ?? "",
        pageNumber: chunk.retrievedContext?.pageNumber,
      }))
      .filter((s) => s.title) ?? [];

  const result: GeminiResult = {
    text: candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "",
    finishReason: candidate?.finishReason,
    thoughtsTokenCount: usage?.thoughtsTokenCount ?? 0,
    candidatesTokenCount: usage?.candidatesTokenCount ?? 0,
    groundingSources,
  };

  console.log("[gemini]", {
    finishReason: result.finishReason,
    thoughtsTokenCount: result.thoughtsTokenCount,
    candidatesTokenCount: result.candidatesTokenCount,
    groundingSourceCount: result.groundingSources.length,
  });

  return result;
}
