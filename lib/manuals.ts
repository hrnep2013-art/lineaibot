// ตอบลิงก์คู่มือระบบ DPIS6 (การประเมินผลการปฏิบัติราชการ) ทันที โดยไม่เรียก Gemini
// ไฟล์ PDF อยู่ที่ public/manuals/ (เข้าถึงได้ที่ <โดเมน>/manuals/ชื่อไฟล์)
// หากอัปเดตคู่มือ ให้อัปโหลดไฟล์ชื่อเดิมทับ ลิงก์จะไม่เปลี่ยน

const EVALUATEE_FILE = "dpis-evaluatee.pdf"; // คู่มือผู้รับการประเมิน
const EVALUATOR_FILE = "dpis-evaluator.pdf"; // คู่มือผู้ประเมิน/ผู้ให้ข้อมูล

// โดเมนฐานของลิงก์ — ลำดับความสำคัญ:
// 1) MANUALS_BASE_URL (ตั้งเองใน Vercel ถ้าอยากระบุโดเมนเฉพาะ เช่น https://bot.example.go.th)
// 2) VERCEL_PROJECT_PRODUCTION_URL (Vercel ใส่ให้อัตโนมัติ ถ้าเปิด "Automatically expose System Environment Variables")
function getBaseUrl(): string | null {
  const custom = process.env.MANUALS_BASE_URL?.trim();
  if (custom) return custom.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return null;
}

// คำถามที่ถือว่าเป็นเรื่อง "ขั้นตอน/วิธีทำ/คู่มือ การประเมินผลในระบบ DPIS"
function isDpisManualQuestion(q: string): boolean {
  if (!q.includes("ประเมิน")) return false;
  const aboutSystem = /dpis|ดีพิส|ในระบบ|คู่มือ/i.test(q);
  if (!aboutSystem) return false;
  // คำถามเรื่องหลักเกณฑ์/สัดส่วนคะแนน ไม่ใช่เรื่องขั้นตอนในระบบ ให้ไปทางระเบียบตามเดิม
  const aboutCriteria = /หลักเกณฑ์|เกณฑ์|สัดส่วน|ร้อยละ|เลื่อนเงินเดือน|เลื่อนค่าตอบแทน/.test(q);
  const aboutSteps = /ขั้นตอน|วิธี|ทำอย่างไร|ทำยังไง|คู่มือ|ใช้งาน|ลิงก์|ลิงค์/.test(q);
  if (aboutCriteria && !aboutSteps) return false;
  return true;
}

export function matchManualReply(question: string): string | null {
  const q = question.replace(/\s+/g, "");
  if (!isDpisManualQuestion(q)) return null;

  const base = getBaseUrl();
  if (!base) return null; // ยังไม่รู้โดเมน ปล่อยให้ไปทางบอทปกติ (FAQ) แทน

  const evaluateeUrl = `${base}/manuals/${EVALUATEE_FILE}`;
  const evaluatorUrl = `${base}/manuals/${EVALUATOR_FILE}`;

  const isEvaluatee = q.includes("ผู้รับการประเมิน");
  const isEvaluator = /ผู้ประเมิน|ผู้ให้การประเมิน|ผู้ให้ข้อมูล|ผู้บังคับบัญชา/.test(q);

  if (isEvaluatee && !isEvaluator) {
    return `คู่มือการประเมินผลการปฏิบัติราชการในระบบ DPIS6 สำหรับผู้รับการประเมิน ดูได้ที่\n${evaluateeUrl}`;
  }
  if (isEvaluator && !isEvaluatee) {
    return `คู่มือการประเมินผลการปฏิบัติราชการในระบบ DPIS6 สำหรับผู้ประเมิน ดูได้ที่\n${evaluatorUrl}`;
  }
  return (
    "คู่มือการประเมินผลการปฏิบัติราชการในระบบ DPIS6 มี 2 ฉบับตามบทบาทค่ะ\n\n" +
    `1. ผู้รับการประเมิน (ผู้ถูกประเมิน)\n${evaluateeUrl}\n\n` +
    `2. ผู้ประเมิน (ผู้บังคับบัญชา/ผู้ให้ข้อมูล)\n${evaluatorUrl}`
  );
}
