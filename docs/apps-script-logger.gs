/**
 * Apps Script สำหรับรับ log คำถาม-คำตอบจากบอท แล้วบันทึกลง Google Sheet
 *
 * วิธีติดตั้ง:
 * 1. เปิด Google Sheet ที่จะใช้เก็บ log (สร้างชีตใหม่แยกจาก FAQ ก็ได้ หรือใช้ไฟล์เดียวกันก็ได้)
 * 2. เมนู Extensions → Apps Script
 * 3. ลบโค้ดเดิมในไฟล์ทั้งหมดออก แล้ววางโค้ดนี้แทน
 * 4. แก้ค่า SECRET ด้านล่างให้เป็นรหัสที่ตั้งเอง (ต้องตรงกับ env var LOG_SHEET_SECRET ใน Vercel)
 * 5. กด Deploy → New deployment → เลือกประเภท "Web app"
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. คัดลอก Web app URL ที่ได้ ไปตั้งเป็น env var LOG_SHEET_WEBHOOK_URL ใน Vercel
 * 7. ถ้าแก้โค้ดนี้ภายหลัง ต้องกด Deploy → Manage deployments → แก้ไข (เวอร์ชันใหม่) ทุกครั้ง
 *    ไม่งั้น URL เดิมจะยังรันโค้ดเวอร์ชันเก่าอยู่
 */

const SECRET = "เปลี่ยนเป็นรหัสของตัวเอง"; // ต้องตรงกับ LOG_SHEET_SECRET ใน Vercel

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.secret !== SECRET) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Logs");
    if (!sheet) {
      sheet = ss.insertSheet("Logs");
      sheet.appendRow(["timestamp", "question", "answer", "was_fallback", "had_citation"]);
    }

    sheet.appendRow([
      new Date(),
      data.question || "",
      data.answer || "",
      data.wasFallback ? "TRUE" : "FALSE",
      data.hadCitation ? "TRUE" : "FALSE",
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
