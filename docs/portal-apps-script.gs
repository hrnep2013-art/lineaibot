/**
 * HR Document Portal — Backend (Google Apps Script, container-bound กับ Google Sheet)
 * Deploy: Web app / Execute as: Me / Who has access: Anyone
 * ใช้เฉพาะไฟล์นี้ไฟล์เดียวใน Apps Script (ไฟล์ .html/.js/.css ไปอยู่ที่ Vercel)
 *
 * Script Properties: LOGIN_CHANNEL_ID, LINE_CHANNEL_ACCESS_TOKEN, ADMIN_URL (ลิงก์หน้าแอดมิน), ADMIN_EMAIL (ไม่ตั้งก็ใช้ hrnep2013@gmail.com)
 *
 * ขั้นตอนอนุมัติ: Pending → (เจ้าหน้าที่ Staff) → WaitDirector → (ผอ. Director) → Approved
 *                 → (Staff ส่ง PDF ทาง LINE OA เอง แล้วกดบันทึก) → Sent      / ไม่อนุมัติได้ทุกขั้น → Rejected
 */
const TZ = 'Asia/Bangkok';
const P = PropertiesService.getScriptProperties();
const STATUSES = ['Pending', 'WaitDirector', 'Approved', 'Sent', 'Rejected'];
const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_FILES = 5, MAX_BYTES = 5 * 1024 * 1024;

const SCHEMA = {
  Requests: ['Request_ID', 'Timestamp', 'Line_UserID', 'User_Name', 'Position', 'Department', 'Phone', 'Category', 'Detail',
    'Purpose', 'Submit_To', 'Attachment_URLs', 'Status', 'Staff_Remark', 'Staff_By', 'Staff_At', 'Director_Remark',
    'Director_By', 'Director_At', 'Sent_At', 'Sent_By', 'Updated_At'],
  Users: ['Line_UserID', 'Display_Name', 'Picture_URL', 'First_Name', 'Last_Name', 'Position', 'Department', 'Phone', 'First_Seen', 'Last_Seen'],
  Categories: ['Name', 'Active', 'Attach', 'Hint'], // Attach: required | optional | none
  Admins: ['Line_UserID', 'Name', 'Role', 'Notify'], // Role: Staff (เจ้าหน้าที่) | Director (ผอ.กลุ่มบริหารทรัพยากรบุคคล) | Viewer
  Logs: ['Timestamp', 'Actor', 'Action', 'Detail'],
};

/* ---------- Setup (รันได้ซ้ำ: เพิ่มชีต/คอลัมน์ที่ขาดให้ ไม่ลบข้อมูลเดิม) ---------- */
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SCHEMA).forEach(n => {
    const s = ss.getSheetByName(n) || ss.insertSheet(n);
    if (s.getLastRow() === 0) s.appendRow(SCHEMA[n]);
    const h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
    SCHEMA[n].filter(k => h.indexOf(k) < 0).forEach(k => s.getRange(1, s.getLastColumn() + 1).setValue(k));
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
}

/* ---------- Entry points ---------- */
function doGet() { return json({ ok: true, service: 'HR Document Portal API' }); }

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const user = verifyToken(body.idToken), p = body.payload || {};
    const routes = {
      getMe: () => getMe(user), saveRequest: () => saveRequest(user, p), myRequests: () => myRequests(user),
      getRequestsList: () => getRequestsList(user, p), reviewRequest: () => reviewRequest(user, p),
      markSent: () => markSent(user, p), getDashboardStats: () => getDashboardStats(user, p),
    };
    if (!routes[body.action]) throw new Error('UNKNOWN_ACTION');
    return json({ ok: true, data: routes[body.action]() });
  } catch (err) {
    log('-', 'ERROR', String(err));
    return json({ ok: false, error: String(err.message || err) });
  }
}
const json = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

/* ---------- Auth: ตรวจ LINE ID token ฝั่ง server ---------- */
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
const adminOf = user => rows('Admins').find(a => a.Line_UserID === user.userId);
function requireRole(user, roles) {
  const a = adminOf(user);
  if (!a || (roles && roles.indexOf(String(a.Role).trim()) < 0)) throw new Error('FORBIDDEN');
  return a;
}

/* ---------- Sheet helpers (อ้างคอลัมน์ตามชื่อหัวตาราง ไม่ผูกลำดับ) ---------- */
const sh = n => SpreadsheetApp.getActive().getSheetByName(n);
const now = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
const headers = n => { const s = sh(n); return s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]; };
function rows(name) {
  const v = sh(name).getDataRange().getValues(), h = v.shift();
  return v.map(r => Object.fromEntries(h.map((k, i) =>
    [k, r[i] instanceof Date ? Utilities.formatDate(r[i], TZ, 'yyyy-MM-dd HH:mm:ss') : r[i]])));
}
const appendObj = (n, o) => sh(n).appendRow(headers(n).map(k => o[k] == null ? '' : o[k]));
function setCells(n, i, o) { // i = index ใน rows() (เริ่ม 0)
  const s = sh(n), h = headers(n);
  Object.keys(o).forEach(k => { const c = h.indexOf(k); if (c >= 0) s.getRange(i + 2, c + 1).setValue(o[k]); });
}
function log(actor, action, detail) { try { appendObj('Logs', { Timestamp: now(), Actor: actor, Action: action, Detail: detail }); } catch (e) {} }

/* ---------- API ---------- */
function getMe(user) {
  const all = rows('Users'), i = all.findIndex(u => u.Line_UserID === user.userId);
  let prof = all[i];
  if (i < 0) {
    prof = { Line_UserID: user.userId, Display_Name: user.name, Picture_URL: user.picture, First_Seen: now(), Last_Seen: now() };
    appendObj('Users', prof);
  } else setCells('Users', i, { Last_Seen: now() });
  const a = adminOf(user);
  return {
    userId: user.userId, name: user.name, picture: user.picture,
    firstName: prof.First_Name || '', lastName: prof.Last_Name || '', position: prof.Position || '',
    department: prof.Department || '', phone: prof.Phone || '',
    isAdmin: !!a, role: a ? String(a.Role).trim() : '',
    categories: rows('Categories').filter(c => String(c.Active).toUpperCase() === 'TRUE')
      .map(c => ({ name: c.Name, attach: c.Attach, hint: c.Hint })),
  };
}

function saveRequest(user, p) {
  const cat = rows('Categories').find(c => c.Name === p.category);
  const need = { firstName: 'ชื่อ', lastName: 'นามสกุล', position: 'ตำแหน่ง', department: 'กลุ่มงาน/หน่วยงาน', detail: 'เอกสารที่ต้องการ', purpose: 'วัตถุประสงค์' };
  Object.keys(need).forEach(k => { if (!String(p[k] || '').trim()) throw new Error('กรุณากรอก' + need[k]); });
  if (!cat) throw new Error('หมวดหมู่ไม่ถูกต้อง');
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
    const t = k => String(p[k] || '').trim();
    const req = {
      Request_ID: id, Timestamp: now(), Line_UserID: user.userId, User_Name: t('firstName') + ' ' + t('lastName'),
      Position: t('position'), Department: t('department'), Phone: t('phone'), Category: cat.Name, Detail: t('detail'),
      Purpose: t('purpose'), Submit_To: t('submitTo'), Attachment_URLs: urls.join('\n'), Status: 'Pending', Updated_At: now(),
    };
    appendObj('Requests', req);
    const ui = rows('Users').findIndex(u => u.Line_UserID === user.userId);
    if (ui >= 0) setCells('Users', ui, { First_Name: t('firstName'), Last_Name: t('lastName'), Position: t('position'), Department: t('department'), Phone: t('phone') });
    log(req.User_Name, 'CREATE', id);

    const sum = summary(req);
    mailAdmin('[HR Portal] คำขอใหม่ ' + id + ' - ' + cat.Name, sum + '\n\nไฟล์แนบ:\n' + (req.Attachment_URLs || '-'));
    notifyRole('Staff', '📥 คำขอเอกสารใหม่ รอเจ้าหน้าที่ตรวจสอบ\n' + sum + adminLink());
    pushLine(user.userId, 'ได้รับคำขอเลขที่ ' + id + ' แล้ว\nเรื่อง: ' + cat.Name + '\nขั้นตอน: เจ้าหน้าที่ตรวจสอบ → ผอ.กลุ่มบริหารทรัพยากรบุคคลอนุมัติ → ส่งเอกสาร PDF ทางแชทนี้');
    return { id: id };
  } finally { lock.releaseLock(); }
}

const myRequests = user => rows('Requests').filter(r => r.Line_UserID === user.userId).reverse();

function getRequestsList(user, f) {
  requireRole(user);
  const q = String(f.q || '').toLowerCase();
  return rows('Requests').filter(r => {
    const day = String(r.Timestamp).slice(0, 10);
    return (!f.from || day >= f.from) && (!f.to || day <= f.to) && (!f.category || r.Category === f.category) &&
      (!f.status || r.Status === f.status) &&
      (!q || String(r.User_Name).toLowerCase().indexOf(q) >= 0 || String(r.Request_ID).toLowerCase().indexOf(q) >= 0);
  }).reverse();
}

/* เจ้าหน้าที่: Pending → WaitDirector | Rejected     ผอ.: WaitDirector → Approved | Rejected */
function reviewRequest(user, p) {
  const a = requireRole(user, ['Staff', 'Director']), role = String(a.Role).trim(), by = a.Name || user.name;
  const all = rows('Requests'), i = all.findIndex(r => r.Request_ID === p.id);
  if (i < 0) throw new Error('ไม่พบคำขอ');
  const r = all[i], ok = p.decision === 'approve', remark = String(p.remark || '').trim();
  if (!ok && !remark) throw new Error('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
  let upd;
  if (role === 'Staff') {
    if (r.Status !== 'Pending') throw new Error('คำขอนี้ไม่อยู่ในขั้นตอนของเจ้าหน้าที่');
    upd = { Status: ok ? 'WaitDirector' : 'Rejected', Staff_Remark: remark, Staff_By: by, Staff_At: now() };
  } else {
    if (r.Status !== 'WaitDirector') throw new Error('คำขอนี้ยังไม่ถึงขั้นตอน ผอ. หรือดำเนินการไปแล้ว');
    upd = { Status: ok ? 'Approved' : 'Rejected', Director_Remark: remark, Director_By: by, Director_At: now() };
  }
  upd.Updated_At = now();
  setCells('Requests', i, upd);
  log(by, role + (ok ? '_APPROVE' : '_REJECT'), p.id);

  const head = 'คำขอเลขที่ ' + r.Request_ID + '\nเรื่อง: ' + r.Category;
  const sum = summary(r);
  if (!ok) {
    pushLine(r.Line_UserID, head + '\nสถานะ: ไม่อนุมัติ\nเหตุผล: ' + remark);
  } else if (role === 'Staff') {
    pushLine(r.Line_UserID, head + '\nสถานะ: เจ้าหน้าที่ตรวจสอบแล้ว อยู่ระหว่างรอ ผอ.กลุ่มบริหารทรัพยากรบุคคลอนุมัติ');
    mailAdmin('[HR Portal] รอ ผอ. อนุมัติ ' + r.Request_ID, sum);
    notifyRole('Director', '📝 มีคำขอรอพิจารณาอนุมัติ\n' + sum + adminLink());
  } else {
    pushLine(r.Line_UserID, head + '\nสถานะ: อนุมัติแล้ว เจ้าหน้าที่จะส่งเอกสาร PDF ให้ทางแชทนี้');
    mailAdmin('[HR Portal] อนุมัติแล้ว รอส่งเอกสาร ' + r.Request_ID, sum);
    notifyRole('Staff', '✅ ผอ. อนุมัติแล้ว กรุณาส่งไฟล์ PDF ให้ ' + r.User_Name + ' ทางแชท LINE OA แล้วกด "บันทึกว่าส่งเอกสารแล้ว"\n' + sum + adminLink());
  }
  return { status: upd.Status };
}

/* เจ้าหน้าที่ส่ง PDF ทางแชท LINE OA เอง แล้วกดบันทึกในระบบ (ระบบไม่ส่งไฟล์ให้) */
function markSent(user, p) {
  const a = requireRole(user, ['Staff']), by = a.Name || user.name;
  const all = rows('Requests'), i = all.findIndex(r => r.Request_ID === p.id);
  if (i < 0) throw new Error('ไม่พบคำขอ');
  if (all[i].Status !== 'Approved') throw new Error('ต้องได้รับอนุมัติจาก ผอ. ก่อน');
  setCells('Requests', i, { Status: 'Sent', Sent_At: now(), Sent_By: by, Updated_At: now() });
  log(by, 'SENT', p.id);
  pushLine(all[i].Line_UserID, 'คำขอเลขที่ ' + p.id + '\nสถานะ: ส่งเอกสารให้แล้วทางแชทนี้ กรุณาตรวจสอบไฟล์ PDF จากเจ้าหน้าที่');
  return { status: 'Sent' };
}

function getDashboardStats(user, p) {
  requireRole(user);
  const list = rows('Requests').filter(r => {
    const d = String(r.Timestamp).slice(0, 10);
    return (!p.from || d >= p.from) && (!p.to || d <= p.to);
  });
  const count = fn => list.reduce((m, r) => { const k = fn(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    total: list.length, byDay: count(r => String(r.Timestamp).slice(0, 10)), byMonth: count(r => String(r.Timestamp).slice(0, 7)),
    byYear: count(r => String(r.Timestamp).slice(0, 4)), byCategory: count(r => r.Category), byStatus: count(r => r.Status),
  };
}

/* ---------- Drive ---------- */
function ensurePath(parts) {
  let f = DriveApp.getFolderById(P.getProperty('ROOT_FOLDER_ID'));
  parts.forEach(n => { const it = f.getFoldersByName(n); f = it.hasNext() ? it.next() : f.createFolder(n); });
  return f;
}

/* ---------- Notifications (อีเมล + LINE push) ---------- */
const adminLink = () => P.getProperty('ADMIN_URL') ? '\n\nเปิดหน้าตรวจสอบ: ' + P.getProperty('ADMIN_URL') : '';
const summary = r => 'เลขที่: ' + r.Request_ID + '\nผู้ขอ: ' + r.User_Name + ' (' + r.Position + ' ' + r.Department + ')' +
  '\nเรื่อง: ' + r.Category + '\nเอกสารที่ต้องการ: ' + String(r.Detail).slice(0, 100) + '\nวัตถุประสงค์: ' + String(r.Purpose).slice(0, 100);

function mailAdmin(subject, text) {
  try { MailApp.sendEmail({ to: P.getProperty('ADMIN_EMAIL') || 'hrnep2013@gmail.com', subject: subject, body: text + adminLink() }); }
  catch (e) { log('system', 'MAIL_FAIL', String(e)); }
}
const notifyRole = (role, text) => rows('Admins')
  .filter(a => a.Line_UserID && String(a.Role).trim() === role && String(a.Notify).toUpperCase() === 'TRUE')
  .forEach(a => pushLine(a.Line_UserID, text));

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
