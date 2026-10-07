// ===== ตั้งค่า 3 ค่านี้ก่อนใช้งาน =====
const CONFIG = {
  LIFF_ID: 'YOUR_LIFF_ID',                                   // จาก LINE Developers → LIFF
  API_URL: 'https://script.google.com/macros/s/XXXX/exec',   // Web app URL ของ Code.gs
  BOT_ADD_URL: 'https://line.me/R/ti/p/@YOUR_BOT_ID',        // ลิงก์แอดเพื่อนบอท
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_TH = { Pending: 'รอเจ้าหน้าที่ตรวจสอบ', WaitDirector: 'รอ ผอ. อนุมัติ', Approved: 'อนุมัติแล้ว รอส่งเอกสาร', Sent: 'ส่งเอกสารแล้ว', Rejected: 'ไม่อนุมัติ' };
const badge = (s) => `<span class="badge b-${esc(s)}">${esc(STATUS_TH[s] || s)}</span>`;

// ส่งเป็น text/plain เพื่อเลี่ยง CORS preflight ของ Apps Script
async function api(action, payload = {}) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, idToken: liff.getIDToken(), payload }),
  });
  const r = await res.json();
  if (!r.ok) {
    if (r.error === 'INVALID_TOKEN') { liff.logout(); location.reload(); } // token หมดอายุ → login ใหม่
    throw new Error(r.error);
  }
  return r.data;
}

async function startLiff() {
  await liff.init({ liffId: CONFIG.LIFF_ID });
  if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return false; }
  return true;
}

const toB64 = (f) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(r.result.split(',')[1]);
  r.onerror = no;
  r.readAsDataURL(f);
});
