/**
 * ============================================================
 *  GOOGLE APPS SCRIPT – backend cho app "Check-in khi vào ca"
 *  (gốc: docs/style/apps-script-template.js của đội App Creator)
 * ============================================================
 *  Chức năng:
 *   1) doPost : nhận JSON từ web, ghi 1 dòng vào tab CheckIn.
 *               Cùng một sessionId (cột G, ẩn) thì CẬP NHẬT dòng cũ → bấm đúp
 *               hay gửi lại vẫn chỉ một dòng.
 *   2) doGet?action=lookup&id=1234 : dò tên trong tab DanhSach, trả {found, name}.
 *   3) doGet?action=ping           : đánh thức script lúc tải trang.
 *   4) doGet không có action       : ĐANG TẮT (ALLOW_PUBLIC_READ = false),
 *               bật lại khi làm trang tổng hợp.
 *
 *  ------------------------------------------------------------
 *  HƯỚNG DẪN CÀI ĐẶT (anh Thông tự làm trên tài khoản của anh,
 *  khoảng 10 phút, làm đúng thứ tự)
 *  ------------------------------------------------------------
 *  BƯỚC 1 – Tạo Google Sheet
 *    1.1 Vào https://sheets.new (đăng nhập bsngvanthong@gmail.com).
 *    1.2 Đặt tên file, ví dụ "Check-in vào ca".
 *    1.3 Tab đầu tiên đang tên "Trang tính1" (hoặc "Sheet1"): nhấp đúp vào
 *        tên tab ở góc dưới, đổi thành  CheckIn  (viết liền, C và I hoa).
 *        Không cần gõ tiêu đề cột: script tự tạo 7 cột và tự ẩn cột G.
 *
 *  BƯỚC 2 – Tạo tab DanhSach (danh sách nhân viên)
 *    2.1 Bấm dấu + ở góc dưới bên trái để thêm tab mới, đổi tên thành  DanhSach
 *        (viết liền, D và S hoa, không dấu).
 *    2.2 Ô A1 gõ  Mã  , ô B1 gõ  Tên  .
 *    2.3 QUAN TRỌNG, làm TRƯỚC khi nhập mã: bấm vào chữ A trên đầu cột để chọn
 *        cả cột A → menu Định dạng (Format) → Số (Number) → Văn bản thuần
 *        (Plain text). Nhờ vậy mã 0042 giữ nguyên số 0 đầu, mã 1-2 không bị
 *        Sheets đổi thành ngày tháng. (Script cũng tự đặt định dạng này mỗi
 *        lần chạy, nhưng mã đã gõ trước đó thì không tự sửa lại được.)
 *    2.4 Từ dòng 2 trở đi: cột A là mã nhân viên (ví dụ 1234), cột B là tên
 *        đầy đủ (ví dụ Nguyễn Thị Hạnh). Mã gõ số thường, không gõ số
 *        full-width; có gạch nối hay khoảng trắng cũng được, script tự bỏ.
 *    2.5 Chưa có danh sách cũng không sao: script tự tạo tab trống, ai nhập
 *        mã cũng nhận lời chào chung và cột Tên để trống. Nhập sau vẫn được.
 *    2.6 Cột Tên trong tab CheckIn LUÔN lấy từ DanhSach theo mã (script tự tra),
 *        không nhận tên do điện thoại gửi lên. Muốn đổi tên ai thì sửa DanhSach.
 *
 *  BƯỚC 3 – Dán script
 *    3.1 Trên Sheet: menu Tiện ích mở rộng (Extensions) → Apps Script.
 *    3.2 Trong file Code.gs, xóa hết code mẫu, dán TOÀN BỘ file này vào.
 *    3.3 Bấm biểu tượng đĩa mềm (Lưu) hoặc Ctrl+S.
 *
 *  BƯỚC 4 – Chạy thử một lần trong editor (tùy chọn nhưng nên làm)
 *    4.1 Ở thanh công cụ, ô chọn hàm (cạnh nút Chạy/Run) chọn  test_  rồi bấm Chạy.
 *    4.2 Lần đầu Google hỏi quyền: Xem lại quyền → chọn tài khoản → Nâng cao
 *        (Advanced) → Đi tới … (không an toàn) → Cho phép. Đây là script của
 *        chính anh nên cảnh báo này là bình thường.
 *    4.3 Mở Nhật ký thực thi (Execution log) ở dưới: thấy các dòng "test_: ..."
 *        và cuối cùng "test_: XONG" là được. Dòng thử đã được xóa tự động.
 *
 *  BƯỚC 5 – Triển khai thành Ứng dụng web
 *    5.1 Nút Triển khai (Deploy) ở góc trên phải → Triển khai mới (New deployment).
 *    5.2 Bấm bánh răng cạnh "Chọn loại" → Ứng dụng web (Web app).
 *    5.3 Mô tả: gõ gì cũng được, ví dụ "v1".
 *        Thực thi với tư cách (Execute as): Tôi (Me).
 *        Ai có quyền truy cập (Who has access): Bất kỳ ai (Anyone).
 *        (Phải là "Bất kỳ ai", KHÔNG phải "Bất kỳ ai có tài khoản Google",
 *        nếu không điện thoại trực sẽ bị bắt đăng nhập.)
 *    5.4 Bấm Triển khai. Nếu hỏi quyền thì cho phép như bước 4.2.
 *    5.5 Chép dòng  URL ứng dụng web  (dạng https://script.google.com/macros/s/.../exec).
 *        Đó là GOOGLE_SCRIPT_URL. Gửi URL này cho đội để dán vào js/config.js.
 *
 *  BƯỚC 6 – Kiểm tra nhanh trên trình duyệt
 *    6.1 Mở  <URL>?action=ping        → thấy {"result":"success","pong":true}
 *    6.2 Mở  <URL>?action=lookup&id=1234  (thay 1234 bằng một mã có trong DanhSach)
 *        → thấy {"result":"success","found":true,"name":"..."}
 *    6.3 Mở  <URL>  (không có gì phía sau) → thấy "public_read_disabled": đúng ý,
 *        nghĩa là không ai xem được dữ liệu CheckIn qua đường link.
 *
 *  LẦN SAU SỬA CODE: dán code mới → Lưu → Triển khai → Quản lý bản triển khai
 *    → biểu tượng bút chì → Phiên bản: Phiên bản mới → Triển khai.
 *    URL giữ nguyên, không phải sửa config.js.
 *
 *  Phía web gửi bằng:
 *    fetch(URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
 *  (Content-Type text/plain để tránh preflight CORS.)
 * ============================================================
 */

/* ===== Cấu hình ===== */

// Cho phép GET không có action trả toàn bộ tab CheckIn (dùng cho trang tổng hợp).
// Đang TẮT vì tab CheckIn có mã và tên nhân viên; ai có URL cũng đọc được.
// Khi làm trang tổng hợp (US-5): đổi thành true, hoặc tốt hơn là thêm kiểm tra
// &token= so với một giá trị đặt trong Script Properties.
var ALLOW_PUBLIC_READ = false;

// Tên hai tab trong Sheet. Đổi ở đây nếu anh đặt tên tab khác.
var CHECKIN_SHEET = 'CheckIn';   // nơi ghi mỗi lượt check-in
var LIST_SHEET    = 'DanhSach';  // danh sách mã → tên, người phụ trách nhập tay, app chỉ đọc

// Cột trong tab CheckIn. Khóa (key) trùng tên trường trong payload client gửi lên.
// 6 cột đầu đúng PRD; cột G "Mã phiên" là cột kỹ thuật để chống dòng đôi, script tự ẩn.
var COLUMNS = [
  { key: 'created_at', header: 'Thời gian' },
  { key: 'employeeId', header: 'Mã nhân viên' },
  { key: 'name',       header: 'Tên' },
  { key: 'level',      header: 'Mức (1–10)' },
  { key: 'levelText',  header: 'Mức chữ' },
  { key: 'emotion',    header: 'Cảm xúc Capybara' },
  { key: 'sessionId',  header: 'Mã phiên' }
];
var SESSION_KEY = 'sessionId';
var SESSION_COL = 7;              // cột G, ẩn sau khi tạo tiêu đề

var ID_MAX_LENGTH   = 32;         // cắt mã trước khi xử lý
var NAME_MAX_LENGTH = 80;         // cắt tên trả về
var SESSION_MIN     = 8;
var SESSION_MAX     = 40;
var LEVEL_MIN       = 1;
var LEVEL_MAX       = 10;

// 6 nhãn thẻ Capybara, PHẢI trùng nguyên văn js/data.js (EMOTIONS[].label).
// Server chỉ nhận đúng một trong 6 chuỗi này → không ai ghi được công thức vào cột F.
var EMOTION_LABELS = ['Vui vẻ', 'Buồn', 'Lo lắng', 'Tức giận', 'Hoảng hốt', 'Khó chịu'];

// 10 nhãn mức chữ theo level, PHẢI trùng js/data.js (LEVELS[n].text). Index 0 bỏ trống.
// Server tự suy levelText từ level, KHÔNG dùng chuỗi client gửi.
var LEVEL_TEXTS = ['', 'Rất mệt', 'Mệt', 'Hơi mệt', 'Hơi uể oải', 'Bình thường',
                   'Tạm ổn', 'Ổn', 'Khá tốt', 'Tốt', 'Rất tốt'];

// Khuôn created_at client gửi (HH:mm:ss dd/MM/yyyy); sai khuôn → lấy giờ server.
var CREATED_AT_RE = /^\d{2}:\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/;
// Khuôn sessionId: chữ/số/gạch nối, 8–40 ký tự (client sinh dạng xxxxxxxx-xxxx-...).
var SESSION_RE    = /^[0-9A-Za-z-]{8,40}$/;

// Múi giờ ghi cột Thời gian khi server tự điền (Apps Script chạy ở múi giờ Google).
var TIME_ZONE = 'Asia/Ho_Chi_Minh';

// Nếu DanhSach > 2.000 dòng và lookup chậm: bật CacheService 5 phút cho bảng
// mã→tên (đọc getValues một lần rồi cache JSON). Mặc định tắt, chưa cần.
var USE_LIST_CACHE = false;
var LIST_CACHE_SEC = 300;

/* ===== Tiện ích chung ===== */

/** Chuẩn hóa mã nhân viên. VIẾT GIỐNG HỆT phía client (js/app.js). */
function normalizeId_(raw) {
  var s = String(raw == null ? '' : raw).trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return s.slice(0, ID_MAX_LENGTH);
}

/** Giờ dạng HH:mm:ss dd/MM/yyyy theo giờ Việt Nam, trùng định dạng client gửi. */
function formatDate_(d) {
  // Trên Apps Script: dùng Utilities để ép múi giờ Asia/Ho_Chi_Minh.
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    return Utilities.formatDate(d, TIME_ZONE, 'HH:mm:ss dd/MM/yyyy');
  }
  // Fallback (khi chạy test bằng Node, không có Utilities): giờ máy.
  function p(n) { return ('0' + n).slice(-2); }
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' ' +
         p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

/**
 * Phòng thủ lớp hai chống formula injection: Sheets coi ô bắt đầu bằng = + - @
 * (và tab, CR) là công thức. Thêm dấu nháy đơn ' phía trước → Sheets hiểu là văn
 * bản thuần, dấu nháy không hiện ra trong ô. Áp cho MỌI chuỗi trước khi ghi,
 * dù đã whitelist/regex ở lớp một.
 */
function safeText_(s) {
  var t = String(s == null ? '' : s);
  if (!t) return t;
  var c = t.charAt(0);
  if (c === '=' || c === '+' || c === '-' || c === '@' || c === '\t' || c === '\r') return "'" + t;
  return t;
}

/** Trả JSON, hoặc JSONP khi có callback (fallback cho WebView chặn CORS). */
function json_(obj, callback) {
  var text = JSON.stringify(obj);
  if (callback) {
    // chỉ cho phép tên hàm JS hợp lệ, tránh chèn mã lạ qua callback
    var fn = String(callback).replace(/[^0-9A-Za-z_$.]/g, '');
    return ContentService.createTextOutput(fn + '(' + text + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/* ===== Tab CheckIn ===== */

/** Lấy tab CheckIn theo tên; chưa có thì tạo. */
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CHECKIN_SHEET);
  if (!sh) sh = ss.insertSheet(CHECKIN_SHEET);
  return sh;
}

/**
 * Tạo hàng tiêu đề nếu tab trống: tô navy nhạt, đóng băng hàng 1, ẩn cột G.
 * Nếu Sheet đã có dữ liệu từ bản cũ chỉ 6 cột: bổ sung tiêu đề G "Mã phiên" và ẩn.
 */
function ensureHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map(function (c) { return c.header; }));
    var h = sheet.getRange(1, 1, 1, COLUMNS.length);
    h.setFontWeight('bold').setBackground('#E3EAF3').setFontColor('#1F3A5F');
    sheet.setFrozenRows(1);
    sheet.hideColumns(SESSION_COL);
    textColumns_(sheet);
    return;
  }
  // Sheet cũ thiếu cột G → ghi tiêu đề và ẩn, không đụng 6 cột đầu
  var gHeader = COLUMNS[SESSION_COL - 1].header;
  if (sheet.getRange(1, SESSION_COL).getValue() !== gHeader) {
    sheet.getRange(1, SESSION_COL).setValue(gHeader)
         .setFontWeight('bold').setBackground('#E3EAF3').setFontColor('#1F3A5F');
    sheet.hideColumns(SESSION_COL);
  }
  textColumns_(sheet);
}

/**
 * Cột B (Mã nhân viên) và G (Mã phiên) phải là văn bản thuần, nếu không Sheets
 * ép '0042' thành số 42 và lọc/VLOOKUP theo mã sẽ lệch với DanhSach.
 * Chỉ ghi định dạng khi chưa đúng (một lần đọc rẻ hơn một lần ghi cả cột).
 */
function textColumns_(sheet) {
  try {
    if (sheet.getRange('B2').getNumberFormat() !== '@') sheet.getRange('B:B').setNumberFormat('@');
    if (sheet.getRange('G2').getNumberFormat() !== '@') sheet.getRange('G:G').setNumberFormat('@');
  } catch (ignored) {}
}

/** Tìm dòng có sessionId trùng (cột SESSION_KEY). Trả về số dòng hoặc -1. */
function findSessionRow_(sheet, sessionId) {
  var col = -1;
  for (var k = 0; k < COLUMNS.length; k++) { if (COLUMNS[k].key === SESSION_KEY) { col = k; break; } }
  if (col < 0 || !sessionId) return -1;
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var values = sheet.getRange(2, col + 1, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(sessionId)) return i + 2;
  }
  return -1;
}

/**
 * Kiểm tra payload. Trả về chuỗi mã lỗi
 *   level_invalid | emotion_required | emotion_invalid | session_invalid
 * hoặc '' nếu hợp lệ. Có sửa tại chỗ: employeeId chuẩn hóa, level thành số nguyên,
 * levelText suy từ level, created_at sai khuôn → giờ server, name bị XÓA
 * (doPost tra lại từ DanhSach). Mọi ô ghi vào Sheet đều đi qua whitelist/regex,
 * nên không chuỗi nào bắt đầu bằng = + - @ lọt được (chống formula injection).
 */
function validateCheckin_(data) {
  // level: số nguyên 1..10 (nhận cả "7" dạng chuỗi)
  var lv = Number(data.level);
  if (data.level === '' || data.level == null || !isFinite(lv) || lv !== Math.floor(lv) ||
      lv < LEVEL_MIN || lv > LEVEL_MAX) {
    return 'level_invalid';
  }
  data.level = lv;

  // levelText: bỏ qua giá trị client, tự suy từ level
  data.levelText = LEVEL_TEXTS[lv];

  // emotion: rỗng → emotion_required; có nhưng không thuộc 6 nhãn → emotion_invalid
  var emo = String(data.emotion == null ? '' : data.emotion).trim();
  if (!emo) return 'emotion_required';
  if (EMOTION_LABELS.indexOf(emo) < 0) return 'emotion_invalid';
  data.emotion = emo;

  // sessionId: 8–40 ký tự, chỉ chữ/số/gạch nối
  var sid = String(data[SESSION_KEY] == null ? '' : data[SESSION_KEY]).trim();
  if (!SESSION_RE.test(sid)) return 'session_invalid';
  data[SESSION_KEY] = sid;

  // employeeId: chuẩn hóa lại dù client đã làm (chỉ còn chữ/số)
  data.employeeId = normalizeId_(data.employeeId);

  // created_at: đúng khuôn HH:mm:ss dd/MM/yyyy thì giữ, sai/rỗng → giờ server
  var ca = String(data.created_at == null ? '' : data.created_at).trim();
  data.created_at = CREATED_AT_RE.test(ca) ? ca : formatDate_(new Date());

  // name: không tin client, doPost sẽ tra từ DanhSach
  data.name = '';
  return '';
}

/** NHẬN DỮ LIỆU TỪ WEB – ghi hoặc cập nhật một dòng CheckIn */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000); // tránh hai request ghi đè nhau
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ result: 'error', error: 'no_data' });
    }

    var data;
    try { data = JSON.parse(e.postData.contents); }
    catch (parseErr) { return json_({ result: 'error', error: 'bad_json' }); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json_({ result: 'error', error: 'bad_json' });

    var invalid = validateCheckin_(data);
    if (invalid) return json_({ result: 'error', error: invalid });

    // Tên lấy từ DanhSach theo mã, không dùng tên client gửi (client chỉ hiện tóm tắt)
    var found = lookupName_(data.employeeId);
    data.name = found.found ? found.name : '';

    var sheet = sheet_();
    ensureHeader_(sheet);
    // Phòng thủ lớp hai: mọi chuỗi qua safeText_ trước khi ghi; số (level) giữ nguyên
    var row = COLUMNS.map(function (c) {
      var v = data[c.key];
      if (v == null) return '';
      return typeof v === 'string' ? safeText_(v) : v;
    });

    var existing = findSessionRow_(sheet, data[SESSION_KEY]);
    if (existing > 0) {
      sheet.getRange(existing, 1, 1, COLUMNS.length).setValues([row]);
      return json_({ result: 'success', action: 'updated', row: existing });
    }
    sheet.appendRow(row);
    return json_({ result: 'success', action: 'inserted', row: sheet.getLastRow() });
  } catch (err) {
    return json_({ result: 'error', error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

/* ===== Tab DanhSach – dò tên ===== */

/**
 * Lấy tab DanhSach; chưa có thì tạo với 2 tiêu đề Mã, Tên. App chỉ đọc tab này.
 * Luôn đặt cột A là Văn bản thuần (@) để mã 0042 giữ số 0 đầu, mã 1-2 không
 * thành ngày. Ô đã gõ trước khi đặt định dạng thì vẫn là số/ngày → lookupName_ xử lý.
 */
function listSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(LIST_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LIST_SHEET);
    sh.appendRow(['Mã', 'Tên']);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#E3EAF3').setFontColor('#1F3A5F');
    sh.setFrozenRows(1);
  }
  // Chỉ ghi định dạng khi chưa đúng, để mỗi lookup không tốn một lần ghi cả cột
  try { if (sh.getRange('A2').getNumberFormat() !== '@') sh.getRange('A:A').setNumberFormat('@'); } catch (ignored) {}
  return sh;
}

/**
 * Lấy mã từ một ô cột A của DanhSach về dạng chuỗi để so sánh.
 *   - chuỗi  → giữ nguyên
 *   - số     → String(Math.round(v)) (Sheets đã ăn mất số 0 đầu; sẽ so lại sau)
 *   - Date   → trả '' (ô bị Sheets đổi thành ngày, không dùng được)
 */
function cellId_(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return '';
  if (typeof v === 'number') return isFinite(v) ? String(Math.round(v)) : '';
  return String(v);
}

/** Đọc A2:B của DanhSach một lần. Trả mảng [[mã, tên], ...] hoặc [] nếu trống. */
function readList_() {
  var cache = USE_LIST_CACHE ? CacheService.getScriptCache() : null;
  if (cache) {
    var hit = cache.get('danhsach');
    if (hit) { try { return JSON.parse(hit); } catch (ignored) {} }
  }
  var sh = listSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 2).getValues();
  if (cache) { try { cache.put('danhsach', JSON.stringify(values), LIST_CACHE_SEC); } catch (ignored) {} }
  return values;
}

/**
 * Dò tên theo mã. Trả:
 *   { found: true,  name }                 tìm thấy (dòng đầu tiên trùng)
 *   { found: false }                       không có mã này
 *   { found: false, reason: 'no_list' }    tab trống / chưa nhập
 *   { found: false, reason: 'id_empty' }   mã rỗng sau chuẩn hóa
 * Không bao giờ trả nhiều hơn một tên, không có cách nào liệt kê danh sách.
 */
function lookupName_(rawId) {
  var id = normalizeId_(rawId);
  if (!id) return { found: false, reason: 'id_empty' };
  // Mã toàn số: thêm bản bỏ số 0 đầu để khớp ô Sheets đã lưu thành number (0042 → 42)
  var idNoZero = /^\d+$/.test(id) ? id.replace(/^0+(?=\d)/, '') : null;
  var rows = readList_();
  if (!rows.length) return { found: false, reason: 'no_list' };
  for (var i = 0; i < rows.length; i++) {
    var cell = rows[i][0];
    var cid = cellId_(cell);
    if (!cid) continue;                  // ô trống hoặc đã bị đổi thành ngày → bỏ qua
    var norm = normalizeId_(cid);
    var hit = norm === id || (typeof cell === 'number' && idNoZero !== null && norm === idNoZero);
    if (hit) {
      var name = String(rows[i][1] == null ? '' : rows[i][1]).trim().slice(0, NAME_MAX_LENGTH);
      if (!name) continue;               // mã có nhưng tên trống → thử dòng sau
      return { found: true, name: name };
    }
  }
  return { found: false };
}

/* ===== Đọc toàn bộ CheckIn (đang tắt) ===== */

/** Trả toàn bộ tab CheckIn – chỉ chạy khi ALLOW_PUBLIC_READ = true. Không đụng DanhSach. */
function readAll_() {
  var sheet = sheet_();
  var last = sheet.getLastRow();
  var out = [];
  if (last > 1) {
    var values = sheet.getRange(2, 1, last - 1, COLUMNS.length).getValues();
    out = values.map(function (r) {
      var o = {};
      COLUMNS.forEach(function (c, i) {
        o[c.key] = r[i] instanceof Date ? formatDate_(r[i]) : String(r[i] == null ? '' : r[i]);
      });
      return o;
    });
  }
  return { result: 'success', count: out.length, data: out };
}

/* ===== doGet – rẽ nhánh theo action ===== */

/**
 * GET ?action=lookup&id=1234  → { result:'success', found, name?, reason? }
 * GET ?action=ping            → { result:'success', pong:true }
 * GET (không action)          → { result:'error', error:'public_read_disabled' } (trừ khi bật ALLOW_PUBLIC_READ)
 * GET ?action=khác            → { result:'error', error:'unknown_action' }
 * Mọi nhánh hỗ trợ JSONP qua &callback=
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var callback = p.callback || '';
  var action = String(p.action == null ? '' : p.action).trim();
  try {
    if (action === 'ping') {
      return json_({ result: 'success', pong: true }, callback);
    }
    if (action === 'lookup') {
      var r = lookupName_(p.id);
      var out = { result: 'success', found: r.found };
      if (r.found) out.name = r.name;
      if (r.reason) out.reason = r.reason;
      return json_(out, callback);
    }
    if (!action) {
      if (!ALLOW_PUBLIC_READ) return json_({ result: 'error', error: 'public_read_disabled' }, callback);
      return json_(readAll_(), callback);
    }
    return json_({ result: 'error', error: 'unknown_action' }, callback);
  } catch (err) {
    var errOut = { result: 'error', error: String(err) };
    if (action === 'lookup') errOut.found = false;
    return json_(errOut, callback);
  }
}

/* ===== Chạy thử trong editor ===== */

/**
 * Chọn hàm test_ trong editor rồi bấm Chạy. Xem Nhật ký thực thi.
 * Ghi 1 dòng thử vào CheckIn, dò 1 mã có và 1 mã không có, rồi xóa dòng thử.
 */
function test_() {
  var sid = 'test-' + new Date().getTime();   // 18 ký tự, nằm trong 8–40
  var payload = {
    created_at: '', sessionId: sid, employeeId: ' 12-34 ', name: 'Thử nghiệm',
    level: 7, levelText: 'Ổn', emotion: 'Vui vẻ'
  };
  var fakePost = { postData: { contents: JSON.stringify(payload) } };

  // 1. ghi thử lần 1 → inserted
  var r1 = JSON.parse(doPost(fakePost).getContent());
  Logger.log('test_: POST lần 1 → ' + JSON.stringify(r1));

  // 2. ghi lại cùng sessionId → updated, cùng số dòng
  var r2 = JSON.parse(doPost(fakePost).getContent());
  Logger.log('test_: POST lần 2 → ' + JSON.stringify(r2) + (r2.action === 'updated' ? ' (đúng: không thêm dòng)' : ' (SAI: lẽ ra phải updated)'));

  // 3. level sai → level_invalid
  var bad = JSON.parse(doPost({ postData: { contents: JSON.stringify({ sessionId: sid, employeeId: '1', level: 11, levelText: '', emotion: 'Buồn' }) } }).getContent());
  Logger.log('test_: POST level=11 → ' + JSON.stringify(bad));

  // 4. lookup: mã đầu tiên trong DanhSach (nếu có) và một mã chắc chắn không có
  var rows = readList_();
  if (rows.length) {
    var firstId = String(rows[0][0]);
    Logger.log('test_: lookup "' + firstId + '" → ' + doGet({ parameter: { action: 'lookup', id: firstId } }).getContent());
  } else {
    Logger.log('test_: DanhSach đang trống → lookup bất kỳ sẽ trả reason no_list: ' +
               doGet({ parameter: { action: 'lookup', id: '1234' } }).getContent());
  }
  Logger.log('test_: lookup "ZZZ-KHONG-CO-999" → ' + doGet({ parameter: { action: 'lookup', id: 'ZZZ-KHONG-CO-999' } }).getContent());
  Logger.log('test_: ping → ' + doGet({ parameter: { action: 'ping' } }).getContent());
  Logger.log('test_: GET không action → ' + doGet({ parameter: {} }).getContent());

  // 5. xóa dòng thử
  var sheet = sheet_();
  var rowNo = findSessionRow_(sheet, sid);
  if (rowNo > 0) { sheet.deleteRow(rowNo); Logger.log('test_: đã xóa dòng thử số ' + rowNo); }
  Logger.log('test_: XONG');
}
