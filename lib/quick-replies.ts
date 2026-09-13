import { messagingApi } from "@line/bot-sdk";

// ปุ่มลัดที่แนบไปกับทุกคำตอบปกติ + ข้อความต้อนรับตอนมีคนเพิ่มเพื่อนใหม่
// แก้ label/text ตรงนี้ที่เดียว มีผลทั้ง 2 จุดในโค้ด (route.ts)
// ข้อจำกัดของ LINE: มีได้สูงสุด 13 ปุ่ม, label ยาวได้ไม่เกิน 20 ตัวอักษร, text (ข้อความที่จะถูกส่งแทนการพิมพ์) ยาวได้ไม่เกิน 300 ตัวอักษร
export const quickReplyItems: messagingApi.QuickReplyItem[] = [
  {
    type: "action",
    action: { type: "message", label: "การลา", text: "มีสิทธิลาประเภทไหนบ้าง" },
  },
  {
    type: "action",
    action: {
      type: "message",
      label: "การประเมินผล",
      text: "หลักเกณฑ์การประเมินผลการปฏิบัติงานเป็นอย่างไร",
    },
  },
  {
    type: "action",
    action: { type: "message", label: "สวัสดิการ", text: "มีสวัสดิการอะไรบ้าง" },
  },
  {
    type: "action",
    action: {
      type: "message",
      label: "การลงเวลา",
      text: "กฎการลงเวลาปฏิบัติราชการเป็นอย่างไร",
    },
  },
];

export const WELCOME_MESSAGE =
  "สวัสดีค่ะ ดิฉันเป็นผู้ช่วยตอบคำถาม HR ของกลุ่มบริหารทรัพยากรบุคคล พก. ค่ะ\n" +
  "สอบถามเรื่องระเบียบการลา การประเมินผล สวัสดิการ หรือการลงเวลาได้เลย พิมพ์คำถามหรือกดปุ่มด้านล่างได้เลยค่ะ";
