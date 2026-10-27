@echo off
rem =========================================================
rem  Chạy toàn bộ test QA của app Check-in khi vào ca.
rem  Máy không có Node trong PATH thì đặt biến NODE trỏ tới node.exe, ví dụ:
rem    set NODE=C:\Users\SF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
rem    tests\run-all.cmd
rem  Cần Chrome tại C:\Program Files\Google\Chrome\Application\chrome.exe (hoặc đặt CHROME=...).
rem  Kết quả E2E, screenshot, console log ghi vào %TEMP%\checkin-vao-ca-qa\ (hoặc --out=...).
rem  Không sửa file nào của app; js/config.js phải đang để GOOGLE_SCRIPT_URL: ''.
rem =========================================================
setlocal
cd /d "%~dp0\.."
if "%NODE%"=="" set NODE=node
set FAIL=0

echo === 1/4 Rà tĩnh (cú pháp, microcopy, giọng, config) ===
"%NODE%" tests\check-static.js || set FAIL=1

echo.
echo === 2/4 Contract tools\mock-api.js ===
"%NODE%" tests\test-mock-api.js || set FAIL=1

echo.
echo === 3/4 google_apps_script.js (giả lập SpreadsheetApp) ===
"%NODE%" tests\test-gas.js || set FAIL=1

echo.
echo === 4/4 E2E Chrome headless (7 kịch bản) ===
"%NODE%" tests\e2e.js %* || set FAIL=1

rem Dọn: mock của repo không được chạy trong thư mục app, nhưng xóa cho chắc
if exist tools\mock-data.json del /q tools\mock-data.json

echo.
if "%FAIL%"=="1" (echo KET QUA: CO TEST DO & exit /b 1) else (echo KET QUA: TAT CA XANH & exit /b 0)
