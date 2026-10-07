/**
 * HR Document Service Portal — Backend (Google Apps Script, container-bound กับ Google Sheet)
 * Deploy: Web app / Execute as: Me / Who has access: Anyone
 *
 * Script Properties ที่ต้องตั้ง (Project Settings → Script properties):
 *   LOGIN_CHANNEL_ID          Channel ID ของ LINE Login channel (ใช้ verify id token)
 *   LINE_CHANNEL_ACCESS_TOKEN Channel access token ของ Messaging API (บอทตัวเดิม)
 *   ADMIN_EMAIL               hrnep2013@gmail.com
 *   ROOT_FOLDER_ID            (ไม่ต้องตั้ง — setup() สร้างให้)
 */
const TZ = 'Asia/Bangkok';
const P = PropertiesService.getScriptProperties();
const STATUSES = ['Pending', 'In Progress', 'Completed', 'Rejected'];
const STATUS_TH = { Pending: 'รอดำเนินการ', 'In Progress': 'กำลังตรวจสอบ', Completed: 'เสร็จสิ้น', Rejected: 'ไม่อนุมัติ' };
const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_FILES = 5, MAX_BYTES = 5 * 1024 * 1024;

const SCHEMA = {
  Requests: ['Request_ID', 'Timestamp', 'Line_UserID', 'User_Name', 'Position', 'Department', 'Category', 'Detail',
    'Attachment_URLs', 'Status', 'Admin_Remark', 'Updated_At', 'Updated_By', 'Result_URL'],
  Users: ['Line_UserID', 'Display_Name', 'Picture_URL', 'Position', 'Department', 'First_Seen', 'Last_Seen'],
  Categories: ['Name', 'Active', 'Attach', 'Hint'], // Attach: required | optional | none
  Admins: ['Line_UserID', 'Name', 'Role', 'Notify'],  // Role: Admin (แก้สถานะได้) | Viewer (ดูอย่างเดียว)
  Logs: ['Timestamp', 'Actor', 'Action', 'Detail'],
};

/* ---------- Setup (รันครั้งเดียวจาก editor) ---------- */
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SCHEMA).forEach(n => {
    let s = ss.getSheetByName(n) || ss.insertSheet(n);
    if (s.getLastRow() === 0) s.appendRow(SCHEMA[n]);
    s.setFrozenRows(1);
  });
  const c = ss.getSheetByName('Categories');
  if (c.getLastRow() < 2) {
    [
      ['หนังสือรับรองเงินเดือน', true, 'none', 'ระบุวัตถุประสงค์และหน่วยงานที่ใช้ยื่น เช่น สถาบันการเงิน'],
      ['หนังสือรับรองการทำงาน', true, 'none', 'ระบุวัตถุประสงค์และหน่วยงานที่ใช้ยื่น'],
      ['สวัสดิการ / ค่ารักษาพยาบาล / ค่าเล่าเรียนบุตร', true, 'required', 'แนบใบเสร็จรับเงิน ใบรับรองแพทย์ หรือสูติบัตร ตามกรณี'],
      ['ขอปรับปรุงข้อมูลประวัติส่วนบุคคล', true, 'required', 'แนบหลักฐาน เช่น ทะเบียนสมรส ใบเปลี่ยนชื่อ-สกุล'],
      ['เอกสารการลา', true, 'optional', 'ลาป่วยตั้งแต่ 3 วันทำการขึ้นไป แนบใบรับรองแพทย์'],
      ['ขอเข้าตรวจดูเอกสารประวัติ (ก.พ.7)', true, 'none', 'ระบุวันที่และเวลาที่ต้องการเข้าตรวจดู'],
      ['ขอเสนอขอเครื่องราชอิสริยาภรณ์', true, 'required', 'แนบเอกสารประกอบการพิจารณาตามที่กลุ่มงานกำหนด'],
    ].forEach(r => c.appendRow(r));
  }
  if (!P.getProperty('ROOT_FOLDER_ID')) P.setProperty('ROOT_FOLDER_ID', DriveApp.createFolder('HR Document Portal').getId());
  if (!P.getProperty('ADMIN_EMAIL')) P.setProperty('ADMIN_EMAIL', 'hrnep2013@gmail.com');
}

/* ---------- Entry points ---------- */
function doGet() { return json({ ok: true, service: 'HR Document Portal API' }); }

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const user = verifyToken(body.idToken);
    const p = body.payload || {};
    const routes = {
      getMe: () => getMe(user),
      saveRequest: () => saveRequest(user, p),
      myRequests: () => myRequests(user),
      getRequestsList: () => getRequestsList(user, p),
      updateStatus: () => updateStatus(user, p),
      getDashboardStats: () => getDashboardStats(user, p),
    };
    if (!routes[body.action]) throw new Error('UNKNOWN_ACTION');
    return json({ ok: true, data: routes[body.action]() });
  } catch (err) {
    log('-', 'ERROR', String(err));
    return json({ ok: false, error: String(err.message || err) });
  }
}

const json = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

/* ---------- Auth: ตรวจ LINE ID token ฝั่ง server (กันปลอม userId) ---------- */
function verifyToken(idToken) {
  if (!idToken) throw new Error('INVALID_TOKEN');
  const key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  const cache = CacheService.getScriptCache(), hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post', muteHttpExceptions: true,
    payload: { id_token: idToken, client_id: P.getProperty('LOGIN_CHANNEL_ID') },
  });
  if (res.getResponseCode() !== 200) throw new Error('INVALID_TOKEN');
  const j = JSON.parse(res.getContentText());
  const u = { userId: j.sub, name: j.name || '', picture: j.picture || '' };
  cache.put(key, JSON.stringify(u), 1800);
  return u;
}

function adminOf(user) { return rows('Admins').find(a => a.Line_UserID === user.userId); }
function requireAdmin(user, write) {
  const a = adminOf(user);
  if (!a || (write && a.Role !== 'Admin')) throw new Error('FORBIDDEN');
  return a;
}

/* ---------- Sheet helpers ---------- */
const sh = n => SpreadsheetApp.getActive().getSheetByName(n);
const now = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
function rows(name) {
  const v = sh(name).getDataRange().getValues(), h = v.shift();
  return v.map(r => Object.fromEntries(h.map((k, i) =>
    [k, r[i] instanceof Date ? Utilities.formatDate(r[i], TZ, 'yyyy-MM-dd HH:mm:ss') : r[i]])));
}
function appendObj(name, o) { sh(name).appendRow(SCHEMA[name].map(k => o[k] ?? '')); }
function log(actor, action, detail) { try { appendObj('Logs', { Timestamp: now(), Actor: actor, Action: action, Detail: detail }); } catch (e) {} }

/* ---------- API ---------- */
function getMe(user) {
  const s = sh('Users'), all = rows('Users'), i = all.findIndex(u => u.Line_UserID === user.userId);
  let prof;
  if (i < 0) {
    prof = { Line_UserID: user.userId, Display_Name: user.name, Picture_URL: user.picture, First_Seen: now(), Last_Seen: now() };
    appendObj('Users', prof);
  } else {
    prof = all[i];
    s.getRange(i + 2, 7).setValue(now());
  }
  const a = adminOf(user);
  return {
    userId: user.userId, name: user.name, picture: user.picture,
    position: prof.Position || '', department: prof.Department || '',
    isAdmin: !!a, role: a ? a.Role : '',
    categories: rows('Categories').filter(c => c.Active === true || String(c.Active).toUpperCase() === 'TRUE')
      .map(c => ({ name: c.Name, attach: c.Attach, hint: c.Hint })),
  };
}

function saveRequest(user, p) {
  const cat = rows('Categories').find(c => c.Name === p.category);
  if (!cat) throw new Error('หมวดหมู่ไม่ถูกต้อง');
  if (!String(p.detail || '').trim()) throw new Error('กรุณากรอกรายละเอียด');
  const files = p.files || [];
  if (files.length > MAX_FILES) throw new Error('แนบไฟล์ได้ไม่เกิน ' + MAX_FILES + ' ไฟล์');
  if (cat.Attach === 'required' && !files.length) throw new Error('หมวดนี้ต้องแนบเอกสาร');
  files.forEach(f => {
    if (ALLOWED_MIME.indexOf(f.mime) < 0) throw new Error('รองรับเฉพาะ PDF, PNG, JPG');
    if (f.data.length * 0.75 > MAX_BYTES) throw new Error('ไฟล์ ' + f.name + ' ใหญ่เกิน 5 MB');
  });

  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const d = new Date(), ymd = Utilities.formatDate(d, TZ, 'yyyyMMdd');
    const n = rows('Requests').filter(r => String(r.Request_ID).indexOf('HR-' + ymd) === 0).length + 1;
    const id = 'HR-' + ymd + '-' + ('00' + n).slice(-3);

    const folder = ensurePath([Utilities.formatDate(d, TZ, 'yyyy'), Utilities.formatDate(d, TZ, 'MM'), cat.Name]);
    const urls = files.map(f => folder.createFile(
      Utilities.newBlob(Utilities.base64Decode(f.data), f.mime, id + '_' + f.name.replace(/[\\/:*?"<>|]/g, '_'))).getUrl());

    const req = {
      Request_ID: id, Timestamp: now(), Line_UserID: user.userId, User_Name: user.name,
      Position: p.position || '', Department: p.department || '', Category: cat.Name,
      Detail: p.detail, Attachment_URLs: urls.join('\n'), Status: 'Pending', Updated_At: now(),
    };
    appendObj('Requests', req);
    saveProfile(user, p);
    log(user.name, 'CREATE', id);
    notifyNewRequest(req);
    return { id: id };
  } finally { lock.releaseLock(); }
}

function saveProfile(user, p) {
  const i = rows('Users').findIndex(u => u.Line_UserID === user.userId);
  if (i >= 0) sh('Users').getRange(i + 2, 4, 1, 2).setValues([[p.position || '', p.department || '']]);
}

const myRequests = user => rows('Requests').filter(r => r.Line_UserID === user.userId).reverse();

function getRequestsList(user, f) {
  requireAdmin(user, false);
  const q = String(f.q || '').toLowerCase();
  return rows('Requests').filter(r => {
    const day = String(r.Timestamp).slice(0, 10);
    return (!f.from || day >= f.from) && (!f.to || day <= f.to) &&
      (!f.category || r.Category === f.category) && (!f.status || r.Status === f.status) &&
      (!q || String(r.User_Name).toLowerCase().indexOf(q) >= 0 || String(r.Request_ID).toLowerCase().indexOf(q) >= 0);
  }).reverse();
}

function updateStatus(user, p) {
  const admin = requireAdmin(user, true);
  if (STATUSES.indexOf(p.status) < 0) throw new Error('สถานะไม่ถูกต้อง');
  const all = rows('Requests'), i = all.findIndex(r => r.Request_ID === p.id);
  if (i < 0) throw new Error('ไม่พบคำขอ');
  const r = all[i];

  let resultUrl = r.Result_URL || '';
  if (p.resultFile) {
    if (p.resultFile.mime !== 'application/pdf') throw new Error('ไฟล์ผลลัพธ์ต้องเป็น PDF');
    if (p.resultFile.data.length * 0.75 > MAX_BYTES * 2) throw new Error('ไฟล์ใหญ่เกิน 10 MB');
    const f = ensurePath(['Results']).createFile(Utilities.newBlob(
      Utilities.base64Decode(p.resultFile.data), 'application/pdf', p.id + '_result.pdf'));
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); // ผู้ขอเปิดจาก LINE ได้
    resultUrl = f.getUrl();
  }
  sh('Requests').getRange(i + 2, 10, 1, 5).setValues([[p.status, p.remark || '', now(), admin.Name || user.name, resultUrl]]);
  log(admin.Name || user.name, 'STATUS', p.id + ' → ' + p.status);

  let msg = 'คำขอเลขที่ ' + p.id + '\nเรื่อง: ' + r.Category + '\nสถานะ: ' + STATUS_TH[p.status];
  if (p.remark) msg += '\nหมายเหตุ: ' + p.remark;
  if (resultUrl) msg += '\n\nดาวน์โหลดเอกสาร (PDF):\n' + resultUrl;
  pushLine(r.Line_UserID, msg);
  return { ok: true, resultUrl: resultUrl };
}

function getDashboardStats(user, p) {
  requireAdmin(user, false);
  const list = rows('Requests').filter(r => {
    const d = String(r.Timestamp).slice(0, 10);
    return (!p.from || d >= p.from) && (!p.to || d <= p.to);
  });
  const count = fn => list.reduce((m, r) => { const k = fn(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    total: list.length,
    byDay: count(r => String(r.Timestamp).slice(0, 10)),
    byMonth: count(r => String(r.Timestamp).slice(0, 7)),
    byYear: count(r => String(r.Timestamp).slice(0, 4)),
    byCategory: count(r => r.Category),
    byStatus: count(r => r.Status),
  };
}

/* ---------- Drive ---------- */
function ensurePath(parts) {
  let f = DriveApp.getFolderById(P.getProperty('ROOT_FOLDER_ID'));
  parts.forEach(n => { const it = f.getFoldersByName(n); f = it.hasNext() ? it.next() : f.createFolder(n); });
  return f;
}

/* ---------- Notifications (อีเมล + LINE push) ---------- */
function notifyNewRequest(r) {
  const link = P.getProperty('ADMIN_URL') || '';
  const text = '📥 คำขอเอกสารใหม่\nเลขที่: ' + r.Request_ID + '\nผู้ขอ: ' + r.User_Name +
    '\nเรื่อง: ' + r.Category + '\nรายละเอียด: ' + String(r.Detail).slice(0, 120) + (link ? '\n\nเปิดหน้าตรวจสอบ: ' + link : '');
  try {
    MailApp.sendEmail({
      to: P.getProperty('ADMIN_EMAIL') || 'hrnep2013@gmail.com',
      subject: '[HR Portal] คำขอใหม่ ' + r.Request_ID + ' - ' + r.Category,
      htmlBody: '<div style="font-family:Tahoma,sans-serif"><h3>มีคำขอเอกสารใหม่</h3><p>เลขที่: <b>' + esc(r.Request_ID) +
        '</b><br>ผู้ขอ: ' + esc(r.User_Name) + ' (' + esc(r.Position) + ' ' + esc(r.Department) + ')<br>เรื่อง: ' + esc(r.Category) +
        '<br>รายละเอียด: ' + esc(r.Detail) + '</p>' + (r.Attachment_URLs ? '<p>ไฟล์แนบ:<br>' +
        String(r.Attachment_URLs).split('\n').map(u => '<a href="' + esc(u) + '">' + esc(u) + '</a>').join('<br>') + '</p>' : '') +
        (link ? '<p><a href="' + esc(link) + '">เปิดหน้าตรวจสอบ</a></p>' : '') + '</div>',
    });
  } catch (e) { log('system', 'MAIL_FAIL', String(e)); }
  rows('Admins').filter(a => a.Line_UserID && String(a.Notify).toUpperCase() === 'TRUE')
    .forEach(a => pushLine(a.Line_UserID, text));
}

function pushLine(to, text) {
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + P.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
    });
    if (res.getResponseCode() !== 200) log('system', 'PUSH_FAIL', to + ' ' + res.getContentText());
  } catch (e) { log('system', 'PUSH_FAIL', String(e)); }
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
