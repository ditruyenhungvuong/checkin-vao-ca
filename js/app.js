/* =========================================================
   Check-in khi vào ca – lõi app (cỡ S: một trang, một việc)
   Luồng: gõ mã → dò tên → kéo thanh trượt → chọn 1 thẻ → nút thức dậy
          → ghi hàng chờ localStorage → fetch không chờ (thành công thì xóa khỏi hàng chờ) → trang cám ơn.
   Lúc tải trang: ping Apps Script + gửi lại im lặng những lượt còn trong hàng chờ.
   Không router, không engine. Mọi click qua data-act, mọi chuỗi vào HTML qua esc().
   Cố ý không dùng ?. và ?? để vài WebView cũ (Zalo, Facebook in-app) vẫn chạy.
   ========================================================= */
(() => {
  'use strict';
  const C = window.APP_CONFIG || {};
  const D = window.APP_DATA || { LEVELS: [], EMOTIONS: [], DEFAULT_LEVEL: 5 };

  /* ===== Tiện ích ===== */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* Chuẩn hóa mã – viết GIỐNG HỆT google_apps_script.js (tech design 4.4):
     bỏ khoảng trắng, bỏ ký tự không phải chữ/số, viết hoa. */
  const normalizeId = raw => String(raw === null || raw === undefined ? '' : raw)
    .trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase();

  const pad2 = n => (n < 10 ? '0' : '') + n;
  /* Giờ máy, định dạng 'HH:mm:ss dd/MM/yyyy' như cột Thời gian trên Sheet */
  const formatNow = d => pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + ' ' +
    pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();

  /* Mã phiên: khóa upsert trên Sheet (cột G ẩn). Mới khi tải trang và mỗi lần "Check-in cho ca khác". */
  const newSessionId = () => {
    try {
      if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch (e) { /* vài WebView chặn crypto, dùng cách dưới */ }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  };

  /* Rung nhẹ khi chọn thẻ; máy không hỗ trợ hay chặn thì thôi */
  const vibrate = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* bỏ qua */ } };

  /* Toast thay alert(). Dự phòng, MVP không bắt buộc hiện. */
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /* Chuỗi hiển thị động – nguyên văn PRD Phụ lục A */
  const TEXT = {
    searching: 'Đang tìm…',
    hello: 'Xin chào anh/chị',
    hintNoLookup: 'Nhập mã số nhân viên của anh/chị nhé.',
    notFound: 'Mình chưa tìm thấy mã này, anh/chị kiểm tra lại giúp nhé.',
    needId: '💡 Anh/chị nhập mã số nhân viên ở bước 1 để mình ghi nhận nhé.',
    needCard: '💡 Anh/chị chọn 1 bé Capybara ở bước 3 là xong nào.',
    done: '✨ Đủ rồi, anh/chị bấm hoàn thành nhé.'
  };

  /* ===== Trạng thái (tech design 3.1) ===== */
  const state = {
    sessionId: '',
    submitting: false,
    lookup: { id: '', status: 'idle', name: '', seq: 0 }, // status: idle | loading | found | notfound | timeout
    checkin: {
      created_at: '', sessionId: '', employeeId: '', name: '',
      level: D.DEFAULT_LEVEL, levelText: '', emotion: ''
    }
  };

  /* Các phần tử dùng nhiều, gán ở init() */
  const el = {};

  /* ===== Ảnh lỗi → emoji (bắt ở pha capture vì 'error' không nổi bọt) ===== */
  document.addEventListener('error', e => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-fallback')) return;
    const isLevel = img.classList.contains('emotion-capy');
    const span = document.createElement(isLevel ? 'div' : 'span');
    span.className = isLevel ? 'emotion-capy fallback' : 'capy-emoji';
    span.textContent = img.getAttribute('data-fallback') || '😊';
    span.setAttribute('aria-hidden', 'true');
    if (img.id) span.id = img.id;
    if (img.parentNode) img.parentNode.replaceChild(span, img);
    if (isLevel) el.levelImg = span;
  }, true);

  /* ===== Bước 1: dò mã → lời chào ===== */
  let debounceTimer = 0;
  let currentAbort = null;

  /* Vẽ vùng #greet theo trạng thái dò. Tên từ Sheet là do người nhập tay nên luôn qua esc(). */
  function renderLookup(status, name) {
    el.input.classList.remove('found', 'not-found');
    el.lookupState.className = 'lookup-state';
    el.lookupState.textContent = '';
    el.greeting.textContent = '';
    if (status === 'loading') {
      el.lookupState.classList.add('searching');
      el.lookupState.textContent = TEXT.searching;
    } else if (status === 'disabled') {
      el.lookupState.textContent = '';
      el.greeting.textContent = TEXT.hello;
    } else if (status === 'found') {
      el.greeting.innerHTML = esc(TEXT.hello + ' ' + name);
      el.input.classList.add('found');
    } else if (status === 'notfound' || status === 'timeout') {
      el.lookupState.classList.add('not-found');
      el.lookupState.textContent = TEXT.notFound;
      el.greeting.textContent = TEXT.hello;
      el.input.classList.add('not-found');
    }
  }

  /* Hủy mọi thứ đang chờ: debounce, fetch đang bay; tăng seq để response cũ (kể cả JSONP) bị bỏ */
  function cancelLookup() {
    clearTimeout(debounceTimer);
    debounceTimer = 0;
    if (currentAbort) { try { currentAbort.abort(); } catch (e) { /* bỏ qua */ } currentAbort = null; }
    state.lookup.seq++;
  }

  /* Kết thúc một lần dò; chỉ nhận nếu seq còn đúng (người dùng chưa sửa mã) */
  function finishLookup(seq, json, failStatus) {
    if (seq !== state.lookup.seq) return;
    currentAbort = null;
    const found = !!(json && json.found && json.name);
    state.lookup.name = found ? String(json.name).trim().slice(0, 80) : '';
    state.lookup.status = found ? 'found' : (failStatus || 'notfound');
    if (json && json.reason) console.warn('checkin: dò tên trả về reason=' + json.reason);
    renderLookup(state.lookup.status, state.lookup.name);
    checkFormCompletion();
  }

  /* Fallback JSONP khi fetch bị chặn CORS/redirect (TypeError) – template json_() đã hỗ trợ callback */
  const JSONP_LATE_GRACE_MS = 5000; // quá giờ: giữ hàm rỗng thêm chừng này rồi mới xóa hẳn
  function lookupJsonp(url, seq, remainingMs) {
    const fnName = '__capyLookup' + seq;
    const script = document.createElement('script');
    let done = false;
    let timer = 0;
    const removeFn = () => { try { delete window[fnName]; } catch (e) { window[fnName] = undefined; } };
    /* late=true (quá giờ): script có thể vẫn về muộn và gọi hàm → thay bằng hàm rỗng, 5 giây sau mới xóa,
       tránh ReferenceError trong console. Nhận được callback hoặc lỗi tải thì xóa ngay. */
    const cleanup = late => {
      done = true;
      clearTimeout(timer);
      if (late) { window[fnName] = function () { /* về muộn, bỏ qua */ }; setTimeout(removeFn, JSONP_LATE_GRACE_MS); }
      else removeFn();
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    const fail = (why, late) => {
      if (done) return;
      cleanup(late);
      console.warn('checkin: JSONP dò tên ' + why + ', coi như không tìm thấy');
      finishLookup(seq, { found: false }, 'timeout');
    };
    window[fnName] = json => { if (done) return; cleanup(false); finishLookup(seq, json); };
    script.onerror = () => fail('lỗi', false);
    timer = setTimeout(() => fail('quá giờ', true), remainingMs);
    script.src = url + '&callback=' + fnName;
    document.head.appendChild(script);
  }

  function lookup(id) {
    cancelLookup();
    const seq = state.lookup.seq;
    state.lookup.id = id;
    state.lookup.name = '';

    /* Tạm tắt dò tên (config LOOKUP_ENABLED=false): không gọi mạng, chỉ chào chung */
    if (C.LOOKUP_ENABLED === false) {
      state.lookup.status = 'disabled';
      renderLookup('disabled');
      checkFormCompletion();
      return;
    }

    state.lookup.status = 'loading';
    renderLookup('loading');

    if (!C.GOOGLE_SCRIPT_URL) {
      console.warn('checkin: GOOGLE_SCRIPT_URL trống, không dò tên được');
      finishLookup(seq, { found: false }, 'timeout');
      return;
    }
    if (navigator.onLine === false) {
      console.warn('checkin: đang mất mạng, không dò tên được');
      finishLookup(seq, { found: false }, 'timeout');
      return;
    }

    const url = C.GOOGLE_SCRIPT_URL + '?action=lookup&id=' + encodeURIComponent(id);
    const started = Date.now();
    const timeoutMs = C.LOOKUP_TIMEOUT_MS || 1500;
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    currentAbort = ctrl;

    /* Hẹn giờ dùng chung cho cả hai trường hợp: có AbortController thì hủy fetch thật;
       không có (WebView cũ) hay fetch treo không chịu hủy thì promise này tự reject AbortError,
       để "Đang tìm…" không đứng mãi. */
    let timer = 0;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        if (ctrl) { try { ctrl.abort(); } catch (e) { /* bỏ qua */ } }
        const err = new Error('dò tên quá ' + timeoutMs + ' ms');
        err.name = 'AbortError';
        reject(err);
      }, timeoutMs);
    });

    let req;
    try {
      req = fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined });
    } catch (e) {
      req = Promise.reject(e);
    }
    Promise.race([req.then(r => r.json()), timeout])
      .then(json => { clearTimeout(timer); finishLookup(seq, json); })
      .catch(err => {
        clearTimeout(timer);
        if (seq !== state.lookup.seq) return; // người dùng đã sửa mã, bỏ kết quả này
        const remaining = timeoutMs - (Date.now() - started);
        const isTypeError = !!(err && err.name === 'TypeError');
        if (isTypeError && navigator.onLine !== false && remaining > 100) {
          lookupJsonp(url, seq, remaining);
          return;
        }
        console.warn('checkin: dò tên thất bại (' + (err && err.name ? err.name : 'lỗi') + '), coi như không tìm thấy');
        finishLookup(seq, { found: false }, 'timeout');
      });
  }

  /* Gõ vào ô mã: mã đổi → xóa lời chào cũ; đủ ký tự → debounce rồi dò */
  function onIdInput() {
    const id = normalizeId(el.input.value);
    if (id !== state.lookup.id) {
      cancelLookup();
      state.lookup.id = id;
      state.lookup.status = 'idle';
      state.lookup.name = '';
      renderLookup('idle');
    }
    checkFormCompletion();
    if (id.length >= C.ID_MIN_LENGTH && state.lookup.status === 'idle') {
      clearTimeout(debounceTimer);
      if (C.LOOKUP_ENABLED === false) lookup(id);   // không có mạng để chờ, chào ngay
      else debounceTimer = setTimeout(() => lookup(id), C.LOOKUP_DEBOUNCE_MS || 400);
    }
  }

  /* Rời ô: đủ ký tự mà chưa dò (hoặc lần trước quá giờ) thì dò ngay, không chờ debounce */
  function onIdBlur() {
    const id = normalizeId(el.input.value);
    const st = state.lookup.status;
    if (id.length >= C.ID_MIN_LENGTH && id === state.lookup.id && (st === 'idle' || st === 'timeout')) lookup(id);
  }

  /* ===== Bước 2: thanh trượt 1–10, capybara đổi mặt ===== */
  function renderLevelImg(lv) {
    const src = (C.ASSET_BASE || '') + lv.image;
    let img = el.levelImg;
    if (!img || img.tagName !== 'IMG') {
      /* Ảnh mức trước đã hỏng và bị thay bằng emoji → thử lại bằng <img> mới cho mức này */
      const fresh = document.createElement('img');
      fresh.id = 'level-img';
      fresh.className = 'emotion-capy';
      fresh.decoding = 'async';
      if (img && img.parentNode) img.parentNode.replaceChild(fresh, img);
      img = fresh;
      el.levelImg = img;
    }
    img.alt = lv.text;
    img.setAttribute('data-fallback', lv.emoji);
    if (img.getAttribute('src') !== src) img.src = src;
  }

  /* Ảnh mỗi mức nặng 1–1,7 MB: kéo lướt qua nhiều nấc chỉ đổi nhãn + aria-valuetext + state,
     ảnh đổi khi dừng tay ~150 ms (sự kiện input) hoặc ngay (sự kiện change, khởi động, "ca khác").
     Ảnh đã đổi thì giữ, renderLevelImg() không gán lại src trùng. */
  const LEVEL_IMG_DEBOUNCE_MS = 150;
  let levelImgTimer = 0;
  function setLevel(n, immediate) {
    const lv = D.LEVELS[n] || D.LEVELS[D.DEFAULT_LEVEL];
    if (!lv) return;
    state.checkin.level = lv.n;
    state.checkin.levelText = lv.text;
    const text = lv.n + ' · ' + lv.text;
    el.range.value = String(lv.n);
    el.range.setAttribute('aria-valuetext', text);
    el.levelLabel.textContent = text;
    clearTimeout(levelImgTimer);
    if (immediate) renderLevelImg(lv);
    else levelImgTimer = setTimeout(() => renderLevelImg(lv), LEVEL_IMG_DEBOUNCE_MS);
  }

  /* ===== Bước 3: lưới thẻ Capybara, chọn 1 ===== */
  function renderCards() {
    el.grid.innerHTML = D.EMOTIONS.map(e => `
      <button type="button" class="capy-card" data-act="pick" data-emotion="${esc(e.code)}" aria-pressed="false">
        <img src="${esc((C.ASSET_BASE || '') + e.image)}" alt="" loading="lazy" decoding="async" data-fallback="${esc(e.emoji)}">
        <span class="capy-label">${esc(e.label)}</span>
        <span class="check-mark-badge" aria-hidden="true">✓</span>
      </button>`).join('');
  }

  function pick(btn) {
    const code = btn.getAttribute('data-emotion');
    const emo = D.EMOTIONS.filter(x => x.code === code)[0];
    if (!emo) return;
    $$('.capy-card', el.grid).forEach(c => {
      const on = c === btn;
      c.classList.toggle('selected', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    state.checkin.emotion = emo.label;
    vibrate(20);
    checkFormCompletion();
  }

  function clearCards() {
    $$('.capy-card', el.grid).forEach(c => {
      c.classList.remove('selected');
      c.setAttribute('aria-pressed', 'false');
    });
    state.checkin.emotion = '';
  }

  /* ===== Hint tiến độ và nút hoàn thành "thức dậy" =====
     Ba trạng thái, ưu tiên nhắc mã trước. "Có mã" = đủ ID_MIN_LENGTH ký tự, không cần dò thấy tên. */
  function checkFormCompletion() {
    const hasId = normalizeId(el.input.value).length >= C.ID_MIN_LENGTH;
    const hasEmotion = !!state.checkin.emotion;
    const ready = hasId && hasEmotion;

    el.hint.classList.toggle('need-id', !hasId);
    el.hint.classList.toggle('need-card', hasId && !hasEmotion);
    el.hint.classList.toggle('done', ready);
    el.hint.textContent = !hasId ? TEXT.needId : (!hasEmotion ? TEXT.needCard : TEXT.done);

    const canClick = ready && !state.submitting;
    el.btn.classList.toggle('ready', canClick);
    el.btn.disabled = !canClick;
    return ready;
  }

  /* ===== Gửi lạc quan và bản sao dự phòng =====
     Bản sao localStorage là HÀNG CHỜ, không phải nhật ký: ghi trước khi gửi, máy chủ trả result:'success'
     thì XÓA phần tử đó. Bình thường localStorage rỗng; chỉ còn lại lượt gửi hỏng (mất mạng, máy chủ từ chối),
     lần tải trang sau resendPending() gửi lại, an toàn nhờ upsert theo sessionId. Điện thoại trực dùng chung
     nên không giữ dữ liệu của đồng nghiệp lâu hơn cần thiết. Trần BACKUP_MAX (20) phần tử.
     Backend tự tra tên và suy levelText từ level; client vẫn gửi đủ 7 trường theo contract 4.1. */
  const PAYLOAD_KEYS = ['created_at', 'sessionId', 'employeeId', 'name', 'level', 'levelText', 'emotion'];
  const RESEND_MAX = 5;

  /* Một chỗ duy nhất suy ra employeeId / name / levelText ngay trước khi gửi */
  function buildPayload() {
    const id = normalizeId(el.input.value);
    const lv = D.LEVELS[state.checkin.level] || D.LEVELS[D.DEFAULT_LEVEL];
    const name = (state.lookup.status === 'found' && state.lookup.id === id) ? state.lookup.name : '';
    state.checkin = {
      created_at: formatNow(new Date()),
      sessionId: state.sessionId,
      employeeId: id,
      name: name,
      level: lv.n,
      levelText: lv.text,
      emotion: state.checkin.emotion
    };
    return Object.assign({}, state.checkin);
  }

  /* Lấy đúng 7 trường từ một phần tử hàng chờ (bỏ cờ sent, bỏ rác) trước khi gửi lại */
  const toPayload = x => {
    const p = {};
    PAYLOAD_KEYS.forEach(k => { p[k] = x[k]; });
    return p;
  };

  function readBackup() {
    try {
      const list = JSON.parse(localStorage.getItem(C.BACKUP_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  const writeBackup = list => localStorage.setItem(C.BACKUP_KEY, JSON.stringify(list));

  /* localStorage có thể đầy, bị chặn (riêng tư) hoặc throw: không bao giờ chặn trang cám ơn.
     sent:false chỉ là dấu "đang chờ gửi" cho ai đọc dữ liệu tay; gửi xong thì cả phần tử bị xóa. */
  function saveBackup(payload) {
    const max = C.BACKUP_MAX || 20;
    let list = readBackup().concat([Object.assign({}, payload, { sent: false })]);
    while (list.length > max) list.shift();
    try {
      writeBackup(list);
    } catch (e1) {
      try {
        if (list.length > 1) list.shift(); // đầy → bỏ cũ nhất, thử lại một lần
        writeBackup(list);
      } catch (e2) {
        console.warn('checkin: không lưu được bản sao localStorage', e2);
      }
    }
  }

  /* Gửi thành công → xóa phần tử khỏi hàng chờ */
  function removeBackup(sessionId) {
    try {
      const list = readBackup();
      const left = list.filter(x => !(x && x.sessionId === sessionId));
      if (left.length !== list.length) writeBackup(left);
    } catch (e) { /* không quan trọng, bỏ qua */ }
  }

  /* POST text/plain (không preflight CORS), keepalive để đóng tab vẫn gửi, KHÔNG await.
     json.result !== 'success' (vd. error: 'emotion_invalid') coi như CHƯA gửi → giữ bản sao.
     quiet=true (gửi lại lúc tải trang): im lặng hoàn toàn, không console.warn. */
  function sendPayload(payload, quiet) {
    if (!C.GOOGLE_SCRIPT_URL) {
      if (!quiet) console.warn('checkin: GOOGLE_SCRIPT_URL trống, không gửi; đã giữ bản sao localStorage');
      return;
    }
    let req;
    try {
      req = fetch(C.GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        keepalive: true
      });
    } catch (e) {
      req = Promise.reject(e);
    }
    req.then(r => r.json())
      .then(json => {
        if (json && json.result === 'success') removeBackup(payload.sessionId);
        else if (!quiet) console.warn('checkin: máy chủ không nhận (' + (json && json.error ? json.error : 'không rõ') + '), đã giữ bản sao localStorage');
      })
      .catch(() => { if (!quiet) console.warn('checkin: gửi thất bại, đã giữ bản sao localStorage'); });
  }

  /* Gửi lại hàng chờ lúc tải trang (tech design 5.5, P1): tối đa RESEND_MAX bản mới nhất, không chờ, im lặng,
     thành công thì xóa. Phần tử sent:true của bản cũ (trước khi đổi sang xóa-khi-thành-công) thì dọn luôn. */
  function resendPending() {
    let list;
    try {
      list = readBackup();
      const pending = list.filter(x => x && x.sessionId && x.employeeId && x.sent !== true);
      if (pending.length !== list.length) writeBackup(pending);
      list = pending;
    } catch (e) { return; }
    if (!C.GOOGLE_SCRIPT_URL || navigator.onLine === false || !list.length) return;
    list.slice(-RESEND_MAX).forEach(x => sendPayload(toPayload(x), true));
  }

  function submit() {
    if (state.submitting || !checkFormCompletion()) return; // chống bấm đúp lớp 1
    state.submitting = true;
    el.btn.disabled = true;
    el.btn.classList.remove('ready');
    el.btn.classList.add('sending');
    const payload = buildPayload();
    saveBackup(payload);
    sendPayload(payload);
    showThanks(payload); // sang trang cám ơn ngay, không phụ thuộc mạng
  }

  /* ===== Trang cám ơn ===== */
  function focusHeading(h) {
    if (!h) return;
    try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }
  }

  function showThanks(p) {
    const who = p.name || p.employeeId;
    el.summary.innerHTML = esc(who + ' · Mức ' + p.level + ' · ' + p.levelText + ' · ' + p.emotion);
    el.check.classList.toggle('still', reduceMotion()); // tick tĩnh khi người dùng tắt chuyển động
    el.card.hidden = true;
    el.thanks.hidden = false;
    scrollTo(0, 0);
    focusHeading(el.thanksTitle);
  }

  /* "Check-in cho ca khác": phiên mới, thẻ và thanh trượt về mặc định,
     GIỮ ô mã và lời chào (người vừa gõ nhầm sửa cho tiện; ô mã select-all khi focus để gõ đè) */
  function again() {
    state.sessionId = newSessionId();
    state.submitting = false;
    clearCards();
    setLevel(D.DEFAULT_LEVEL, true);
    el.btn.classList.remove('sending');
    el.thanks.hidden = true;
    el.card.hidden = false;
    scrollTo(0, 0);
    focusHeading(el.pageTitle);
    checkFormCompletion();
  }

  /* ===== Đánh thức Apps Script lúc tải trang (không chờ, nuốt lỗi) ===== */
  function ping() {
    if (!C.GOOGLE_SCRIPT_URL) return;
    try {
      fetch(C.GOOGLE_SCRIPT_URL + '?action=ping', { method: 'GET', redirect: 'follow' }).catch(() => { /* im lặng */ });
    } catch (e) { /* im lặng */ }
  }

  /* ===== Sự kiện: event delegation theo data-act, không onclick ===== */
  const actions = { pick, submit, again };
  document.addEventListener('click', e => {
    const target = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!target) return;
    const fn = actions[target.getAttribute('data-act')];
    if (fn) { e.preventDefault(); fn(target, e); }
  });

  /* ===== Khởi động ===== */
  function init() {
    el.card = $('#checkin');
    el.thanks = $('#thanks');
    el.pageTitle = $('#page-title');
    el.thanksTitle = $('#thanks-title');
    el.input = $('#employee-id');
    el.greet = $('#greet');
    el.lookupState = $('.lookup-state', el.greet);
    el.greeting = $('.greeting', el.greet);
    el.range = $('#level-range');
    el.levelImg = $('#level-img');
    el.levelLabel = $('#level-label');
    el.grid = $('#capy-grid');
    el.hint = $('#progress-hint');
    el.btn = $('#btn-submit');
    el.summary = $('#summary');
    el.check = $('.success-checkmark', el.thanks);

    state.sessionId = newSessionId();
    document.title = C.APP_NAME || document.title;

    /* Ô mã: độ dài và bàn phím theo config; không autofocus (tránh bàn phím che màn 375px) */
    if (C.ID_MAX_LENGTH) el.input.maxLength = C.ID_MAX_LENGTH;
    el.input.setAttribute('inputmode', C.ID_NUMERIC ? 'numeric' : 'text');
    /* Dò tên đang tắt → đổi hint bước 1 cho khỏi hứa "mình sẽ tìm tên" */
    if (C.LOOKUP_ENABLED === false) { const h = $('#step1-hint'); if (h) h.textContent = TEXT.hintNoLookup; }
    el.input.addEventListener('input', onIdInput);
    el.input.addEventListener('blur', onIdBlur);
    el.input.addEventListener('focus', () => {
      /* Điện thoại trực dùng chung: chọn hết để người sau gõ đè một lần là xong */
      setTimeout(() => { try { el.input.select(); } catch (e) { /* bỏ qua */ } }, 0);
    });
    el.input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.input.blur(); } // "Xong" trên bàn phím → đóng bàn phím và dò
    });

    /* input: đang kéo → nhãn đổi ngay, ảnh chờ debounce; change: buông tay / bấm phím → ảnh đổi ngay */
    el.range.addEventListener('input', () => setLevel(parseInt(el.range.value, 10), false));
    el.range.addEventListener('change', () => setLevel(parseInt(el.range.value, 10), true));

    renderCards();
    setLevel(D.DEFAULT_LEVEL, true);
    checkFormCompletion();
    ping();
    resendPending();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
