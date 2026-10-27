/* =========================================================
   Server tĩnh cho test: phục vụ thư mục app, KHÔNG sửa file gốc.
   Khi trả js/config.js thì thay GOOGLE_SCRIPT_URL: '' bằng mockUrl ngay lúc trả về
   (và ASSET_BASE nếu được yêu cầu), để js/config.js trên đĩa giữ nguyên rỗng.
   Dùng: const { startStatic } = require('./static-server');
         const srv = await startStatic({ port, appDir, mockUrl, assetBase });
         ... srv.close();
   ========================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function startStatic(opts) {
  const appDir = path.resolve(opts.appDir);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.join(appDir, rel);
    if (!file.startsWith(appDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    let data = fs.readFileSync(file);
    if (rel.replace(/\\/g, '/') === 'js/config.js') {
      let src = data.toString('utf8');
      // Config gốc được phép rỗng hoặc URL Apps Script thật (đã deploy); cấm localhost để sót khi đẩy lên Pages
      if (!/GOOGLE_SCRIPT_URL: '(|https:\/\/script\.google\.com\/macros\/s\/[^']+\/exec)'/.test(src)) {
        throw new Error("js/config.js gốc phải có GOOGLE_SCRIPT_URL rỗng hoặc URL script.google.com/.../exec – test không chạy trên file trỏ localhost");
      }
      // Chỉ thay ĐÚNG dòng cấu hình (đầu dòng), không đụng dòng comment cũng chứa chữ GOOGLE_SCRIPT_URL
      const cfgLine = /^(\s*)GOOGLE_SCRIPT_URL: '[^']*'/m;
      if (!cfgLine.test(src)) throw new Error('js/config.js: không thấy dòng GOOGLE_SCRIPT_URL ở đầu dòng');
      src = src.replace(cfgLine, '$1GOOGLE_SCRIPT_URL: ' + JSON.stringify(opts.mockUrl || ''));
      // Chốt an toàn: config phục vụ cho test KHÔNG BAO GIỜ được trỏ về script thật (ghi vào Sheet của anh Thông)
      const served = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      if (/script\.google\.com/.test(served)) throw new Error('config.js phục vụ cho test vẫn trỏ script.google.com – dừng để không ghi vào Sheet thật');
      if (opts.assetBase) src = src.replace(/ASSET_BASE: '[^']*'/, 'ASSET_BASE: ' + JSON.stringify(opts.assetBase));
      // Test dò tên chạy với LOOKUP_ENABLED: true; file gốc có thể đang tắt (quyết định triển khai)
      if (opts.lookupEnabled !== false) src = src.replace(/LOOKUP_ENABLED: (true|false)/, 'LOOKUP_ENABLED: true');
      data = Buffer.from(src, 'utf8');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port, '127.0.0.1', () => resolve({
      url: 'http://127.0.0.1:' + opts.port + '/',
      close: () => new Promise(r => server.close(r))
    }));
  });
}

module.exports = { startStatic };
