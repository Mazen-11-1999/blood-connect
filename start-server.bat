@echo off
cd /d "%~dp0"
echo Starting server in: %CD%
python -m http.server 8000
pause





