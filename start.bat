@echo off
chcp 65001 >nul 2>&1
set "ROOT=%~dp0"
title Financial Report Launcher

powershell -ExecutionPolicy Bypass -NoLogo -NoProfile -File "%ROOT%scripts\start-dev.ps1"
