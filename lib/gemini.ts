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
  userQuestion: string,
  useFileSearch: boolean = false
): Promise<GeminiResult> {
  const tools: Tool[] = [];
  // เปิด File Search เฉพาะตอนที่ผู้เรียกขอจริงๆ (route.ts จะขอเฉพาะรอบที่ 2 ตอนรอบแรกหาไม่เจอ)
  // ไม่เปิดทุกครั้งเหมือนเดิม เพราะเจอว่าแค่ "มี tool ให้เลือก" ก็ทำให้โมเดลเผื่อคิดเรื่องค้นหา
  // จนกินโควตา thinking ไปเยอะโดยไม่จำเป็น แม้คำถามจะตอบได้จาก regulations.ts อยู่แล้วก็ตาม
  if (useFileSearch && process.env.GEMINI_FILE_SEARCH_STORE) {
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
      // หมายเหตุ: ไม่ใส่ temperature เพราะ Gemini 3.x ตระกูลนี้ (รวม 3.5 Flash)
      // เพิกเฉยค่า temperature/top_p/top_k โดยสมบูรณ์ตามประกาศ migration ล่าสุดของ Google
      // ตัวคุมความสม่ำเสมอ/คุณภาพคำตอบจริงคือ thinkingLevel แทน
      // ตอนเปิด File Search ให้ budget เยอะกว่าปกติ เพราะโมเดลกินโทเค็นคิดเรื่องค้นหาเพิ่ม
      maxOutputTokens: useFileSearch ? 4096 : 2048,
      thinkingConfig: {
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
    useFileSearch,
    finishReason: result.finishReason,
    thoughtsTokenCount: result.thoughtsTokenCount,
    candidatesTokenCount: result.candidatesTokenCount,
    groundingSourceCount: result.groundingSources.length,
  });

  return result;
}
