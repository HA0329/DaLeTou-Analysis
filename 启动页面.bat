@echo off
rem 大乐透分析 - 启动器：本地服务器 + 自动打开浏览器
rem 注意：必须用本文件打开页面，「在线更新」才能工作
cd /d "%~dp0"
start "" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8123/"
