@echo off
chcp 65001 >nul
title Logs en Direct - Pipeline Telegram -^> Drive
powershell -NoExit -Command "$host.ui.RawUI.WindowTitle = 'Logs en Direct - Pipeline Telegram -> Drive'; $log = 'C:\Users\starl\.gemini\antigravity\brain\0924a661-b3ca-4bab-8d20-44f72cb8db48\.system_generated\tasks\task-1687.log'; if (Test-Path $log) { Get-Content -Path $log -Wait -Tail 50 } else { Write-Host 'Le fichier de log est introuvable.' }"
