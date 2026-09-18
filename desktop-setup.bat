@echo off
setlocal EnableExtensions
cd /d "%~dp0."
if not exist "package.json" goto :noroots
if not exist "scripts\desktop-setup.mjs" goto :noroots

where node >nul 2>nul
if errorlevel 1 goto :nonode

echo Running Potion desktop setup...
echo This can install Rust and opens the app window.
echo.
node "%~dp0scripts\desktop-setup.mjs" --run
if errorlevel 1 goto :fail
echo.
pause
exit /b 0

:noroots
echo ERROR: This is not the Potion folder.
echo Unzip the GitHub download so desktop-setup.bat sits next to package.json.
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
echo Setup failed. Read the message above.
pause
exit /b 1
