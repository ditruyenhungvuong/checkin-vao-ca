# Check-in khi vào ca

Trang web một màn hình cho nhân viên y tế ghi lại trạng thái trước ca trực: nhập mã số nhân viên, kéo thanh trượt 1–10, chọn một bé Capybara, bấm "Hoàn thành check-in". Mỗi lượt là một dòng trên Google Sheet của tài khoản `bsngvanthong@gmail.com`; dữ liệu **có định danh** (mã, tên), không ẩn danh, và trang nói rõ điều đó với người dùng.

- Cỡ **S** (một trang, một việc), biến thể **Xanh navy** cho nhân viên y tế. Không build, không framework, deploy GitHub Pages.
- Web: `https://ditruyenhungvuong.github.io/checkin-vao-ca/` (sau khi đẩy lên, xem mục 3).
- Ảnh màn hình: *chụp sau khi deploy*.
- Tài liệu gốc: [PRD](../../docs/specs/checkin-vao-ca-prd.md) · [Tech design](../../docs/specs/checkin-vao-ca-tech-design.md) · [UX](../../docs/specs/checkin-vao-ca-ux.md) · [ADR 0001 – Google Sheet backend](../../docs/adr/0001-google-sheet-backend.md) · [Style guide](../../docs/style/style-guide.md).

Thứ tự làm để dùng thật: **mục 1** (Sheet + Apps Script) → dán URL vào `js/config.js` (mục 4) → **mục 3** (đẩy lên GitHub Pages) → in QR. Mục 2 chỉ dành cho lúc sửa code.

---

## 1. Cài Google Sheet + Apps Script

Phần này anh Thông tự làm trên tài khoản `bsngvanthong@gmail.com`, khoảng 10 phút, làm đúng thứ tự. Nội dung lấy nguyên từ phần hướng dẫn ở đầu file `google_apps_script.js`. Đội không có quyền trên tài khoản này nên các bước dưới **chưa kiểm chứng trên Sheet thật**; script đã được chạy thử bằng `tools/mock-api.js` (cùng contract) và hàm `test_` trong editor.

**Mục tiêu:** có một URL `.../exec` để app dò tên và ghi dữ liệu.

### Bước 1 – Tạo Google Sheet
1. Vào `https://sheets.new` (đang đăng nhập `bsngvanthong@gmail.com`).
2. Đặt tên file, ví dụ "Check-in vào ca".
3. Tab đầu tiên đang tên "Trang tính1" (hoặc "Sheet1"): nhấp đúp vào tên tab ở góc dưới, đổi thành `CheckIn` (viết liền, C và I hoa).
4. Không cần gõ tiêu đề cột. Script tự tạo 7 cột và tự ẩn cột G khi có dòng đầu tiên.
5. Sheet đã có dữ liệu 6 cột từ bản cũ cũng dùng được: script tự ghi tiêu đề cột G "Mã phiên" và ẩn cột này, không đụng 6 cột đầu.

### Bước 2 – Tạo tab `DanhSach` (danh sách nhân viên)
1. Bấm dấu `+` ở góc dưới bên trái để thêm tab mới, đổi tên thành `DanhSach` (viết liền, D và S hoa, không dấu).
2. Ô A1 gõ `Mã`, ô B1 gõ `Tên`.
3. **Làm TRƯỚC khi nhập mã:** bấm vào chữ `A` trên đầu cột để chọn cả cột A → menu **Định dạng** (Format) → **Số** (Number) → **Văn bản thuần** (Plain text). Nhờ vậy mã `0042` giữ số 0 đầu, mã `1-2` không bị Sheets đổi thành ngày tháng. Script cũng tự đặt định dạng này mỗi lần chạy, nhưng mã đã gõ trước đó thì không tự sửa lại được.
4. Từ dòng 2 trở đi: cột A là mã nhân viên (ví dụ `1234`), cột B là tên đầy đủ (ví dụ `Nguyễn Thị Hạnh`).
5. Mã gõ số thường, không gõ số full-width (`１２３４`). Có gạch nối hay khoảng trắng cũng được, script tự bỏ. Mã có chữ thì không phân biệt hoa thường.
6. Chưa có danh sách cũng không sao: script tự tạo tab trống, ai nhập mã cũng nhận lời chào chung và cột Tên để trống. Nhập sau vẫn được.
7. Cột Tên trên tab `CheckIn` **luôn lấy từ `DanhSach` theo mã**; tên client gửi bị bỏ qua. Muốn đổi tên ai thì sửa `DanhSach`.

### Bước 3 – Dán script
1. Trên Sheet: menu **Tiện ích mở rộng** (Extensions) → **Apps Script**.
2. Trong file `Code.gs`, xóa hết code mẫu, dán **toàn bộ** nội dung file `google_apps_script.js` vào.
3. Bấm biểu tượng đĩa mềm (Lưu) hoặc `Ctrl+S`.

### Bước 4 – Chạy thử một lần trong editor và cấp quyền
1. Ở thanh công cụ, ô chọn hàm (cạnh nút Chạy/Run) chọn `test_` rồi bấm **Chạy**.
2. Lần đầu Google hỏi quyền: **Xem lại quyền** → chọn tài khoản → **Nâng cao** (Advanced) → **Đi tới … (không an toàn)** → **Cho phép**. Đây là script của chính anh nên cảnh báo này là bình thường.
3. Mở **Nhật ký thực thi** (Execution log) ở dưới. Thấy các dòng `test_: ...` và cuối cùng `test_: XONG` là được. Dòng thử đã được xóa tự động.

Kết quả mong đợi: tab `CheckIn` có hàng tiêu đề 7 cột tô navy nhạt, cột G đã ẩn; tab `DanhSach` giữ nguyên.

### Bước 5 – Triển khai thành Ứng dụng web
1. Nút **Triển khai** (Deploy) ở góc trên phải → **Triển khai mới** (New deployment).
2. Bấm bánh răng cạnh "Chọn loại" → **Ứng dụng web** (Web app).
3. Điền:
   - Mô tả: gõ gì cũng được, ví dụ `v1`.
   - **Thực thi với tư cách** (Execute as): **Tôi** (Me).
   - **Ai có quyền truy cập** (Who has access): **Bất kỳ ai** (Anyone).
   - Phải là "Bất kỳ ai". **KHÔNG** chọn "Bất kỳ ai có tài khoản Google" (Anyone with Google account). Chọn sai thì điện thoại trực sẽ bị bắt đăng nhập và app không dò tên, không ghi được.
4. Bấm **Triển khai**. Nếu hỏi quyền thì cho phép như bước 4.2.
5. Chép dòng **URL ứng dụng web** (dạng `https://script.google.com/macros/s/.../exec`). Đó là `GOOGLE_SCRIPT_URL`.

### Bước 6 – Kiểm tra nhanh trên trình duyệt
Mở từng địa chỉ sau (thay `<URL>` bằng URL vừa chép):

| Mở | Kết quả mong đợi |
|---|---|
| `<URL>?action=ping` | `{"result":"success","pong":true}` |
| `<URL>?action=lookup&id=1234` (thay `1234` bằng một mã có trong `DanhSach`; app hiện tắt dò tên nên bước này chỉ để kiểm script) | `{"result":"success","found":true,"name":"..."}` hoặc `{"result":"success","found":false,"reason":"no_list"}` khi `DanhSach` còn trống |
| `<URL>` (không có gì phía sau) | `{"result":"error","error":"public_read_disabled"}` – đúng ý: không ai xem được dữ liệu `CheckIn` qua đường link |

### Bước 7 – Dán URL vào app
1. Mở `js/config.js`.
2. Dán URL vào dòng `GOOGLE_SCRIPT_URL: ''` → `GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/.../exec'`.
3. Lưu file, rồi đẩy lên GitHub (mục 3). Hoặc gửi URL cho đội để đội dán.

### Lần sau sửa code script mà vẫn giữ URL
1. Dán code mới vào `Code.gs` → Lưu.
2. **Triển khai** → **Quản lý bản triển khai** (Manage deployments).
3. Bấm biểu tượng bút chì → **Phiên bản**: chọn **Phiên bản mới** (New version) → **Triển khai**.
4. URL giữ nguyên, không phải sửa `config.js`.

Lưu ý: nếu bấm "Triển khai mới" thay vì "Quản lý bản triển khai", Google tạo một URL khác và URL cũ vẫn chạy phiên bản cũ.

---

## 2. Chạy local (khi sửa code)

### 2.1 Chạy web server tĩnh
Mở PowerShell tại thư mục app rồi chạy:

```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

- Mặc định mở `http://localhost:8765/` và tự bật trình duyệt.
- `-Port 9000`: đổi cổng.
- `-NoBrowser`: không tự mở trình duyệt (dùng cho kiểm thử tự động).
- Script thử lần lượt `python` → `py` → `npx serve` → `php`, có cái nào thì dùng. Máy chưa có gì thì script in hướng dẫn cài Python.
- Server **chỉ nhận kết nối từ `127.0.0.1`** (máy này), không mở ra mạng LAN bệnh viện. Muốn thử trên điện thoại thật thì dùng GitHub Pages (mục 3).
- Bấm `Ctrl+C` để tắt.

Đã kiểm chứng ngày 27/10/2026 trên máy có Python 3.13: `powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8798 -NoBrowser` chạy bằng `python`, `index.html` và `js/config.js` trả HTTP 200.

Mở `index.html` trực tiếp bằng `file://` cũng hiện trang, nhưng dò tên và gửi dữ liệu qua `fetch` có thể bị trình duyệt chặn. Nên dùng server ở trên.

### 2.2 Test không cần Sheet thật: `tools/mock-api.js`
Mock API giả lập đúng contract của `google_apps_script.js`: POST ghi dòng (kiểm tra dữ liệu, tự tra tên, tự suy mức chữ y như script thật), `?action=lookup`, `?action=ping`, không action → `public_read_disabled`, JSONP qua `&callback=`.

Dữ liệu ghi ra file trong thư mục tạm của máy: `%TEMP%\checkin-vao-ca-mock-data.json` (trên máy này là `C:\Users\SF\AppData\Local\Temp\checkin-vao-ca-mock-data.json`). Đổi chỗ ghi bằng biến môi trường `MOCK_DATA`. Mock **không** ghi gì vào thư mục app vì thư mục nằm trên Google Drive, đồng bộ liên tục từng gây treo. Lúc khởi động mock in ra đường dẫn file đang dùng.

Cần **Node.js**. Máy này chưa có `node` trong PATH nhưng có bản Node portable tại:

```
C:\Users\SF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
```

Dùng bản portable thì thay `node` trong các lệnh dưới bằng đường dẫn trên (trong PowerShell: `& "C:\Users\SF\.cache\...\node.exe" tools/mock-api.js`). Hoặc cài Node một lần rồi mở lại PowerShell (chưa kiểm chứng):

```powershell
winget install OpenJS.NodeJS.LTS
```

Lệnh chạy mock:

```powershell
node tools/mock-api.js                                  # cổng 8787
node tools/mock-api.js --slow                           # mọi request trễ 2000 ms, để thử timeout 1500 ms của app
$env:PORT=9000; node tools/mock-api.js                  # đổi cổng
$env:MOCK_DATA='D:\tmp\x.json'; node tools/mock-api.js   # đổi file dữ liệu
```

Đã kiểm chứng ngày 27/10/2026 bằng Node portable 24.22.1 (cổng 8799, `MOCK_DATA` trỏ vào thư mục tạm): `?action=ping` trả `pong`, `?action=lookup&id=1001` trả "Nguyễn Thị Hạnh", POST một dòng trả `inserted` và file dữ liệu có đúng 7 trường; mock bỏ qua `name` và `levelText` client gửi, tự điền từ danh sách và từ `level`. Tùy chọn `--slow` chưa kiểm chứng.

Danh sách mẫu có sẵn trong mock (thay cho tab `DanhSach`):

| Mã | Tên |
|---|---|
| `1001` | Nguyễn Thị Hạnh |
| `1002` | Trần Văn Minh |
| `1003` | Lê Thu Thảo |
| `A123` | Phạm Quốc Bảo |
| `2024` | Võ Ngọc Lan |

Cách nối app với mock:
1. Chạy mock ở một cửa sổ PowerShell, chạy `tools\serve.ps1` ở cửa sổ khác.
2. Trong `js/config.js`, tạm đặt `GOOGLE_SCRIPT_URL: 'http://localhost:8787/'`.
3. Mở `http://localhost:8765/`, gõ mã `1001`, thấy "Xin chào anh/chị Nguyễn Thị Hạnh" là mock đang chạy.
4. **Trước khi đẩy lên GitHub, trả `GOOGLE_SCRIPT_URL` về URL thật** (hoặc `''`). Để sót `localhost` thì trang trên Pages không dò tên và không ghi được gì.

### 2.3 Chạy bộ test của QA: `tests\run-all.cmd`
Bộ test gồm 4 bước, chạy lần lượt: rà tĩnh (`tests/check-static.js`), contract của mock (`tests/test-mock-api.js`), `google_apps_script.js` với `SpreadsheetApp` giả lập (`tests/test-gas.js`), E2E Chrome headless 7 kịch bản (`tests/e2e.js`).

Điều kiện:
- Có Node (trong PATH, hoặc đặt biến `NODE` trỏ tới `node.exe`).
- Có Chrome tại `C:\Program Files\Google\Chrome\Application\chrome.exe` (hoặc đặt biến `CHROME=...`).
- `js/config.js` đang để `GOOGLE_SCRIPT_URL: ''`.

Mở Command Prompt (cmd) tại thư mục app:

```bat
set NODE=C:\Users\SF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
tests\run-all.cmd
```

Trong PowerShell thì viết `$env:NODE='C:\Users\SF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'; tests\run-all.cmd`. Node đã cài trong PATH thì bỏ dòng `set NODE`, chạy thẳng `tests\run-all.cmd`.

Kết quả mong đợi: dòng cuối `KET QUA: TAT CA XANH`. Screenshot, console log và kết quả E2E ghi vào `%TEMP%\checkin-vao-ca-qa\` (đổi bằng `--out=...`). Bộ test không sửa file nào của app.

Lệnh `tests\run-all.cmd` **chưa kiểm chứng** trong lần viết tài liệu này (QA đang chạy bộ test song song, tránh chạy chồng). Báo cáo QA nằm ở `docs/qa/`.

---

## 3. Deploy lên GitHub Pages

**Mục tiêu:** trang chạy tại `https://ditruyenhungvuong.github.io/checkin-vao-ca/` để in QR.

Lần đầu:
1. Mở `https://github.com/new` bằng tài khoản `ditruyenhungvuong`. Tên repo: `checkin-vao-ca`. Chọn **Public**. **Không** tick "Add a README file". Bấm **Create repository**.
2. Kiểm tra `js/config.js` đã có URL script thật (mục 1, bước 7).
3. Bấm đúp `upload.bat`. Lần đầu script tự `git init`, hỏi tên và email để ghi lịch sử, rồi commit và push lên nhánh `main`. Có thể hiện cửa sổ đăng nhập GitHub.
4. Trên GitHub: **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: `main`, thư mục `/ (root)` → **Save**.
5. Đợi 1–2 phút, mở `https://ditruyenhungvuong.github.io/checkin-vao-ca/`.
6. Tạo QR từ URL trên (bất kỳ trình tạo QR nào), in và dán ở phòng trực.

Các lần sau: sửa file → bấm đúp `upload.bat` → đợi 1–2 phút. Có thể truyền lời commit: `upload.bat "Sua mau nut"`.

Máy chưa có Git thì `upload.bat` in hướng dẫn cài (`https://git-scm.com/download/win`). Push thất bại thì script in ba nguyên nhân thường gặp (repo chưa tạo, tài khoản chưa có quyền, trên GitHub có thay đổi mà máy chưa có) và cách xử lý.

`upload.bat` **chưa chạy** trong lần viết tài liệu này (chờ anh Thông tạo repo và có URL script).

---

## 4. Cấu hình `js/config.js`

Mọi giá trị trong file này là **public**: trình duyệt tải nguyên văn, ai mở trang cũng đọc được. Không đặt khóa bí mật, mã nhân viên hay tên ai vào đây.

| Khóa | Mặc định | Ý nghĩa |
|---|---|---|
| `APP_NAME` | `'Check-in khi vào ca'` | Tên hiện ở tiêu đề tab trình duyệt. |
| `VERSION` | `'0.1.0'` | Phiên bản app, chỉ để theo dõi. |
| `GOOGLE_SCRIPT_URL` | `''` | URL Web App `.../exec` (mục 1). Để trống → app không dò tên, không gửi, chỉ `console.warn`, vẫn cho check-in và giữ lượt đó trong hàng chờ `localStorage`. |
| `LOOKUP_ENABLED` | `false` | **Đang tắt** theo quyết định của anh Thông (27/10/2026): app không gọi `?action=lookup`, chỉ chào chung "Xin chào anh/chị", hint bước 1 đổi thành "Nhập mã số nhân viên của anh/chị nhé." Cột Tên trên Sheet vẫn do script tự tra nếu tab `DanhSach` có mã. Muốn bật dò tên: đổi thành `true`, không cần sửa gì khác. |
| `ID_MIN_LENGTH` | `4` | Gõ đủ số ký tự này (sau khi bỏ ký tự không phải chữ/số) thì app dò tên (nếu bật) và tính là "có mã". |
| `ID_MAX_LENGTH` | `8` | Độ dài tối đa của ô mã (`maxlength`). |
| `ID_NUMERIC` | `true` | `true` → bàn phím số trên điện thoại (`inputmode="numeric"`). Mã có chữ thì đổi `false`. |
| `LOOKUP_TIMEOUT_MS` | `1500` | Dò tên quá thời gian này thì coi như không tìm thấy, không báo đỏ. |
| `LOOKUP_DEBOUNCE_MS` | `400` | Chờ ngừng gõ bấy nhiêu ms rồi mới dò. |
| `ASSET_BASE` | `'https://raw.githubusercontent.com/ditruyenhungvuong/nhatkymebau/main/'` | Nơi lấy 16 ảnh capybara. Đổi thành `'assets/'` khi đã tải ảnh vào repo, hoặc sang CDN jsDelivr để tải nhanh hơn (mục 8, việc 3 và 11). Đổi ở đây thì đổi luôn `href` của `<link rel="preload">` trong `index.html`. |
| `BACKUP_KEY` | `'checkin_vao_ca_backup'` | Khóa `localStorage` của hàng chờ: lượt chưa lên Sheet. Bình thường rỗng. |
| `BACKUP_MAX` | `20` | Hàng chờ giữ tối đa bấy nhiêu lượt. |

Cấu hình phía Apps Script nằm ở đầu `google_apps_script.js`: `ALLOW_PUBLIC_READ` (mặc định `false`), tên hai tab `CHECKIN_SHEET` / `LIST_SHEET`, `TIME_ZONE` (`Asia/Ho_Chi_Minh`, dùng khi script tự điền giờ), `USE_LIST_CACHE` (bật khi `DanhSach` > 2.000 dòng). Hai mảng `EMOTION_LABELS` và `LEVEL_TEXTS` phải trùng nguyên văn `js/data.js`; đổi nhãn ở một bên thì đổi cả bên kia.

---

## 5. Cấu trúc thư mục

```
apps/checkin-vao-ca/
├── index.html              một <main>: card 3 bước → nút hoàn thành → trang cám ơn (hidden) → toast
├── styles.css              design-tokens-navy.css ở :root + card, step, capy-grid, nút "thức dậy", tick xanh
├── js/
│   ├── config.js           window.APP_CONFIG – URL script, độ dài mã, timeout, ASSET_BASE (public)
│   ├── data.js             window.APP_DATA – LEVELS (10 mức) + EMOTIONS (6 thẻ), tên file ảnh, emoji fallback
│   └── app.js              IIFE: state, dò tên (fetch + JSONP fallback), hint tiến độ, gửi lạc quan, trang cám ơn
├── google_apps_script.js   dán vào Apps Script của Sheet; hướng dẫn cài tiếng Việt ở đầu file
├── upload.bat              deploy một nút: git init/add/commit/push lên ditruyenhungvuong/checkin-vao-ca
├── tools/
│   ├── serve.ps1           web server tĩnh local, chỉ 127.0.0.1 (python → py → npx serve → php)
│   └── mock-api.js         giả lập Apps Script bằng Node, cổng 8787 (ghi %TEMP%\checkin-vao-ca-mock-data.json)
├── tests/                  bộ test QA, chạy bằng run-all.cmd: check-static.js, test-mock-api.js, test-gas.js,
│                           e2e.js (Chrome headless), lib/ (cdp.js, static-server.js)
├── .gitignore              desktop.ini, Thumbs.db, .DS_Store, *.tmp, tools/mock-data.json, node_modules/, file QA sinh ra trong tests/
└── README.md               file này
```

Thứ tự nạp script trong `index.html`: `js/config.js` → `js/data.js` → `js/app.js`. Không ES module, không build.

---

## 6. Dữ liệu

### Tab `CheckIn` – mỗi lượt một dòng
Script tự tạo hàng tiêu đề (nền `#E3EAF3`, chữ navy, đóng băng hàng 1) khi tab trống.

| Cột | Tiêu đề | Trường gửi lên | Ghi chú |
|---|---|---|---|
| A | Thời gian | `created_at` | `HH:mm:ss dd/MM/yyyy`, giờ máy điện thoại. Client gửi rỗng hoặc sai khuôn thì script điền giờ server theo `Asia/Ho_Chi_Minh`. |
| B | Mã nhân viên | `employeeId` | Script chuẩn hóa lại (bỏ ký tự không phải chữ/số, viết hoa). Luôn có, kể cả khi không tìm thấy tên. |
| C | Tên | `name` | **Script tra từ `DanhSach` theo mã; tên client gửi bị bỏ qua.** Rỗng nếu không tìm thấy. |
| D | Mức (1–10) | `level` | Số nguyên 1..10. Khác → từ chối `level_invalid`. |
| E | Mức chữ | `levelText` | "Rất mệt" … "Rất tốt". **Script suy từ cột D; chuỗi client gửi bị bỏ qua.** |
| F | Cảm xúc Capybara | `emotion` | Chỉ nhận đúng một trong 6 nhãn: Vui vẻ · Buồn · Lo lắng · Tức giận · Hoảng hốt · Khó chịu. Rỗng → `emotion_required`; khác → `emotion_invalid`. |
| G | Mã phiên | `sessionId` | **Cột kỹ thuật, script tự ẩn.** Khóa chống dòng đôi: cùng `sessionId` thì cập nhật dòng cũ. Không xóa cột này. |

Muốn xem cột G: chọn cột F và H → chuột phải → **Hiện cột** (Unhide).

### Tab `DanhSach` – app chỉ đọc
| Cột | Tiêu đề | Ghi chú |
|---|---|---|
| A | Mã | Nên định dạng Văn bản thuần trước khi nhập (mục 1, bước 2). So khớp sau khi chuẩn hóa cả hai phía; ô lỡ thành kiểu số vẫn khớp (kể cả mã có số 0 đầu); ô bị đổi thành ngày thì bỏ qua. |
| B | Tên | Tên hiển thị đầy đủ. Mã trùng nhiều dòng thì lấy dòng đầu tiên; dòng có mã mà tên trống thì bỏ qua. |

Không có API nào trả toàn bộ tab này. `?action=lookup` chỉ trả **một** tên cho **một** mã.

### Ai xem được
- Sheet: chỉ tài khoản `bsngvanthong@gmail.com` và những ai anh Thông chia sẻ thêm.
- Đường link script: `?action=lookup&id=…` ai cũng gọi được (app cần vậy), mỗi lần chỉ ra một tên khi biết đúng mã. Mã 4 chữ số thì có thể bị quét hết 10.000 mã để ghép bảng mã → tên; xem mục 8, việc 10. `GET` không `action` đang **tắt** (`ALLOW_PUBLIC_READ = false`), nên không ai đọc được tab `CheckIn` qua link.
- Trên điện thoại: `localStorage` chỉ giữ hàng chờ các lượt **chưa lên Sheet** (tối đa 20), bình thường rỗng; lượt gửi thành công bị xóa ngay. Không hiển thị ở đâu trong app. Điện thoại trực dùng chung thì xóa dữ liệu trang web của trình duyệt khi cần.

Dữ liệu **có định danh** (mã, tên). Trang ghi ngay trên nút hoàn thành: "Dữ liệu dùng để chăm sóc nhân viên, chỉ người phụ trách xem." Câu này phải đúng với thực tế chia sẻ Sheet (mục 8).

---

## 7. Đặc tả → đã làm

Theo 4 story P0 trong PRD. Kết quả kiểm thử chi tiết của QA nằm ở `docs/qa/` khi có.

| Story | Đặc tả | Đã làm |
|---|---|---|
| **US-1** Mã số và lời chào | Ô mã, bàn phím số, không autofocus. Đủ ký tự hoặc rời ô → dò `?action=lookup`. Tìm thấy → "Xin chào anh/chị {Tên}"; không thấy → câu mềm + lời chào chung, vẫn cho tiếp tục. Đang dò "Đang tìm…". Mất mạng chỉ `console.warn`. Sửa mã → xóa chào cũ, dò lại. | `#employee-id` với `inputmode` theo `ID_NUMERIC`, `maxlength` theo `ID_MAX_LENGTH`, không autofocus; debounce 400 ms + dò khi `blur`; `AbortController` 1500 ms; fallback JSONP khi `fetch` ném `TypeError`; `seq` bỏ response cũ; tên qua `esc()`; `Enter` đóng bàn phím và dò; ô mã select-all khi focus (điện thoại dùng chung). |
| **US-2** Thanh trượt và thẻ | Thanh 1–10 mặc định 5, capybara đổi mặt theo 10 ảnh, nhãn "{n} · {chữ}". Lưới 6 thẻ chọn 1, viền navy + dấu tick, `aria-pressed`, rung nhẹ. Lỗi ảnh → emoji. Bàn phím chọn được. `prefers-reduced-motion`. | `#level-range` + `aria-valuetext`; `#level-img` đổi `src` theo mức; 6 thẻ render từ `APP_DATA.EMOTIONS`, `button.capy-card[data-act="pick"]`; `navigator.vibrate(20)`; mọi `<img>` có `data-fallback`, lỗi ảnh thay bằng `<span>` emoji cùng cỡ; tick và đập nhịp tắt khi reduce-motion. |
| **US-3** Hoàn thành và cám ơn | Nút mờ cho tới khi có mã và đã chọn thẻ; hint 3 trạng thái, ưu tiên nhắc mã. Bấm → lưu `localStorage`, `fetch` không chờ, sang trang cám ơn < 300 ms. Tick xanh vẽ dần, "Cám ơn anh/chị", tóm tắt "{Tên hoặc mã} · Mức {n} · {chữ} · {Cảm xúc}". "Check-in cho ca khác" về mặc định, giữ ô mã, `sessionId` mới. Bấm đúp → một dòng. | `checkFormCompletion()` đặt `.need-id` / `.need-card` / `.done` và `disabled`; `submit()` khóa `state.submitting`, `saveBackup()` (try/catch, tối đa 20), `fetch` POST `text/plain` + `keepalive`, không `await`; server trả `success` → `removeBackup()`; mở trang → `resendPending()` gửi lại lượt còn trong hàng chờ; `showThanks()`; `again()` tạo `sessionId` mới, giữ ô mã và lời chào; script upsert theo cột G. Không `alert`, không `onclick` inline. |
| **US-4** Dữ liệu và minh bạch | Mỗi lượt một dòng, 6 cột đúng thứ tự PRD, Sheet trống tự tạo tiêu đề. Không tìm thấy → Tên rỗng, Mã vẫn ghi. Dòng minh bạch trên nút; chân trang "Tự đánh giá, không phải thang chẩn đoán." `config.js` không có mã, tên, secret. `doGet` không lộ `DanhSach`. | 7 cột (6 PRD + cột G ẩn); `ensureHeader_` tô navy, `setFrozenRows(1)`, `hideColumns(7)`; `validateCheckin_` (level số nguyên 1..10, `levelText` suy từ level, emotion thuộc đúng 6 nhãn, sessionId 8–40 ký tự chữ/số/gạch nối, chuẩn hóa mã, `created_at` đúng khuôn hoặc giờ server, tên tra từ `DanhSach` và cắt 80 ký tự); `safeText_` thêm `'` trước chuỗi bắt đầu bằng `= + - @`; `LockService` 5 s; dòng minh bạch và chân trang đúng nguyên văn PRD A.5; `GET` không action trả `public_read_disabled`; `lookup` chỉ trả một tên. |

P1 đã làm: tự gửi lại hàng chờ `localStorage` khi mở trang (tech design 5.5). P1 chưa làm: US-5 trang tổng hợp, US-6 nhớ mã trên máy, US-7 QR (việc triển khai, không phải code). Xem mục 8.

---

## 8. Chưa làm / cần làm trước khi dùng thật

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| 1 | **Nhập tab `DanhSach`** (cột A Mã, cột B Tên) | anh Thông / người phụ trách | Chưa nhập thì mọi người nhận lời chào chung và cột Tên trống. Mã gõ số thường. |
| 2 | **Deploy Apps Script và dán URL `/exec` vào `js/config.js`** | anh Thông → đội | Mục 1. Đang để `''`, app chạy nhưng không ghi gì. |
| 3 | **Chuyển ảnh capybara về `assets/`**: tải 16 file (`capy-level-01.png` … `capy-level-10.png`, `vui.jpg`, `buon.jpg`, `khoc.jpg`, `tuc.jpg`, `hoang_hot.jpg`, `kho_chiu.jpg`) từ repo `nhatkymebau`, nén còn **≤ 150 KB/ảnh**, bỏ vào `apps/checkin-vao-ca/assets/`, đổi `ASSET_BASE: 'assets/'` và `href` preload trong `index.html` | đội | Hiện ảnh tải từ repo `nhatkymebau`, mỗi ảnh 1–1,7 MB, mạng bệnh viện yếu sẽ chậm. Chưa làm được thì dùng tạm việc 11. |
| 4 | **Quyết định ai xem Sheet.** Nếu chia sẻ cho nhiều người thì sửa dòng minh bạch trong `index.html` cho đúng ("chỉ người phụ trách xem" → ghi đúng ai). | anh Thông | PRD câu hỏi mở 3. |
| 5 | Trang tổng hợp (US-5, P1): bật `ALLOW_PUBLIC_READ = true` trong script **kèm** kiểm tra `&token=` so với giá trị trong Script Properties, rồi làm trang đọc `doGet`. | đội, sau khi anh quyết | Không bật `ALLOW_PUBLIC_READ` mà không có token: tab `CheckIn` có mã và tên, ai có URL cũng đọc được. |
| 6 | Nhớ mã trên máy (US-6, P1) | đội, sau khi anh quyết | Đang tắt vì điện thoại trực dùng chung. |
| 7 | Thử trên **Safari iOS**, **Chrome Android** và **WebView Zalo** với URL script thật: dò tên, gửi, trang cám ơn. | QA / anh Thông | Rủi ro R1 tech design: vài WebView chặn redirect của Apps Script; app có fallback JSONP nhưng cần thử thật. |
| 8 | Node để chạy `tools/mock-api.js` và `tests\run-all.cmd`: dùng bản portable `C:\Users\SF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` (mục 2.2, 2.3) hoặc cài `winget install OpenJS.NodeJS.LTS`. | ai sửa code | Không bắt buộc để dùng app. |
| 9 | Chụp ảnh màn hình sau khi deploy, dán vào README. | đội | |
| 10 | **Dò tên không xác thực.** `?action=lookup&id=…` ai cũng gọi được. Mã 4 chữ số thì chỉ có 10.000 khả năng; một script có thể quét hết trong vài giờ và lấy được bảng mã → tên của cả danh sách. Hai cách giảm nhẹ: (a) nếu mã thật dài ≥ 6 ký tự, đặt `ID_MIN_LENGTH` trong `config.js` bằng đúng độ dài mã thật (client không dò mã ngắn hơn; script vẫn trả lời mã ngắn nên chỉ giảm một phần); (b) chấp nhận rủi ro vì dữ liệu lộ chỉ là mã và tên, không có nội dung check-in. Chặn triệt để cần token hoặc đăng nhập, ngược với yêu cầu "không đăng nhập" của PRD. | **anh Thông quyết** | Code-reviewer nêu. Chưa đổi gì trong code. |
| 11 | Tùy chọn đổi `ASSET_BASE` sang CDN jsDelivr để ảnh capybara tải nhanh hơn khi chưa làm việc 3: `ASSET_BASE: 'https://cdn.jsdelivr.net/gh/ditruyenhungvuong/nhatkymebau@main/'` trong `config.js` **và** `href` của `<link rel="preload">` trong `index.html` (đổi `https://raw.githubusercontent.com/ditruyenhungvuong/nhatkymebau/main/` thành URL CDN). Ảnh vẫn nặng 1–1,7 MB, chỉ nhanh hơn nhờ CDN và cache 7 ngày. | anh Thông quyết → đội | Gợi ý ghi sẵn trong comment `config.js`. Chưa kiểm chứng URL CDN. |
| 12 | Múi giờ dự án Apps Script: trong editor, bánh răng **Cài đặt dự án** (Project Settings) → múi giờ **(GMT+07:00) Hồ Chí Minh**. | anh Thông, chỉ để biết | Script đã tự dùng `Asia/Ho_Chi_Minh` (`TIME_ZONE`) khi điền giờ, nên không đặt cũng không sai giờ. Đặt cho khớp để log và trigger sau này cùng múi giờ. |

---

## 9. Ghi chú kỹ thuật

- **Gửi lạc quan + hàng chờ `localStorage`.** Bấm "Hoàn thành check-in": app ghi bản ghi vào hàng chờ `localStorage` trước (`saveBackup`), `fetch` POST không chờ, sang trang cám ơn ngay. Server trả `result: 'success'` → xóa bản ghi khỏi hàng chờ (`removeBackup`); bình thường `localStorage` rỗng. Mạng lỗi hoặc server từ chối (ví dụ `emotion_invalid`) → giữ lại, chỉ `console.warn`, người dùng không thấy lỗi. **Lần mở trang sau, `resendPending()` tự gửi lại** tối đa 5 bản mới nhất, im lặng, không chờ; an toàn nhờ script upsert theo `sessionId` nên không sinh dòng đôi. Không gửi lại khi `GOOGLE_SCRIPT_URL` trống hoặc `navigator.onLine === false`. Bản ghi `sent: true` của phiên bản cũ bị dọn khi gặp.
- **Server kiểm nghiêm ngặt dữ liệu vào** (`validateCheckin_`, mock làm y hệt): `level` phải là số nguyên 1..10; `levelText` suy từ `level`, bỏ chuỗi client gửi; `emotion` phải là đúng một trong 6 nhãn `EMOTION_LABELS`; `sessionId` 8–40 ký tự chữ/số/gạch nối; mã chuẩn hóa lại; `created_at` sai khuôn thì lấy giờ server; `name` tra từ `DanhSach`, bỏ tên client gửi. Lớp hai: `safeText_` thêm dấu `'` trước mọi chuỗi bắt đầu bằng `=`, `+`, `-`, `@`, tab, CR. Lý do: URL script là public, ai cũng POST được; không chặn thì một chuỗi bắt đầu bằng `=` ghi vào ô sẽ thành công thức Sheets (formula injection) và chạy khi anh Thông mở Sheet.
- **Chống dòng đôi bằng Mã phiên.** Mỗi lần tải trang và mỗi lần "Check-in cho ca khác" tạo một `sessionId` mới (`crypto.randomUUID`, fallback `Date.now` + random). Script tìm `sessionId` ở cột G: có thì cập nhật dòng cũ, không thì thêm dòng. Lớp 1 phía client: `state.submitting` + `disabled` ngay trong handler.
- **Dò tên.** `GET ?action=lookup&id=…` với `AbortController` 1500 ms. `fetch` ném `TypeError` trước khi hết giờ (dấu hiệu CORS/redirect bị chặn) và máy đang online → chèn `<script>` JSONP `&callback=`. Hết giờ hay lỗi → coi như không tìm thấy, vẫn cho check-in. Lúc tải trang app gọi `?action=ping` để đánh thức Apps Script.
- **Chuẩn hóa mã** giống hệt ở client và script: `trim` → bỏ ký tự không phải `0-9A-Za-z` → viết hoa. `' 12-34 '` → `'1234'`; `'ab12'` → `'AB12'`; số full-width → rỗng (không khớp).
- **`Content-Type: text/plain`** khi POST để Apps Script không cần preflight CORS. `keepalive: true` để đóng tab ngay vẫn gửi.
- **Giờ ghi** là giờ máy điện thoại. Muốn dùng giờ server: cho client gửi `created_at` rỗng, script tự điền `formatDate_(new Date())` theo `TIME_ZONE = 'Asia/Ho_Chi_Minh'`.
- **Không giọng đọc máy** (Web Speech), không `alert()`, không `onclick` inline, mọi chuỗi từ server và input vào HTML qua `esc()`.
- Tokens màu: `docs/style/design-tokens-navy.css` (navy `#1F3A5F` làm màu chính, nền kem, xanh lá chỉ cho tick và hint "đủ").
