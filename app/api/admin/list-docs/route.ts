import { NextRequest, NextResponse } from "next/server";
import { ai } from "@/lib/genai-client";

export const maxDuration = 30;

// POST /api/admin/list-docs  body: { "secret": "..." }
// ดึงรายการเอกสารทั้งหมดที่อัปโหลดไว้ใน File Search store (ข้อมูลอยู่ฝั่ง Google ไม่ได้เก็บไว้ในแอปนี้)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (!process.env.ADMIN_UPLOAD_SECRET || body?.secret !== process.env.ADMIN_UPLOAD_SECRET) {
    return NextResponse.json({ error: "รหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }

  const storeName = process.env.GEMINI_FILE_SEARCH_STORE;
  if (!storeName) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า GEMINI_FILE_SEARCH_STORE" }, { status: 500 });
  }

  try {
    const pager = await ai.fileSearchStores.documents.list({
      parent: storeName,
      config: { pageSize: 20 },
    });

    const docs: {
      name: string;
      displayName: string;
      sizeBytes: number;
      state: string;
      createTime: string;
    }[] = [];

    for await (const d of pager) {
      docs.push({
        name: d.name ?? "",
        displayName: d.displayName ?? "(ไม่มีชื่อ)",
        sizeBytes: Number(d.sizeBytes ?? 0),
        state: String(d.state ?? ""),
        createTime: d.createTime ?? "",
      });
    }

    // ใหม่สุดขึ้นก่อน
    docs.sort((a, b) => (b.createTime || "").localeCompare(a.createTime || ""));

    return NextResponse.json({ success: true, count: docs.length, docs });
  } catch (err) {
    console.error("[list-docs] error:", err);
    return NextResponse.json({ error: "ดึงรายการเอกสารไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
