@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "PORT=8712"

echo.
echo   ================================================
echo     图表工作台 - 12 种图表 / 一个页面 / 互不切换
echo   ================================================
echo.
echo     打开          http://127.0.0.1:%PORT%/
echo.
echo     数据目录: charts\*.chart.json  -  WorkBuddy 可直接读写
echo   ================================================
echo.

rem ---------- 1) 端口占用检查 ----------
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto ALREADY

rem ---------- 2) 定位 Python ----------
set "PY="

rem 2.1 WorkBuddy 托管 Python, 自动匹配任意版本
for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\python\versions\*") do (
  if exist "%%d\python.exe" if not defined PY set "PY=%%d\python.exe"
)

rem 2.2 系统安装的 Python
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not defined PY if exist "C:/Python313/python.exe" set "PY=C:/Python313/python.exe"
if not defined PY if exist "C:/Python312/python.exe" set "PY=C:/Python312/python.exe"

rem 2.3 PATH 里的 python, 排除微软商店的假别名
if not defined PY (
  for /f "delims=" %%i in ('where python 2^>nul') do (
    echo %%i | findstr /i "WindowsApps" >nul
    if errorlevel 1 if not defined PY set "PY=%%i"
  )
)

if not defined PY goto NOPY

echo   使用 Python: %PY%
echo   服务地址:   http://127.0.0.1:%PORT%/
echo   关闭本窗口即可停止服务。
echo.

rem ---------- 3) 后台启动服务, 稍等后打开浏览器 ----------
start "chart-studio-server" /b "%PY%" server.py --port %PORT%
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/"

echo   服务已启动。最小化本窗口即可; 要停止请关闭本窗口。
echo.
pause
goto :EOF

:ALREADY
echo   [提示] 端口 %PORT% 已被占用, 服务可能已经在运行。
echo          直接访问 http://127.0.0.1:%PORT%/ 即可。
echo.
start "" "http://127.0.0.1:%PORT%/"
pause
goto :EOF

:NOPY
echo   [错误] 没有找到可用的 Python。
echo.
echo   解决办法:
echo     1. 安装 Python 3.9+ : https://www.python.org/downloads/
echo     2. 或者编辑本文件, 在开头加一行:
echo        set "PY=C:/你的路径/python.exe"
echo.
pause
exit /b 1
