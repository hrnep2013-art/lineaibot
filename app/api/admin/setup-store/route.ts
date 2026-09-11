import { NextRequest, NextResponse } from "next/server";
import { ai } from "@/lib/genai-client";

// เรียก route นี้แค่ครั้งเดียวตอน setup File Search ครั้งแรก
// POST /api/admin/setup-store  body: { "secret": "..." }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const secret = body?.secret;

  if (!process.env.ADMIN_UPLOAD_SECRET || secret !== process.env.ADMIN_UPLOAD_SECRET) {
    return NextResponse.json({ error: "รหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }

  if (process.env.GEMINI_FILE_SEARCH_STORE) {
    return NextResponse.json(
      {
        error:
          "มี GEMINI_FILE_SEARCH_STORE ตั้งไว้อยู่แล้ว (" +
          process.env.GEMINI_FILE_SEARCH_STORE +
          ") ถ้าต้องการสร้างใหม่ ให้ลบ env var เดิมออกจาก Vercel ก่อน กันสร้างซ้ำโดยไม่ตั้งใจ",
      },
      { status: 400 }
    );
  }

  try {
    const store = await ai.fileSearchStores.create({
      config: {
        displayName: "hr-dep-regulations",
      },
    });

    return NextResponse.json({
      success: true,
      storeName: store.name,
      nextStep:
        "คัดลอกค่า storeName ไปตั้งเป็น Environment Variable ชื่อ GEMINI_FILE_SEARCH_STORE ใน Vercel (เลือก Production) แล้ว Redeploy ครั้งเดียว จากนั้นใช้หน้า /admin/upload อัปโหลด PDF ได้เลย",
    });
  } catch (err) {
    console.error("[setup-store] error:", err);
    return NextResponse.json({ error: "สร้าง store ไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
