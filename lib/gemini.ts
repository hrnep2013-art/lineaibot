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
      temperature: 1.0, // ตามคำแนะนำ Google สำหรับ Gemini 3.x — ห้ามปรับ
      maxOutputTokens: 1024,
      thinkingConfig: {
        // บังคับ thinking ต่ำ กัน thinking แย่งโควตาจนตอบไม่ครบ
        // (Gemini 3.x นับ thinking + output รวมกันจริง และ default ของ 3.5 Flash คือ "medium"
        // ซึ่งกินโควตาเยอะกว่าที่จำเป็นสำหรับงานตอบ FAQ สั้นๆ แบบนี้)
        thinkingLevel: ThinkingLevel.LOW,
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
