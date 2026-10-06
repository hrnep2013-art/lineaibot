import { NextRequest, NextResponse } from "next/server";
import { ai } from "@/lib/genai-client";

// SDK รองรับส่ง Blob เข้า uploadToFileSearchStore ได้ตรงๆ (Node.js: File path หรือ Blob object)
// ไม่ต้องเขียนไฟล์ชั่วคราวลงดิสก์ก่อน
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!process.env.ADMIN_UPLOAD_SECRET) {
    return NextResponse.json(
      { error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า ADMIN_UPLOAD_SECRET" },
      { status: 500 }
    );
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 });
  }

  const secret = formData.get("secret");
  if (secret !== process.env.ADMIN_UPLOAD_SECRET) {
    return NextResponse.json({ error: "รหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ไม่พบไฟล์ที่อัปโหลด" }, { status: 400 });
  }

  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return NextResponse.json({ error: "รองรับเฉพาะไฟล์ PDF เท่านั้น" }, { status: 400 });
  }

  const storeName = process.env.GEMINI_FILE_SEARCH_STORE;
  if (!storeName) {
    return NextResponse.json(
      {
        error:
          "ยังไม่ได้ตั้งค่า GEMINI_FILE_SEARCH_STORE — ต้องเรียก /api/admin/setup-store สร้าง store ก่อน",
      },
      { status: 500 }
    );
  }

  // กันชื่อไฟล์ซ้ำ: ถ้ามีเอกสารชื่อเดียวกันอยู่แล้ว ต้องให้ผู้ใช้ยืนยันก่อน (replace=true)
  // แล้วจะอัปโหลดฉบับใหม่ก่อน ค่อยลบฉบับเก่าหลังอัปโหลดสำเร็จ (กันกรณีอัปโหลดล้มแล้วเสียของเดิม)
  const replace = formData.get("replace") === "true";
  const oldDocNames: string[] = [];
  try {
    const pager = await ai.fileSearchStores.documents.list({
      parent: storeName,
      config: { pageSize: 20 },
    });
    for await (const d of pager) {
      if (d.displayName === file.name && d.name) oldDocNames.push(d.name);
    }
  } catch (err) {
    console.error("[upload-doc] เช็คชื่อซ้ำไม่สำเร็จ (ข้ามไป):", err);
  }

  if (oldDocNames.length > 0 && !replace) {
    return NextResponse.json(
      {
        duplicate: true,
        error: `มีเอกสารชื่อ "${file.name}" อยู่แล้ว ${oldDocNames.length} ฉบับ`,
      },
      { status: 409 }
    );
  }

  try {
    const operation = await ai.fileSearchStores.uploadToFileSearchStore({
      fileSearchStoreName: storeName,
      file, // Blob/File object จาก formData ส่งตรงได้เลยตาม SDK
      config: {
        displayName: file.name, // ชื่อนี้จะถูกใช้ตอนบอทอ้างอิงแหล่งที่มาในคำตอบ
      },
    });

    // อัปโหลดสำเร็จแล้ว ค่อยลบฉบับเก่าชื่อเดียวกัน (ถ้าผู้ใช้ยืนยันให้แทนที่)
    let removedOld = 0;
    for (const oldName of oldDocNames) {
      try {
        await ai.fileSearchStores.documents.delete({ name: oldName, config: { force: true } });
        removedOld++;
      } catch (err) {
        console.error("[upload-doc] ลบฉบับเก่าไม่สำเร็จ:", oldName, err);
      }
    }

    return NextResponse.json({
      success: true,
      replaced: removedOld,
      message: `อัปโหลด "${file.name}" สำเร็จ${removedOld > 0 ? ` (แทนที่ฉบับเก่า ${removedOld} ฉบับแล้ว)` : ""} ระบบกำลังทำ index อยู่เบื้องหลัง (ปกติเสร็จภายในไม่กี่นาที) รอสักครู่แล้วลองถามบอทได้เลย`,
      operationName: operation.name,
    });
  } catch (err) {
    console.error("[upload-doc] error:", err);
    return NextResponse.json({ error: "อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
