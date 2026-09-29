@echo off
chcp 65001 >nul
title Archiving Helper
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is required but was not found in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

node "%~dp0src\cli\menu.mjs" %*
