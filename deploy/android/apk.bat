@echo off
setlocal EnableExtensions
REM Always run from repo root. This file lives in deploy\android\.
REM Two cd steps: trailing slash + parentheses in "potion-main (1)" are OK.
cd /d "%~dp0."
cd /d "..\.."
if not exist "package.json" goto :noroots
if not exist "scripts\pack-android.mjs" goto :noroots

where node >nul 2>nul
if errorlevel 1 goto :nonode

echo Potion - Android APK (Tauri)
echo Same WebView app as the desktop window. Not a PWA.
echo.
echo One-click solo build from a fresh GitHub unzip:
echo   - npm install if node_modules is missing
echo   - JDK 17 (Microsoft or Temurin, not Studio JBR / JDK 25)
echo   - Android Studio SDK + NDK
echo   - Rust + aarch64-linux-android target (added if missing)
echo   - If Windows symlinks fail: copies .so + assets, Gradle -x rustBuild
echo First run can take a while. Leave this window open.
echo.
echo Working directory:
echo   %CD%
echo.

node scripts\pack-android.mjs
if errorlevel 1 goto :fail

echo.
echo === SUCCESS ===
echo APK folder:
echo   %CD%\deploy\android\
set "FOUND_VERSIONED=0"
for %%F in ("deploy\android\potion-v*-arm64-release.apk") do (
  if exist "%%~F" (
    set "FOUND_VERSIONED=1"
    echo   Versioned: %%~nxF
    echo     full:    %%~fF
    echo     size:    %%~zF bytes
  )
)
if "%FOUND_VERSIONED%"=="0" (
  echo   WARNING: no potion-v*-arm64-release.apk found
)
if exist "deploy\android\potion-arm64-release.apk" (
  echo   Friendly:  potion-arm64-release.apk
  for %%F in ("deploy\android\potion-arm64-release.apk") do echo     size:    %%~zF bytes
)
echo.
start "" explorer "%CD%\deploy\android"
pause
exit /b 0

:noroots
echo ERROR: Could not find the Potion repo root.
echo Unzip the GitHub download and double-click apk.bat at the repo root,
echo or deploy\android\apk.bat inside that folder.
pause
exit /b 1

:nonode
echo Node.js 22+ is required.
start https://nodejs.org
pause
exit /b 1

:fail
echo.
echo Build failed. Check the message above.
echo Common fixes:
echo   - Install Microsoft OpenJDK 17 or Eclipse Temurin 17 (not Android Studio JBR)
echo   - Android Studio SDK + NDK
echo   - Run desktop-setup.bat once for Rust
echo See deploy\android\README.md
pause
exit /b 1
