import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface GeminiResult {
  text: string;
  finishReason: string | undefined;
  thoughtsTokenCount: number;
  candidatesTokenCount: number;
}

export async function askGemini(
  systemInstruction: string,
  userQuestion: string
): Promise<GeminiResult> {
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
    },
  });

  const candidate = response.candidates?.[0];
  const usage = response.usageMetadata;

  const result: GeminiResult = {
    text: candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "",
    finishReason: candidate?.finishReason,
    thoughtsTokenCount: usage?.thoughtsTokenCount ?? 0,
    candidatesTokenCount: usage?.candidatesTokenCount ?? 0,
  };

  console.log("[gemini]", {
    finishReason: result.finishReason,
    thoughtsTokenCount: result.thoughtsTokenCount,
    candidatesTokenCount: result.candidatesTokenCount,
  });

  return result;
}
