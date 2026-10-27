/**
 * mock-api.js – giả lập Google Apps Script của app "Check-in khi vào ca"
 * để frontend và QA test local, không cần Sheet thật.
 *
 * Chạy:   node tools/mock-api.js            (cổng 8787)
 *         node tools/mock-api.js --slow     (mọi request trễ 2000 ms, để test timeout 1500 ms)
 *         PORT=9000 node tools/mock-api.js  (đổi cổng)
 *         MOCK_DATA=D:\tmp\x.json node tools/mock-api.js  (đổi file dữ liệu)
 * Dán vào js/config.js:  GOOGLE_SCRIPT_URL: 'http://localhost:8787/'
 *
 * Contract y hệt google_apps_script.js:
 *   POST /                       body text/plain JSON → {result, action:'inserted'|'updated', row}
 *        lỗi: no_data | bad_json | level_invalid | emotion_required | emotion_invalid | session_invalid
 *        Server tự suy levelText từ level, tự tra name từ danh sách (bỏ name client gửi),
 *        created_at sai khuôn HH:mm:ss dd/MM/yyyy → giờ server.
 *   GET  /?action=lookup&id=…    → {result:'success', found, name?, reason?}
 *   GET  /?action=ping           → {result:'success', pong:true}
 *   GET  /                       → {result:'error', error:'public_read_disabled'}
 *   GET  /?action=khác           → {result:'error', error:'unknown_action'}
 *   &callback=fn → JSONP ở mọi nhánh GET.
 * Dữ liệu CheckIn giữ trong bộ nhớ và ghi ra file JSON trong thư mục tạm của máy
 * (%TEMP%\checkin-vao-ca-mock-data.json) – KHÔNG ghi vào thư mục Google Drive vì
 * Drive đồng bộ liên tục từng gây treo (QA G-01). Đường dẫn in ra lúc khởi động.
 * Không dependency ngoài Node.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');

/* ===== Cấu hình ===== */

const PORT = Number(process.env.PORT) || 8787;
const SLOW = process.argv.includes('--slow');
const SLOW_MS = 2000;
const DATA_FILE = process.env.MOCK_DATA
  ? path.resolve(process.env.MOCK_DATA)
  : path.join(os.tmpdir(), 'checkin-vao-ca-mock-data.json');

const ALLOW_PUBLIC_READ = false;
const ID_MAX_LENGTH = 32;
const NAME_MAX_LENGTH = 80;
const LEVEL_MIN = 1;
const LEVEL_MAX = 10;

// Giống google_apps_script.js: whitelist nhãn, khuôn created_at / sessionId
const EMOTION_LABELS = ['Vui vẻ', 'Buồn', 'Lo lắng', 'Tức giận', 'Hoảng hốt', 'Khó chịu'];
const LEVEL_TEXTS = ['', 'Rất mệt', 'Mệt', 'Hơi mệt', 'Hơi uể oải', 'Bình thường',
                     'Tạm ổn', 'Ổn', 'Khá tốt', 'Tốt', 'Rất tốt'];
const CREATED_AT_RE = /^\d{2}:\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/;
const SESSION_RE = /^[0-9A-Za-z-]{8,40}$/;

const COLUMNS = ['created_at', 'employeeId', 'name', 'level', 'levelText', 'emotion', 'sessionId'];

// Danh sách mẫu, thay cho tab DanhSach (cột A Mã, cột B Tên)
const DANH_SACH = [
  ['1001', 'Nguyễn Thị Hạnh'],
  ['1002', 'Trần Văn Minh'],
  ['1003', 'Lê Thu Thảo'],
  ['A123', 'Phạm Quốc Bảo'],
  ['2024', 'Võ Ngọc Lan']
];

/* ===== Tiện ích (viết giống google_apps_script.js) ===== */

function normalizeId(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return s.slice(0, ID_MAX_LENGTH);
}

function formatDate(d) {
  const p = (n) => ('0' + n).slice(-2);
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' ' +
         p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

/** Chống formula injection lớp hai: ô bắt đầu bằng = + - @ tab CR → thêm ' phía trước. */
function safeText(s) {
  const t = String(s == null ? '' : s);
  if (!t) return t;
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}

/** Mã ở ô cột A về chuỗi: số → bỏ phần lẻ (Sheets ăn số 0 đầu), Date → '' (bỏ qua). */
function cellId(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return '';
  if (typeof v === 'number') return isFinite(v) ? String(Math.round(v)) : '';
  return String(v);
}

function lookupName(rawId) {
  const id = normalizeId(rawId);
  if (!id) return { found: false, reason: 'id_empty' };
  const idNoZero = /^\d+$/.test(id) ? id.replace(/^0+(?=\d)/, '') : null;
  if (!DANH_SACH.length) return { found: false, reason: 'no_list' };
  for (const [code, name] of DANH_SACH) {
    const cid = cellId(code);
    if (!cid) continue;
    const norm = normalizeId(cid);
    const hit = norm === id || (typeof code === 'number' && idNoZero !== null && norm === idNoZero);
    if (hit) {
      const n = String(name == null ? '' : name).trim().slice(0, NAME_MAX_LENGTH);
      if (!n) continue;
      return { found: true, name: n };
    }
  }
  return { found: false };
}

/**
 * Trả '' nếu hợp lệ, hoặc mã lỗi (level_invalid | emotion_required | emotion_invalid |
 * session_invalid). Sửa data tại chỗ y như validateCheckin_ trong script thật.
 */
function validateCheckin(data) {
  const lv = Number(data.level);
  if (data.level === '' || data.level == null || !isFinite(lv) || lv !== Math.floor(lv) ||
      lv < LEVEL_MIN || lv > LEVEL_MAX) {
    return 'level_invalid';
  }
  data.level = lv;
  data.levelText = LEVEL_TEXTS[lv];                 // bỏ qua client
  const emo = String(data.emotion == null ? '' : data.emotion).trim();
  if (!emo) return 'emotion_required';
  if (!EMOTION_LABELS.includes(emo)) return 'emotion_invalid';
  data.emotion = emo;
  const sid = String(data.sessionId == null ? '' : data.sessionId).trim();
  if (!SESSION_RE.test(sid)) return 'session_invalid';
  data.sessionId = sid;
  data.employeeId = normalizeId(data.employeeId);
  const ca = String(data.created_at == null ? '' : data.created_at).trim();
  data.created_at = CREATED_AT_RE.test(ca) ? ca : formatDate(new Date());
  data.name = '';                                   // handlePost tra lại từ danh sách
  return '';
}

/* ===== "Sheet" trong bộ nhớ + file ===== */

let rows = []; // mỗi phần tử là object 7 trường, thứ tự = số dòng trên Sheet (dòng 2 trở đi)

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(parsed)) rows = parsed;
  } catch (e) {
    rows = [];
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), 'utf8');
  } catch (e) {
    console.warn('mock-api: không ghi được ' + DATA_FILE + ': ' + e.message);
  }
}

/** Upsert theo sessionId. Trả {action, row}; row tính như Sheet (tiêu đề là dòng 1). */
function upsert(data) {
  const rec = {};
  for (const k of COLUMNS) {
    const v = data[k];
    rec[k] = v == null ? '' : (typeof v === 'string' ? safeText(v) : v);
  }
  const idx = rows.findIndex((r) => String(r.sessionId) === String(data.sessionId));
  if (idx >= 0) {
    rows[idx] = rec;
    saveData();
    return { action: 'updated', row: idx + 2 };
  }
  rows.push(rec);
  saveData();
  return { action: 'inserted', row: rows.length + 1 };
}

/* ===== HTTP ===== */

function send(res, obj, callback) {
  const text = JSON.stringify(obj);
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  };
  if (callback) {
    const fn = String(callback).replace(/[^0-9A-Za-z_$.]/g, '');
    headers['Content-Type'] = 'text/javascript; charset=utf-8';
    res.writeHead(200, headers);
    res.end(fn + '(' + text + ');');
    return;
  }
  headers['Content-Type'] = 'application/json; charset=utf-8';
  res.writeHead(200, headers);
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(body));
  });
}

function handleGet(params) {
  const action = String(params.get('action') == null ? '' : params.get('action')).trim();
  if (action === 'ping') return { result: 'success', pong: true };
  if (action === 'lookup') {
    const r = lookupName(params.get('id'));
    const out = { result: 'success', found: r.found };
    if (r.found) out.name = r.name;
    if (r.reason) out.reason = r.reason;
    return out;
  }
  if (!action) {
    if (!ALLOW_PUBLIC_READ) return { result: 'error', error: 'public_read_disabled' };
    return { result: 'success', count: rows.length, data: rows };
  }
  return { result: 'error', error: 'unknown_action' };
}

function handlePost(body) {
  if (!body) return { result: 'error', error: 'no_data' };
  let data;
  try { data = JSON.parse(body); } catch (e) { return { result: 'error', error: 'bad_json' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { result: 'error', error: 'bad_json' };
  const invalid = validateCheckin(data);
  if (invalid) return { result: 'error', error: invalid };
  // Tên tra phía server theo mã, không dùng tên client gửi
  const found = lookupName(data.employeeId);
  data.name = found.found ? found.name : '';
  const r = upsert(data);
  return { result: 'success', action: r.action, row: r.row };
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const url = new URL(req.url, 'http://localhost');
  const callback = url.searchParams.get('callback') || '';
  let out;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end();
    console.log(`${req.method} ${req.url} → 204 ${Date.now() - t0}ms`);
    return;
  }

  if (SLOW) await new Promise((r) => setTimeout(r, SLOW_MS));

  if (req.method === 'POST') {
    out = handlePost(await readBody(req));
  } else if (req.method === 'GET') {
    out = handleGet(url.searchParams);
  } else {
    out = { result: 'error', error: 'method_not_allowed' };
  }
  send(res, out, callback);
  const brief = out.result === 'success'
    ? (out.action || (out.pong ? 'pong' : 'found=' + out.found + (out.name ? ' ' + out.name : '') + (out.reason ? ' ' + out.reason : '')))
    : 'error=' + out.error;
  console.log(`${req.method} ${req.url} → ${brief} ${Date.now() - t0}ms`);
});

loadData();
server.listen(PORT, () => {
  console.log(`mock-api: http://localhost:${PORT}/  (${SLOW ? 'SLOW ' + SLOW_MS + 'ms' : 'nhanh'}), dữ liệu: ${DATA_FILE}, ${rows.length} dòng sẵn có`);
  console.log('mock-api: Ctrl+C để tắt');
});
