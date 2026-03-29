$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$frontendPort = 5173
$backendPort = 3001
$frontendUrl = "http://localhost:$frontendPort"
$backendUrl = "http://localhost:$backendPort"

function Test-PortListening {
  param(
    [int]$Port
  )

  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Wait-PortListening {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortListening -Port $Port) {
      return $true
    }

    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Start-ServiceWindow {
  param(
    [string]$Title,
    [string]$Command
  )

  Start-Process -FilePath 'powershell' `
    -WorkingDirectory $root `
    -ArgumentList @(
      '-NoExit',
      '-NoLogo',
      '-NoProfile',
      '-Command',
      "& { `$Host.UI.RawUI.WindowTitle = '$Title'; $Command }"
    ) | Out-Null
}

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  Financial Report Launcher' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

if (Test-PortListening -Port $backendPort) {
  Write-Host "[OK] Backend already running: $backendUrl" -ForegroundColor Green
} else {
  Write-Host "[1/2] Starting backend on port $backendPort..." -ForegroundColor Yellow
  Start-ServiceWindow -Title 'Financial Report Backend' -Command 'npm run dev --prefix server'

  if (Wait-PortListening -Port $backendPort) {
    Write-Host "[OK] Backend started: $backendUrl" -ForegroundColor Green
  } else {
    Write-Host "[WARN] Backend did not confirm in time. Check the backend window if needed." -ForegroundColor Yellow
  }
}

if (Test-PortListening -Port $frontendPort) {
  Write-Host "[OK] Frontend already running: $frontendUrl" -ForegroundColor Green
} else {
  Write-Host "[2/2] Starting frontend on port $frontendPort..." -ForegroundColor Yellow
  Start-ServiceWindow -Title 'Financial Report Frontend' -Command 'npm run dev --prefix client -- --host 0.0.0.0'

  if (Wait-PortListening -Port $frontendPort) {
    Write-Host "[OK] Frontend started: $frontendUrl" -ForegroundColor Green
  } else {
    Write-Host "[WARN] Frontend did not confirm in time. Check the frontend window if needed." -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host "Frontend: $frontendUrl"
Write-Host "Backend:  $backendUrl"
Write-Host ''

Start-Process $frontendUrl | Out-Null
