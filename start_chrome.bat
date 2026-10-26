@echo off
setlocal
echo ========================================================
echo   Launching Google Chrome with Remote Debugging (9222)  
echo ========================================================

node scripts\start_chrome.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    pause
)
