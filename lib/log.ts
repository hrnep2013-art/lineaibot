export interface LogEntry {
  question: string;
  answer: string;
  wasFallback: boolean;
  hadCitation: boolean;
}

// บันทึก log คำถาม-คำตอบไปยัง Google Sheet ผ่าน Apps Script Web App (ดู docs/apps-script-logger.gs)
// ถ้ายังไม่ได้ตั้งค่า LOG_SHEET_WEBHOOK_URL จะข้ามเงียบๆ ไม่กระทบการทำงานหลักของบอท
// error ระหว่างบันทึก log ก็จะไม่ทำให้บอทตอบบุคลากรผิดพลาดตาม (แค่ log error ไว้เฉยๆ)
export async function logConversation(entry: LogEntry): Promise<void> {
  const url = process.env.LOG_SHEET_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: process.env.LOG_SHEET_SECRET ?? "",
        ...entry,
      }),
    });
  } catch (err) {
    console.error("[log] failed to write log:", err);
  }
}
