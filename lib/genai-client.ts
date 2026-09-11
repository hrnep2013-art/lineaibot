import { GoogleGenAI } from "@google/genai";

// client กลาง ใช้ร่วมกันทั้ง lib/gemini.ts (ตอบคำถามบุคลากร) และ admin routes
// (สร้าง/อัปโหลดเข้า File Search store) กัน instantiate ซ้ำหลายที่โดยไม่จำเป็น
export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
