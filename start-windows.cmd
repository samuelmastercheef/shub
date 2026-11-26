@echo off
rem S Hub - Socin cho Windows. Bam dup file nay de chay.
cd /d "%~dp0"
where node >nul 2>nul || (echo Chua cai Node.js. Cai bang: winget install OpenJS.NodeJS.LTS & pause & exit /b 1)
if not exist config.json copy config.example.json config.json >nul
start "" /b powershell -NoProfile -Command "Start-Sleep 2; Start-Process http://127.0.0.1:4777"
node server.js
pause
