@echo off
setlocal EnableExtensions
REM Fresh GitHub zip may be "potion-main (1)". "%~dp0." handles
REM spaces, parentheses, and the trailing-backslash quote trap.
cd /d "%~dp0."
if not exist "package.json" goto :noroots
if not exist "scripts\deploy.mjs" goto :noroots

where node >nul 2>nul
if errorlevel 1 goto :nonode

echo Building Potion Windows installers...
echo Leave this window open. First build can take a long time.
echo When it finishes, install the NSIS setup on this PC or another.
echo Folders with parentheses (GitHub " (1)" unzip) are OK.
echo.
node "%~dp0scripts\deploy.mjs"
if errorlevel 1 goto :fail
echo.
echo Done. Install the NSIS setup from:
echo   src-tauri\target\release\bundle\nsis\
pause
exit /b 0

:noroots
echo ERROR: This is not the Potion folder.
echo Unzip the GitHub download so deploy.bat sits next to package.json,
echo then double-click deploy.bat.
pause
exit /b 1

:nonode
echo.
echo Node.js 22 or newer is required.
echo Opening https://nodejs.org - install the LTS, then double-click this file again.
echo.
start https://nodejs.org
pause
exit /b 1

:fail
echo.
echo Build failed. Read the message above.
echo Need once: Node 22, Visual Studio Build Tools (Desktop development with C++),
echo and Rust (this script can install Rust).
pause
exit /b 1
