@echo off
REM Convenience launcher at repo root - delegates to deploy\android\apk.bat
call "%~dp0deploy\android\apk.bat"
exit /b %ERRORLEVEL%
