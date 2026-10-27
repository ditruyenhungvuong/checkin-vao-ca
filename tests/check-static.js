/* =========================================================
   Rà tĩnh (QA) – Check-in khi vào ca. Không cần trình duyệt.
   - node --check cho mọi file JS (app, data, config, Apps Script, mock).
   - Microcopy nguyên văn PRD Phụ lục A trong index.html / app.js / data.js.
   - Giọng viết (style guide mục 2): "anh/chị", không "bạn"/"chị" lẻ, không từ y khoa, không alert().
   - config.js không chứa mã nhân viên, tên, secret.
   - CSS: 3 cột → 2 cột ≤ 440 px, có khối prefers-reduced-motion.
   Chạy: node tests/check-static.js
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8');
const html = read('index.html');
const js = read('js/app.js');
const data = read('js/data.js');
const cfg = read('js/config.js');
const css = read('styles.css');
const gas = read('google_apps_script.js');

let fails = 0;
const T = (name, ok, detail) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  → ' + String(detail).slice(0, 200) : '')); };
const stripHtmlComments = s => s.replace(/<!--[\s\S]*?-->/g, '');
const stripJsComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');

/* ===== Cú pháp ===== */
for (const f of ['js/app.js', 'js/data.js', 'js/config.js', 'google_apps_script.js', 'tools/mock-api.js']) {
  const r = spawnSync(process.execPath, ['--check', path.join(APP, f)], { encoding: 'utf8' });
  T('node --check ' + f, r.status === 0, r.stderr.trim());
}

/* ===== Microcopy PRD Phụ lục A ===== */
const MC_HTML = [
  '🩺 Góc nhỏ trước ca', '>Check-in khi vào ca<', 'Trước khi vào ca, anh/chị dành một phút cho mình nhé. Chỉ ba bước thôi.',
  'Mã số nhân viên của anh/chị', 'Nhập mã, mình sẽ tìm tên anh/chị.', 'placeholder="Ví dụ 1234"',
  'Hôm nay anh/chị cảm thấy như thế nào?', 'Kéo thanh trượt, bé Capybara sẽ đổi mặt theo. Mức nào cũng được.',
  'Cảm xúc hiện tại của anh/chị giống bé Capybara nào nhất?', 'Chạm để chọn 1 bé. Cảm xúc không đúng cũng không sai.',
  'Dữ liệu dùng để chăm sóc nhân viên, chỉ người phụ trách xem.', 'Tự đánh giá, không phải thang chẩn đoán.',
  '>Hoàn thành check-in<', '>Cám ơn anh/chị<', 'Anh/chị đã dành một phút cho mình trước ca. Chúc anh/chị một ca vững vàng nhé.',
  'Lượt vừa ghi', '🩺 Check-in cho ca khác', '5 · Bình thường'
];
for (const s of MC_HTML) T('A: index.html có "' + s + '"', html.includes(s));
for (const s of ['Đang tìm…', 'Xin chào anh/chị', 'Mình chưa tìm thấy mã này, anh/chị kiểm tra lại giúp nhé.',
  '💡 Anh/chị nhập mã số nhân viên ở bước 1 để mình ghi nhận nhé.', '💡 Anh/chị chọn 1 bé Capybara ở bước 3 là xong nào.', '✨ Đủ rồi, anh/chị bấm hoàn thành nhé.']) {
  T('A: app.js có "' + s + '"', js.includes(s));
}
const LEVELS = ['Rất mệt', 'Mệt', 'Hơi mệt', 'Hơi uể oải', 'Bình thường', 'Tạm ổn', 'Ổn', 'Khá tốt', 'Tốt', 'Rất tốt'];
const lvFound = [...data.matchAll(/\{ n: (\d+),\s*text: '([^']+)'/g)].map(m => [Number(m[1]), m[2]]);
T('A.3: data.js 10 mức 1..10 đúng chữ, không có mức 0', lvFound.length === 10 && lvFound.every(([n, t], i) => n === i + 1 && t === LEVELS[i]) && /const LEVELS = \[null,/.test(data), JSON.stringify(lvFound));
const emoFound = [...data.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
T('A.4: data.js 6 thẻ đúng thứ tự', emoFound.join('·') === 'Vui vẻ·Buồn·Lo lắng·Tức giận·Hoảng hốt·Khó chịu', emoFound.join('·'));
T('A.8: console.warn gửi thất bại đúng chữ', js.includes("console.warn('checkin: gửi thất bại, đã giữ bản sao localStorage')"));
T('A.8: console.warn máy chủ không nhận đúng chữ (kèm mã lỗi)', js.includes("console.warn('checkin: máy chủ không nhận (' + (json && json.error ? json.error : 'không rõ') + '), đã giữ bản sao localStorage')"));

/* ===== Lần 2: hành vi cố ý đổi sau review – kiểm hằng số và điểm gọi ===== */
const mock = read('tools/mock-api.js');
const serve = read('tools/serve.ps1');
const dataLabels = [...data.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
const dataTexts = [...data.matchAll(/\{ n: \d+,\s*text: '([^']+)'/g)].map(m => m[1]);
const arr = (src, name) => { const m = src.match(new RegExp(name + '\\s*=\\s*\\[([\\s\\S]*?)\\];')); return m ? [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]) : null; };
T('Đồng bộ: EMOTION_LABELS của Apps Script == 6 nhãn data.js', JSON.stringify(arr(gas, 'var EMOTION_LABELS')) === JSON.stringify(dataLabels), JSON.stringify(arr(gas, 'var EMOTION_LABELS')));
T('Đồng bộ: EMOTION_LABELS của mock == 6 nhãn data.js', JSON.stringify(arr(mock, 'const EMOTION_LABELS')) === JSON.stringify(dataLabels));
T('Đồng bộ: LEVEL_TEXTS của Apps Script == ["" + 10 mức data.js]', JSON.stringify(arr(gas, 'var LEVEL_TEXTS')) === JSON.stringify([''].concat(dataTexts)), JSON.stringify(arr(gas, 'var LEVEL_TEXTS')));
T('Đồng bộ: LEVEL_TEXTS của mock == ["" + 10 mức data.js]', JSON.stringify(arr(mock, 'const LEVEL_TEXTS')) === JSON.stringify([''].concat(dataTexts)));
T('Đồng bộ: SESSION_RE ^[0-9A-Za-z-]{8,40}$ giống nhau ở Apps Script và mock', gas.includes('/^[0-9A-Za-z-]{8,40}$/') && mock.includes('/^[0-9A-Za-z-]{8,40}$/'));
T('Đồng bộ: CREATED_AT_RE HH:mm:ss dd/MM/yyyy giống nhau ở Apps Script và mock', gas.includes('/^\\d{2}:\\d{2}:\\d{2} \\d{2}\\/\\d{2}\\/\\d{4}$/') && mock.includes('/^\\d{2}:\\d{2}:\\d{2} \\d{2}\\/\\d{2}\\/\\d{4}$/'));
T('GAS: safeText_ áp cho mọi chuỗi trước khi ghi (doPost), chặn = + - @ \\t \\r', /typeof v === 'string' \? safeText_\(v\) : v/.test(gas) && /c === '=' \|\| c === '\+' \|\| c === '-' \|\| c === '@' \|\| c === '\\t' \|\| c === '\\r'/.test(gas));
T('GAS: doPost tra Tên từ DanhSach theo mã, không dùng name client (data.name = \'\' rồi lookupName_)', /data\.name = '';/.test(gas) && /var found = lookupName_\(data\.employeeId\);\s*data\.name = found\.found \? found\.name : '';/.test(gas));
T('GAS: listSheet_ đặt cột A DanhSach định dạng văn bản (@)', /getRange\('A:A'\)\.setNumberFormat\('@'\)/.test(gas));
T('GAS: ensureHeader_ bổ sung cột G cho Sheet cũ 6 cột', /sheet\.getRange\(1, SESSION_COL\)\.getValue\(\) !== gHeader/.test(gas));
T('Mock: dữ liệu mặc định ghi ở os.tmpdir(), đổi được bằng MOCK_DATA; không ghi cạnh file mock', /process\.env\.MOCK_DATA/.test(mock) && /os\.tmpdir\(\), 'checkin-vao-ca-mock-data\.json'/.test(mock) && !/__dirname, 'mock-data\.json'/.test(mock));
T('app.js: xóa bản sao khi máy chủ trả success (removeBackup) và gửi lại lúc tải trang (resendPending trong init)', /json\.result === 'success'\) removeBackup\(payload\.sessionId\)/.test(js) && /resendPending\(\);\s*\}/.test(js) && /const RESEND_MAX = 5;/.test(js));
T('app.js: ảnh thanh trượt debounce 150 ms khi input, ngay khi change', /const LEVEL_IMG_DEBOUNCE_MS = 150;/.test(js) && /addEventListener\('input', \(\) => setLevel\(parseInt\(el\.range\.value, 10\), false\)\)/.test(js) && /addEventListener\('change', \(\) => setLevel\(parseInt\(el\.range\.value, 10\), true\)\)/.test(js));
T('app.js: JSONP quá giờ giữ hàm rỗng 5 s (JSONP_LATE_GRACE_MS = 5000); dò tên dùng Promise.race', /const JSONP_LATE_GRACE_MS = 5000;/.test(js) && /Promise\.race\(\[req\.then\(r => r\.json\(\)\), timeout\]\)/.test(js));
T('app.js: newSessionId dự phòng base36 (8–40 ký tự, chỉ chữ số gạch nối) khi không có crypto.randomUUID', /Date\.now\(\)\.toString\(36\) \+ '-' \+ Math\.random\(\)\.toString\(36\)\.slice\(2, 10\)/.test(js));
T('serve.ps1: server tĩnh chỉ bind 127.0.0.1 (python/py/npx), php bind localhost', /\$Bind = '127\.0\.0\.1'/.test(serve) && /'--bind', \$Bind/.test(serve) && /tcp:\/\/\$\{Bind\}:\$Port/.test(serve) && /'-S', "localhost:\$Port"/.test(serve) && !/0\.0\.0\.0/.test(serve.replace(/#[^\n]*|<#[\s\S]*?#>/g, '')));

/* ===== Giọng viết (style guide mục 2) ===== */
const htmlText = [...stripHtmlComments(html).matchAll(/>([^<]+)</g)].map(m => m[1]).concat([...html.matchAll(/(?:placeholder|alt|content|title)="([^"]*)"/g)].map(m => m[1]));
const jsStrings = [...stripJsComments(js).matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]).concat([...stripJsComments(data).matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]));
const lone = /(?<!anh\/)(?<![\p{L}])(bạn|chị|em|mẹ|cậu)(?![\p{L}])/iu;
const badVoice = htmlText.concat(jsStrings).filter(t => lone.test(t));
T('Giọng: không "bạn"/"chị"/"em" lẻ trong chuỗi hiển thị (chỉ "anh/chị")', badVoice.length === 0, JSON.stringify(badVoice));
const medical = ['bệnh nhân', 'triệu chứng', 'trầm cảm', 'lo âu', 'stress', 'điều trị', 'sàng lọc', 'rối loạn', 'burnout', 'tâm thần', 'kiệt sức'];
const medHits = htmlText.concat(jsStrings).filter(t => medical.some(w => t.toLowerCase().includes(w)));
T('Giọng: không từ y khoa trong chuỗi hiển thị', medHits.length === 0, JSON.stringify(medHits));
T('Giọng: câu kết "nhé"/"nào"/"thôi" ở hint và câu dẫn', /nhé\./.test(html) && /nào\./.test(js) && /thôi\./.test(html));
T('Không alert()/confirm()/prompt() trong app.js', !/\b(alert|confirm|prompt)\s*\(/.test(stripJsComments(js)));
T('Không onclick= / style= inline trong index.html', !/\son[a-z]+\s*=|\sstyle\s*=/.test(stripHtmlComments(html)));
T('Không autofocus trong index.html', !/\sautofocus[\s>]/.test(stripHtmlComments(html)));
T('Không Web Speech (giọng đọc máy) trong app', !/speechSynthesis|SpeechSynthesisUtterance|webkitSpeechRecognition/.test(js + html));
T('Không ?. / ?? trong app.js (WebView cũ)', !/\?\.|\?\?/.test(stripJsComments(js)));
T('Mọi hành động qua data-act (pick/submit/again)', /data-act="pick"/.test(js) && /data-act="submit"/.test(html) && /data-act="again"/.test(html));

/* ===== config.js không có mã / tên / secret ===== */
const cfgNc = stripJsComments(cfg);
T("config.js: GOOGLE_SCRIPT_URL rỗng hoặc URL script thật, không localhost", /GOOGLE_SCRIPT_URL:\s*'(|https:\/\/script\.google\.com\/[^']+)'/.test(cfgNc));
T('config.js: không có tên người (mẫu mock) hay chữ hoa có dấu kiểu tên', !/Nguyễn|Trần|Lê |Phạm|Võ |Hạnh|Minh|Thảo|Bảo|Lan/.test(cfgNc));
T('config.js: không có secret/token/key/password', !/secret|token|password|api[_-]?key/i.test(cfgNc));
T('config.js: không có dãy số 4–8 chữ số giống mã nhân viên (ngoài số hợp lệ của tham số)', (cfgNc.match(/\b\d{4,8}\b/g) || []).every(n => ['1500', '8787'].includes(n)), JSON.stringify(cfgNc.match(/\b\d{4,8}\b/g)));
T('config.js: đủ khóa theo tech design', ['GOOGLE_SCRIPT_URL', 'ID_MIN_LENGTH', 'ID_MAX_LENGTH', 'ID_NUMERIC', 'LOOKUP_TIMEOUT_MS: 1500', 'LOOKUP_DEBOUNCE_MS', 'ASSET_BASE', 'BACKUP_KEY', 'BACKUP_MAX'].every(k => cfgNc.includes(k)));
T('normalizeId client == script (tech design 4.4)', js.includes(".trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase()") && gas.includes(".trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase()"));

/* ===== CSS ===== */
T('CSS: lưới 3 cột, 2 cột ở ≤ 440 px', /\.capy-grid \{[^}]*repeat\(3, 1fr\)/.test(css) && /@media \(max-width: 440px\) \{ \.capy-grid \{ grid-template-columns: repeat\(2, 1fr\)/.test(css));
T('CSS: có khối prefers-reduced-motion tắt pulse và tick tĩnh', /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.btn-submit\.ready \{ animation: none/.test(css) && /\.checkmark-circle, \.checkmark-check \{ stroke-dashoffset: 0; animation: none/.test(css));
T('CSS: nút chưa thức dậy opacity .45 + scale .96', /\.btn-submit \{ opacity: \.45;[^}]*scale\(\.96\)/.test(css));
T('CSS: không dùng --danger trong phần app (không đỏ)', !/var\(--danger\)/.test(css.slice(css.indexOf('PHẦN RIÊNG CỦA APP'))));
T('CSS: tick xanh dùng --green-success/--green-bright', /\.success-checkmark \{[^}]*var\(--green-bright\)/.test(css));
T('HTML: #greet aria-live=polite, #level-label aria-live, #progress-hint aria-live', /id="greet" aria-live="polite"/.test(html) && /id="level-label"[^>]*aria-live="polite"/.test(html) && /id="progress-hint"[^>]*aria-live="polite"/.test(html));
T('HTML: viewport không chặn zoom', !/maximum-scale|user-scalable=no/.test(html));
T('HTML: lang="vi"', /<html lang="vi">/.test(html));

/* ===== Apps Script: không có API liệt kê DanhSach ===== */
T('GAS: ALLOW_PUBLIC_READ = false', /var ALLOW_PUBLIC_READ = false;/.test(gas));
T('GAS: readAll_ chỉ đọc tab CheckIn (sheet_), không đụng DanhSach', /function readAll_\(\) \{\s*var sheet = sheet_\(\);/.test(gas) && !/function readAll_[\s\S]*?listSheet_[\s\S]*?\n\}/.test(gas.slice(gas.indexOf('function readAll_'), gas.indexOf('/* ===== doGet'))));
T('GAS: doGet chỉ có nhánh ping / lookup / rỗng / unknown_action', /action === 'ping'/.test(gas) && /action === 'lookup'/.test(gas) && /unknown_action/.test(gas) && !/action === 'list'|action === 'all'|action === 'dump'/.test(gas));

console.log('\n' + (fails ? fails + ' FAIL' : 'ALL PASS'));
process.exit(fails ? 1 : 0);
