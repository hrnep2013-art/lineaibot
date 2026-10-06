import { NextRequest, NextResponse } from "next/server";
import { ai } from "@/lib/genai-client";

export const maxDuration = 30;

// POST /api/admin/delete-doc  body: { "secret": "...", "name": "fileSearchStores/xxx/documents/yyy" }
// ลบเอกสาร 1 ฉบับออกจาก File Search store (ลบถาวร กู้คืนไม่ได้ — ต้องอัปโหลดใหม่)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (!process.env.ADMIN_UPLOAD_SECRET || body?.secret !== process.env.ADMIN_UPLOAD_SECRET) {
    return NextResponse.json({ error: "รหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }

  const storeName = process.env.GEMINI_FILE_SEARCH_STORE;
  if (!storeName) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า GEMINI_FILE_SEARCH_STORE" }, { status: 500 });
  }

  const name = body?.name;
  // กันลบข้าม store หรือส่งค่าแปลกๆ เข้ามา: ต้องเป็นเอกสารใน store ของเราเท่านั้น
  if (typeof name !== "string" || !name.startsWith(`${storeName}/documents/`)) {
    return NextResponse.json({ error: "ชื่อเอกสารไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    await ai.fileSearchStores.documents.delete({ name, config: { force: true } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[delete-doc] error:", err);
    return NextResponse.json({ error: "ลบเอกสารไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
