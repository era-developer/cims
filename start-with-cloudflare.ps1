# CIMS Launcher: builds frontend, starts backend (single-port mode on 5000),
# then opens a Cloudflare quick tunnel to it and prints the public URL.
# Unlike ngrok's free tier, Cloudflare Tunnel shows no browser warning page.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$cloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

if (-not (Test-Path $cloudflaredExe)) {
    Write-Host "cloudflared.exe not found at $cloudflaredExe - run 'winget install --id Cloudflare.cloudflared' first." -ForegroundColor Red
    exit 1
}

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " CIMS + Cloudflare Tunnel - one-step launcher" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# The backend now runs under PM2 (auto-restarts it if it ever crashes or
# gets killed -- see ecosystem.config.js). Killing whatever's on port 5000
# and spawning a raw, unmanaged `node server.js` here would silently step
# outside PM2's tracking every time this script runs. Go through PM2
# instead: start it if it's not already running, or cleanly restart it
# (picking up any code changes) if it is.
Write-Host "`n[1/3] Building frontend..." -ForegroundColor Green
# This project folder is synced by Google Drive Desktop, which keeps
# re-injecting desktop.ini metadata files into node_modules -- one of them
# lands in eslint-plugin-jest's rules folder, whose auto-loader naively
# requires every file it finds there, crashes on desktop.ini, and takes
# down CRA's ESLint gate ("Environment key jest/globals is unknown").
# Strip them right before every build so a fresh Drive sync can't reintroduce
# the failure.
Get-ChildItem "$root\frontend\node_modules" -Filter "desktop.ini" -Recurse -Force -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

Push-Location "$root\frontend"
npm run build
$buildExitCode = $LASTEXITCODE
Pop-Location

# CRA empties the build/ output dir before compiling, so a failed build
# doesn't just leave the old build in place -- it deletes it. Restarting the
# backend / exposing the tunnel after that would silently publish the
# "Setup Required" fallback page instead of the app, so bail out here.
if ($buildExitCode -ne 0 -or -not (Test-Path "$root\frontend\build\index.html")) {
    Write-Host "`nFrontend build failed -- aborting before touching the backend or tunnel." -ForegroundColor Red
    Write-Host "See the npm output above for the error." -ForegroundColor Red
    exit 1
}

Write-Host "`n[2/3] Starting backend on port 5000 (via PM2)..." -ForegroundColor Green
Push-Location "$root\backend"
# Avoid `pm2 jlist | ConvertFrom-Json`: PM2 embeds each process's full
# environment in that JSON, and on Windows the env block can contain both
# `username` and `USERNAME`, which collide once PowerShell's JSON parser
# folds them into a case-insensitive object (DuplicateKeysInJsonString).
# `pm2 id` sidesteps the env dump entirely.
$pm2IdOutput = (pm2 id cims-backend | Out-String).Trim()
if ($pm2IdOutput -and $pm2IdOutput -ne "[]") {
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

Write-Host "`n[3/3] Starting Cloudflare tunnel to port 5000..." -ForegroundColor Green
$tunnelLogOut = Join-Path $env:TEMP "cims-cloudflared-out.log"
$tunnelLogErr = Join-Path $env:TEMP "cims-cloudflared-err.log"
$tunnelState = Join-Path $env:TEMP "cims-cloudflared-state.json"

# Quick tunnels (`cloudflared tunnel --url`) get handed a brand-new random
# *.trycloudflare.com hostname on every process start -- there's no way to
# pin that down without a named tunnel + owned domain. The next best thing:
# never spawn a second tunnel process while one is already alive, so
# re-running this script keeps the same public URL instead of rolling a new
# one every time. The URL only changes if the tunnel process itself dies
# (this script exits/machine reboots) and a new one has to be started.
$existingState = $null
if (Test-Path $tunnelState) {
    try { $existingState = Get-Content $tunnelState -Raw | ConvertFrom-Json } catch {}
}
$reused = $false
if ($existingState -and $existingState.ProcessId -and $existingState.Url) {
    $existingProc = Get-Process -Id $existingState.ProcessId -ErrorAction SilentlyContinue
    if ($existingProc -and $existingProc.ProcessName -eq 'cloudflared') {
        $publicUrl = $existingState.Url
        $cloudflared = $existingProc
        $reused = $true
        Write-Host "      Reusing already-running tunnel (PID $($existingProc.Id)) -- URL unchanged." -ForegroundColor Green
    }
}

if (-not $reused) {
    Remove-Item $tunnelLogOut, $tunnelLogErr -Force -ErrorAction SilentlyContinue
    $cloudflared = Start-Process -FilePath $cloudflaredExe -ArgumentList "tunnel", "--url", "http://localhost:5000" `
        -PassThru -WindowStyle Minimized -RedirectStandardOutput $tunnelLogOut -RedirectStandardError $tunnelLogErr

    # The quick-tunnel URL only appears in cloudflared's log output -- poll for it.
    $publicUrl = $null
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        foreach ($log in @($tunnelLogErr, $tunnelLogOut)) {
            if (Test-Path $log) {
                $match = Select-String -Path $log -Pattern "https://[a-zA-Z0-9\-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($match) { $publicUrl = $match.Matches[0].Value; break }
            }
        }
        if ($publicUrl) { break }
    }
    if ($publicUrl) {
        @{ ProcessId = $cloudflared.Id; Url = $publicUrl } | ConvertTo-Json | Set-Content $tunnelState
    }
}

Write-Host "`n=================================================" -ForegroundColor Cyan
if ($publicUrl) {
    Write-Host " CIMS is live!" -ForegroundColor Cyan
    Write-Host " Local:  http://localhost:5000"
    Write-Host " Public: $publicUrl" -ForegroundColor Yellow
    # Set-Clipboard needs an interactive desktop/window station. Run it in a
    # job with a timeout so a non-interactive invocation (e.g. a scheduled
    # task or automation tool) can't hang here forever instead of exiting.
    $clipJob = Start-Job -ScriptBlock { param($u) Set-Clipboard -Value $u } -ArgumentList $publicUrl
    if (Wait-Job $clipJob -Timeout 3) {
        Write-Host " (public URL copied to clipboard, no warning page)"
    } else {
        Write-Host " (clipboard unavailable in this session - copy the URL above manually)"
    }
    Remove-Job $clipJob -Force -ErrorAction SilentlyContinue | Out-Null
} else {
    Write-Host " Backend is up but the tunnel URL couldn't be read yet." -ForegroundColor Red
    Write-Host " Check $tunnelLogErr for details."
}
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "`nBackend: managed by PM2 (see 'pm2 status')   cloudflared PID: $($cloudflared.Id)"
Write-Host "Press Ctrl+C in this window, or close it, to leave both running in the background."
Write-Host "To stop the tunnel: Stop-Process -Id $($cloudflared.Id) -Force"
Write-Host "To stop the backend: pm2 stop cims-backend  (do NOT use Stop-Process on it -- PM2 will just restart it)`n"
