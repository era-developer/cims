# CIMS Launcher: builds frontend, starts backend (single-port mode on 5000),
# then opens an ngrok tunnel to it and prints the public URL.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ngrokExe = "$env:APPDATA\npm\node_modules\ngrok\bin\ngrok.exe"

if (-not (Test-Path $ngrokExe)) {
    Write-Host "ngrok.exe not found at $ngrokExe - run 'npm install -g ngrok' first." -ForegroundColor Red
    exit 1
}

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " CIMS + ngrok - one-step launcher" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# The backend now runs under PM2 (auto-restarts it if it ever crashes or
# gets killed -- see ecosystem.config.js). Killing whatever's on port 5000
# and spawning a raw, unmanaged `node server.js` here would silently step
# outside PM2's tracking every time this script runs. Go through PM2
# instead: start it if it's not already running, or cleanly restart it
# (picking up any code changes) if it is.
Write-Host "`n[1/3] Building frontend..." -ForegroundColor Green
Push-Location "$root\frontend"
npm run build
Pop-Location

Write-Host "`n[2/3] Starting backend on port 5000 (via PM2)..." -ForegroundColor Green
Push-Location "$root\backend"
$pm2Status = pm2 jlist | ConvertFrom-Json | Where-Object { $_.name -eq "cims-backend" }
if ($pm2Status) {
    pm2 restart cims-backend
} else {
    pm2 start ecosystem.config.js
}
pm2 save
Pop-Location

# Wait for the backend health endpoint to respond
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        Invoke-RestMethod -Uri "http://localhost:5000/api/health" -TimeoutSec 2 | Out-Null
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}
if (-not $ready) {
    Write-Host "Backend did not become ready in time. Check 'pm2 logs cims-backend' for errors." -ForegroundColor Red
    exit 1
}
Write-Host "      Backend is up under PM2." -ForegroundColor Green

Write-Host "`n[3/3] Starting ngrok tunnel to port 5000..." -ForegroundColor Green
$ngrok = Start-Process -FilePath $ngrokExe -ArgumentList "http", "5000", "--log=stdout" -PassThru -WindowStyle Minimized

# Ask ngrok's local API for the public URL
$publicUrl = $null
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try {
        $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 2
        $https = $tunnels.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1
        if ($https) { $publicUrl = $https.public_url; break }
    } catch { }
}

Write-Host "`n=================================================" -ForegroundColor Cyan
if ($publicUrl) {
    Write-Host " CIMS is live!" -ForegroundColor Cyan
    Write-Host " Local:  http://localhost:5000"
    Write-Host " Public: $publicUrl" -ForegroundColor Yellow
    Set-Clipboard -Value $publicUrl
    Write-Host " (public URL copied to clipboard)"
} else {
    Write-Host " Backend is up but the ngrok URL couldn't be read." -ForegroundColor Red
    Write-Host " Check http://127.0.0.1:4040 in a browser for tunnel status."
}
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "`nBackend: managed by PM2 (see 'pm2 status')   ngrok PID: $($ngrok.Id)"
Write-Host "Press Ctrl+C in this window, or close it, to leave both running in the background."
Write-Host "To stop the tunnel: Stop-Process -Id $($ngrok.Id) -Force"
Write-Host "To stop the backend: pm2 stop cims-backend  (do NOT use Stop-Process on it -- PM2 will just restart it)`n"
