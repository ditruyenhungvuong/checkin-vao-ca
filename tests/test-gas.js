/* =========================================================
   Test google_apps_script.js bằng Node (QA): giả lập SpreadsheetApp / ContentService /
   LockService / CacheService / Logger rồi gọi doGet / doPost như Apps Script sẽ gọi.
   Kiểm PRD US-4: 7 cột đúng thứ tự, Sheet trống tự tạo tiêu đề, cột Tên rỗng khi không
   tìm thấy, GET không action không lộ dữ liệu, không có API liệt kê DanhSach, bấm đúp → 1 dòng.
   Chạy: node tests/test-gas.js
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.resolve(__dirname, '..');
let fails = 0;
const T = (name, ok, detail) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  → ' + String(detail).slice(0, 220) : '')); };

/* ===== Giả lập Sheet ===== */
function makeSheet(name) {
  const s = { name, rows: [], frozen: 0, hidden: [], fmt: [], numFmt: [] };
  s.getLastRow = () => s.rows.length;
  s.appendRow = r => { s.rows.push(r.slice()); };
  s.setFrozenRows = n => { s.frozen = n; };
  s.hideColumns = c => { s.hidden.push(c); };
  s.deleteRow = n => { s.rows.splice(n - 1, 1); };
  s.getRange = (r, c, nr, nc) => {
    // getRange('A:A') dạng A1 notation: chỉ dùng cho setNumberFormat
    if (typeof r === 'string') {
      // 'A:A' = cả cột, 'A2'/'B2' = một ô: định dạng cột đã đặt thì ô trong cột đọc ra '@'
      const col = r.replace(/[^A-Z]/g, '').charAt(0);
      return {
        setNumberFormat(f) { s.numFmt.push(r + '=' + f); return this; },
        getNumberFormat() { return s.numFmt.includes(col + ':' + col + '=@') ? '@' : 'General'; }
      };
    }
    return {
      getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => { const row = s.rows[r - 1 + i] || []; return row[c - 1 + j] == null ? '' : row[c - 1 + j]; })),
      setValues: vals => { vals.forEach((v, i) => { const row = s.rows[r - 1 + i] || (s.rows[r - 1 + i] = []); v.forEach((x, j) => { row[c - 1 + j] = x; }); }); },
      getValue: () => { const row = s.rows[r - 1] || []; return row[c - 1] == null ? '' : row[c - 1]; },
      setValue(x) { const row = s.rows[r - 1] || (s.rows[r - 1] = []); row[c - 1] = x; return this; },
      setNumberFormat(f) { s.numFmt.push(r + ',' + c + '=' + f); return this; },
      setFontWeight(x) { s.fmt.push(x); return this; }, setBackground(x) { s.fmt.push(x); return this; }, setFontColor(x) { s.fmt.push(x); return this; }
    };
  };
  return s;
}
const sheets = {};
const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)) };
let lockCalls = 0;
const sandbox = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'js' }, createTextOutput: t => ({ text: t, mime: null, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.text; } }) },
  LockService: { getScriptLock: () => ({ waitLock() { lockCalls++; }, releaseLock() { lockCalls--; } }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
  Logger: { log: m => { sandbox.__logs.push(String(m)); } },
  __logs: [],
  console
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'google_apps_script.js'), 'utf8'), sandbox, { filename: 'google_apps_script.js' });

const G = p => sandbox.doGet({ parameter: p });
const P = o => sandbox.doPost({ postData: { contents: typeof o === 'string' ? o : JSON.stringify(o) } });
const J = out => JSON.parse(out.getContent());

/* ===== DanhSach mẫu: mã dạng số (người nhập tay), tên có khoảng trắng, mã trùng, mã có gạch, tên có HTML ===== */
sheets.DanhSach = makeSheet('DanhSach');
sheets.DanhSach.rows.push(['Mã', 'Tên'], [1001, '  Nguyễn Thị Hạnh '], ['A123', 'Phạm Quốc Bảo'], [1001, 'Trùng Mã Dòng Sau'], ['20-24', 'Võ Ngọc Lan'], ['7777', ''], ['HTML1', 'Lê <b>Thu</b> & con'],
  [42, 'Đỗ Số Không'],                       // người gõ 0042, Sheets đổi thành number 42
  [new Date(2026, 0, 2), 'Bị Đổi Thành Ngày'], // người gõ 1-2, Sheets đổi thành ngày → bỏ qua
  ['LONG1', 'L'.repeat(200)],                 // tên dài → cắt 80
  ['INJ1', '=IMPORTXML("http://x";"//a")']);  // tên trong DanhSach bắt đầu bằng = → safeText_ chặn

/* ===== doGet ===== */
T('ping → pong, MimeType JSON', JSON.stringify(J(G({ action: 'ping' }))) === '{"result":"success","pong":true}' && G({ action: 'ping' }).mime === 'json');
T('lookup " 10-01 " → Hạnh (mã số trong Sheet, tên trim, lấy dòng đầu)', JSON.stringify(J(G({ action: 'lookup', id: ' 10-01 ' }))) === '{"result":"success","found":true,"name":"Nguyễn Thị Hạnh"}', G({ action: 'lookup', id: ' 10-01 ' }).getContent());
T('lookup a123 → Phạm Quốc Bảo (hoa/thường)', J(G({ action: 'lookup', id: 'a123' })).name === 'Phạm Quốc Bảo');
T('lookup 2024 khớp ô "20-24" trong Sheet (chuẩn hóa hai phía)', J(G({ action: 'lookup', id: '2024' })).name === 'Võ Ngọc Lan');
T('lookup 7777 (mã có, tên trống) → found:false', JSON.stringify(J(G({ action: 'lookup', id: '7777' }))) === '{"result":"success","found":false}');
T('lookup 9999 → found:false, không name', JSON.stringify(J(G({ action: 'lookup', id: '9999' }))) === '{"result":"success","found":false}');
T('lookup "--" → id_empty', J(G({ action: 'lookup', id: '--' })).reason === 'id_empty');
T('lookup không id → id_empty', J(G({ action: 'lookup' })).reason === 'id_empty');
T('lookup id dài 100 ký tự → cắt 32, không lỗi', J(G({ action: 'lookup', id: '1'.repeat(100) })).result === 'success');
T('lookup tên có HTML → trả nguyên (client phải esc)', J(G({ action: 'lookup', id: 'HTML1' })).name === 'Lê <b>Thu</b> & con');
T('lookup 0042 khi Sheet lưu number 42 → vẫn tìm thấy', J(G({ action: 'lookup', id: '0042' })).name === 'Đỗ Số Không', G({ action: 'lookup', id: '0042' }).getContent());
T('lookup 42 (không số 0) cũng thấy', J(G({ action: 'lookup', id: '42' })).name === 'Đỗ Số Không');
T('lookup 12 không khớp ô Date (ô bị đổi thành ngày bị bỏ qua, không throw)', JSON.stringify(J(G({ action: 'lookup', id: '12' }))) === '{"result":"success","found":false}');
T('listSheet_ đặt cột A DanhSach = Văn bản thuần (@)', sheets.DanhSach.numFmt.includes('A:A=@'), JSON.stringify(sheets.DanhSach.numFmt.slice(0, 2)));
T('GET không action → public_read_disabled', JSON.stringify(J(G({}))) === '{"result":"error","error":"public_read_disabled"}');
T('GET action lạ → unknown_action', J(G({ action: 'dump' })).error === 'unknown_action');
T('không có action nào trả cả tab DanhSach', ['list', 'all', 'danhsach', 'DanhSach', 'export', 'names'].every(a => J(G({ action: a })).error === 'unknown_action'));
T('JSONP: callback hợp lệ', G({ action: 'ping', callback: '__capyLookup1' }).getContent() === '__capyLookup1({"result":"success","pong":true});' && G({ action: 'ping', callback: '__capyLookup1' }).mime === 'js');
T('JSONP: callback bẩn bị lọc', G({ action: 'ping', callback: 'x();alert(1)//' }).getContent() === 'xalert1({"result":"success","pong":true});');

/* ===== doPost ===== */
const base = { created_at: '', sessionId: 'qa-session-0001', employeeId: ' 10-01 ', name: 'Nguyễn Thị Hạnh', level: 7, levelText: 'Ổn', emotion: 'Lo lắng' };
T('CheckIn chưa có → POST tự tạo tab', !sheets.CheckIn);
let r = J(P(base));
T('POST lần 1 → inserted row 2', r.result === 'success' && r.action === 'inserted' && r.row === 2, JSON.stringify(r));
const ci = sheets.CheckIn;
T('ensureHeader_ đặt cột B và G tab CheckIn = Văn bản thuần (@) (review lần 2)', sheets.CheckIn.numFmt.includes('B:B=@') && sheets.CheckIn.numFmt.includes('G:G=@'), JSON.stringify(sheets.CheckIn.numFmt));
T('Định dạng cột chỉ ghi một lần, lookup lặp không ghi thêm', (() => { const n = sheets.DanhSach.numFmt.length; G({ action: 'lookup', id: '1001' }); return sheets.DanhSach.numFmt.length === n; })(), 'numFmt tăng');
T('Sheet trống tự tạo tiêu đề 7 cột đúng thứ tự PRD mục 5 + Mã phiên', JSON.stringify(ci.rows[0]) === JSON.stringify(['Thời gian', 'Mã nhân viên', 'Tên', 'Mức (1–10)', 'Mức chữ', 'Cảm xúc Capybara', 'Mã phiên']), JSON.stringify(ci.rows[0]));
T('Tiêu đề: đóng băng hàng 1, ẩn cột G, màu navy', ci.frozen === 1 && JSON.stringify(ci.hidden) === '[7]' && ci.fmt.includes('#1F3A5F'), JSON.stringify({ frozen: ci.frozen, hidden: ci.hidden, fmt: ci.fmt }));
T('Dòng 2: created_at tự điền, mã chuẩn hóa 1001, tên, 7, Ổn, Lo lắng, sessionId', /^\d\d:\d\d:\d\d \d\d\/\d\d\/\d{4}$/.test(ci.rows[1][0]) && JSON.stringify(ci.rows[1].slice(1)) === JSON.stringify(['1001', 'Nguyễn Thị Hạnh', 7, 'Ổn', 'Lo lắng', 'qa-session-0001']), JSON.stringify(ci.rows[1]));
r = J(P(Object.assign({}, base, { level: 8, emotion: 'Buồn', created_at: '07:00:00 27/10/2026' })));
T('POST cùng sessionId (bấm đúp) → updated row 2, Sheet vẫn 1 dòng dữ liệu', r.action === 'updated' && r.row === 2 && ci.rows.length === 2 && ci.rows[1][3] === 8 && ci.rows[1][5] === 'Buồn' && ci.rows[1][0] === '07:00:00 27/10/2026', JSON.stringify(r) + ' ' + JSON.stringify(ci.rows[1]));
r = J(P(Object.assign({}, base, { sessionId: 'qa-session-0002', employeeId: '9999', name: '' })));
T('Mã không tìm thấy: cột Tên rỗng, cột Mã vẫn 9999', r.action === 'inserted' && ci.rows[2][1] === '9999' && ci.rows[2][2] === '', JSON.stringify(ci.rows[2]));
T('POST level 11 → level_invalid', J(P(Object.assign({}, base, { sessionId: 'qa-session-0003', level: 11 }))).error === 'level_invalid');
T('POST level 0 → level_invalid', J(P(Object.assign({}, base, { sessionId: 'qa-session-0003', level: 0 }))).error === 'level_invalid');
T('POST level 2.5 → level_invalid', J(P(Object.assign({}, base, { sessionId: 'qa-session-0003', level: 2.5 }))).error === 'level_invalid');
T('POST level "7" chuỗi → nhận, ghi số 7', J(P(Object.assign({}, base, { sessionId: 'qa-session-0004', level: '7' }))).result === 'success' && ci.rows[ci.rows.length - 1][3] === 7);
T('POST emotion rỗng → emotion_required', J(P(Object.assign({}, base, { sessionId: 'qa-session-0005', emotion: ' ' }))).error === 'emotion_required');
T('POST sessionId 5 ký tự → session_invalid', J(P(Object.assign({}, base, { sessionId: 'abcde' }))).error === 'session_invalid');
T('POST sessionId 41 ký tự → session_invalid', J(P(Object.assign({}, base, { sessionId: 'x'.repeat(41) }))).error === 'session_invalid');
T('POST JSON hỏng → bad_json', J(P('{oops')).error === 'bad_json');
T('POST không postData → no_data', J(sandbox.doPost({})).error === 'no_data');
T('POST tên trong DanhSach dài 200 ký tự → cột Tên cắt 80', (() => { J(P(Object.assign({}, base, { sessionId: 'qa-session-0006', employeeId: 'LONG1' }))); const row = ci.rows[ci.rows.length - 1]; return row[2].length === 80; })());

/* ===== Chống formula injection (code-reviewer CHẶN) ===== */
const lastRow = () => ci.rows[ci.rows.length - 1];
T('POST emotion "=1+1" → emotion_invalid', J(P(Object.assign({}, base, { sessionId: 'qa-inj-0001', emotion: '=1+1' }))).error === 'emotion_invalid');
T('POST emotion "vui vẻ" (sai hoa/thường) → emotion_invalid', J(P(Object.assign({}, base, { sessionId: 'qa-inj-0001', emotion: 'vui vẻ' }))).error === 'emotion_invalid');
T('POST đủ 6 nhãn cảm xúc → đều nhận', ['Vui vẻ', 'Buồn', 'Lo lắng', 'Tức giận', 'Hoảng hốt', 'Khó chịu'].every((e, i) => J(P(Object.assign({}, base, { sessionId: 'qa-inj-emo-' + i, emotion: e }))).result === 'success'));
r = J(P(Object.assign({}, base, { sessionId: 'qa-inj-0002', level: 3, levelText: '=HYPERLINK("http://evil";"bấm")' })));
T('POST levelText "=HYPERLINK(...)" → thay bằng nhãn đúng của level 3 "Hơi mệt"', r.result === 'success' && lastRow()[4] === 'Hơi mệt', JSON.stringify(lastRow()));
T('POST levelText rỗng, level 10 → server tự điền "Rất tốt"', (() => { J(P(Object.assign({}, base, { sessionId: 'qa-inj-0003', level: 10, levelText: '' }))); return lastRow()[4] === 'Rất tốt'; })(), JSON.stringify(lastRow()));
T('POST sessionId \'=HYPERLINK("x";"y")\' → session_invalid', J(P(Object.assign({}, base, { sessionId: '=HYPERLINK("x";"y")' }))).error === 'session_invalid');
T('POST sessionId có khoảng trắng / dấu chấm → session_invalid', J(P(Object.assign({}, base, { sessionId: 'abc def ghi' }))).error === 'session_invalid' && J(P(Object.assign({}, base, { sessionId: 'abc.def.ghi' }))).error === 'session_invalid');
T('POST sessionId UUID có gạch nối → nhận', J(P(Object.assign({}, base, { sessionId: '3f2b9c1a-7d4e-4b6a-9c2d-1e5f6a7b8c9d' }))).result === 'success');
r = J(P(Object.assign({}, base, { sessionId: 'qa-inj-0004', created_at: '=NOW()' })));
T('POST created_at "=NOW()" → thay bằng giờ server đúng khuôn', r.result === 'success' && /^\d\d:\d\d:\d\d \d\d\/\d\d\/\d{4}$/.test(lastRow()[0]) && lastRow()[0] !== '=NOW()', JSON.stringify(lastRow()));
T('POST created_at sai khuôn "2026-10-27" → giờ server', (() => { J(P(Object.assign({}, base, { sessionId: 'qa-inj-0005', created_at: '2026-10-27' }))); return /^\d\d:\d\d:\d\d \d\d\/\d\d\/\d{4}$/.test(lastRow()[0]); })());
T('POST created_at đúng khuôn → giữ nguyên', (() => { J(P(Object.assign({}, base, { sessionId: 'qa-inj-0006', created_at: '06:45:10 27/10/2026' }))); return lastRow()[0] === '06:45:10 27/10/2026'; })());
r = J(P(Object.assign({}, base, { sessionId: 'qa-inj-0007', employeeId: '1001', name: '=IMPORTXML("http://evil";"//a")' })));
T('POST name "=IMPORTXML(...)" với mã 1001 → cột Tên là tên tra từ DanhSach', r.result === 'success' && lastRow()[2] === 'Nguyễn Thị Hạnh', JSON.stringify(lastRow()));
r = J(P(Object.assign({}, base, { sessionId: 'qa-inj-0008', employeeId: '9999', name: '=IMPORTXML("http://evil";"//a")' })));
T('POST name "=IMPORTXML(...)" với mã không có → cột Tên rỗng', r.result === 'success' && lastRow()[2] === '', JSON.stringify(lastRow()));
r = J(P(Object.assign({}, base, { sessionId: 'qa-inj-0009', employeeId: 'INJ1', name: 'x' })));
T('Tên trong DanhSach bắt đầu bằng "=" → safeText_ thêm nháy đơn phía trước', r.result === 'success' && lastRow()[2] === "'=IMPORTXML(\"http://x\";\"//a\")", JSON.stringify(lastRow()));
T('Không ô chuỗi nào trong CheckIn bắt đầu bằng = + - @', ci.rows.slice(1).every(row => row.every(v => typeof v !== 'string' || !/^[=+\-@\t\r]/.test(v))));
T('safeText_: "=x" "+x" "-x" "@x" "\\tx" "\\rx" được thêm nháy; "x" "1" "" giữ nguyên', ['=x', '+x', '-x', '@x', '\tx', '\rx'].every(v => sandbox.safeText_(v) === "'" + v) && sandbox.safeText_('x') === 'x' && sandbox.safeText_('1') === '1' && sandbox.safeText_('') === '');
T('POST mã 0042 (DanhSach lưu number 42) → cột Tên "Đỗ Số Không", cột Mã "0042"', (() => { J(P(Object.assign({}, base, { sessionId: 'qa-inj-0010', employeeId: '0042', name: '' }))); return lastRow()[2] === 'Đỗ Số Không' && lastRow()[1] === '0042'; })(), JSON.stringify(lastRow()));
/* Lần 2: thêm ca khớp client thật */
T('POST sessionId dạng dự phòng của app "mvpossqf-gcesj1x0" (không có crypto.randomUUID) → nhận', J(P(Object.assign({}, base, { sessionId: 'mvpossqf-gcesj1x0' }))).result === 'success');
T('POST sessionId 8 ký tự → nhận; 7 ký tự → session_invalid', J(P(Object.assign({}, base, { sessionId: 'abcd1234' }))).result === 'success' && J(P(Object.assign({}, base, { sessionId: 'abcd123' }))).error === 'session_invalid');
T('POST emotion " Buồn " (khoảng trắng) → nhận, ghi "Buồn"', (() => { const r = J(P(Object.assign({}, base, { sessionId: 'qa-trim-0001', emotion: ' Buồn ' }))); return r.result === 'success' && lastRow()[5] === 'Buồn'; })());
T('POST employeeId "=1+1" → cột Mã "11" (chuẩn hóa bỏ ký tự lạ), không còn dấu =', (() => { J(P(Object.assign({}, base, { sessionId: 'qa-inj-0013', employeeId: '=1+1', name: '' }))); return lastRow()[1] === '11'; })(), JSON.stringify(lastRow()));
T('POST level "abc" → level_invalid; level null → level_invalid', J(P(Object.assign({}, base, { sessionId: 'qa-inj-0014', level: 'abc' }))).error === 'level_invalid' && J(P(Object.assign({}, base, { sessionId: 'qa-inj-0014', level: null }))).error === 'level_invalid');
T('POST không có trường name (client cũ) → vẫn tra Tên theo mã', (() => { const p = Object.assign({}, base, { sessionId: 'qa-inj-0015' }); delete p.name; const r = J(P(p)); return r.result === 'success' && lastRow()[2] === 'Nguyễn Thị Hạnh'; })());
T('Cột Mức (level) ghi dạng số, không qua safeText_ (không thêm nháy)', typeof lastRow()[3] === 'number');
T('Cột Mã phiên và Thời gian không bao giờ bắt đầu bằng = + - @ (regex đã chặn)', ci.rows.slice(1).every(r => !/^[=+\-@\t\r]/.test(String(r[0])) && !/^[=+\-@\t\r]/.test(String(r[6]))));

/* ===== ensureHeader_ với Sheet cũ chỉ 6 cột ===== */
(() => {
  const old = makeSheet('Cu');
  old.rows.push(['Thời gian', 'Mã nhân viên', 'Tên', 'Mức (1–10)', 'Mức chữ', 'Cảm xúc Capybara'], ['07:00:00 01/10/2026', '1001', 'Nguyễn Thị Hạnh', 7, 'Ổn', 'Vui vẻ']);
  sandbox.ensureHeader_(old);
  T('ensureHeader_ Sheet cũ 6 cột → thêm tiêu đề G "Mã phiên", ẩn cột 7, giữ nguyên dữ liệu cũ', old.rows[0][6] === 'Mã phiên' && JSON.stringify(old.hidden) === '[7]' && old.rows.length === 2 && old.rows[1][2] === 'Nguyễn Thị Hạnh', JSON.stringify(old.rows[0]));
  sandbox.ensureHeader_(old);
  T('ensureHeader_ gọi lại khi đã đủ 7 cột → không làm gì thêm', JSON.stringify(old.hidden) === '[7]' && old.rows.length === 2);
})();
T('Lock luôn được nhả (kể cả khi lỗi)', lockCalls === 0, lockCalls);
T('Lỗi bất ngờ trong doPost → JSON error, không throw', (() => { const old = ss.getSheetByName; ss.getSheetByName = () => { throw new Error('boom'); }; const out = J(P(Object.assign({}, base, { sessionId: 'qa-session-0007' }))); ss.getSheetByName = old; return out.result === 'error' && /boom/.test(out.error) && lockCalls === 0; })());

/* ===== DanhSach chưa có ===== */
delete sheets.DanhSach;
T('lookup khi chưa có tab DanhSach → no_list và tự tạo tab với tiêu đề Mã, Tên', J(G({ action: 'lookup', id: '1001' })).reason === 'no_list' && sheets.DanhSach && JSON.stringify(sheets.DanhSach.rows[0]) === '["Mã","Tên"]');

/* ===== test_() trong editor chạy được và dọn dòng thử ===== */
const before = ci.rows.length;
sandbox.test_();
T('test_() chạy xong "XONG" và xóa dòng thử', sandbox.__logs.some(l => /XONG/.test(l)) && ci.rows.length === before, sandbox.__logs.slice(-2).join(' | '));

console.log('\n' + (fails ? fails + ' FAIL' : 'ALL PASS'));
process.exit(fails ? 1 : 0);
