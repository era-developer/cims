#Requires -RunAsAdministrator

# Installs CIMS (Comedkares Innovation Hub) as a Windows service via NSSM.
#
# The app directory is taken from where this script lives, so the same folder
# can be copied to any machine (D:\cims on the dev PC, wherever it lands on the
# server) and installed without editing paths.
#
# If the machine also runs KIMS (Kalam Pragati, port 5001, service "KIMS"),
# nothing below touches it: service name, directory, port, logs and database
# are all CIMS's own.
#
# Run from an elevated PowerShell:  .\install-cims-service.ps1

$ErrorActionPreference = 'Stop'

$serviceName = 'CIMS'
$appDir = Join-Path $PSScriptRoot 'backend'
$port = 5000

# NSSM ships in this repo under nssm-2.24\; fall back to a system install.
$nssmCandidates = @(
  (Join-Path $PSScriptRoot 'nssm-2.24\win64\nssm.exe'),
  (Join-Path $PSScriptRoot 'nssm-2.24\win32\nssm.exe'),
  'C:\nssm\nssm.exe'
)
$nssm = $nssmCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $nssm) { throw "nssm.exe not found. Looked in: $($nssmCandidates -join ', ')" }

$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { throw "node.exe not found at $node" }
if (-not (Test-Path $appDir)) { throw "App directory not found: $appDir" }
if (-not (Test-Path (Join-Path $appDir '.env'))) { throw "backend\.env is missing in $appDir -- copy it from the previous install before installing the service." }
if (-not (Test-Path (Join-Path $PSScriptRoot 'frontend\build\index.html'))) {
  Write-Warning "frontend\build\index.html not found. Run 'npm run build' in frontend\ first, or the portal will show the 'setup required' page."
}

# Read PORT from .env so the health check below matches whatever is configured.
$envPort = (Get-Content (Join-Path $appDir '.env') | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)' } | ForEach-Object { $Matches[1] } | Select-Object -First 1)
if ($envPort) { $port = [int]$envPort }

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output "Service '$serviceName' already exists; stopping and removing it first."
  if ($existing.Status -eq 'Running') { Stop-Service $serviceName -Force }
  & $nssm remove $serviceName confirm
  Start-Sleep -Seconds 3
}

# A PM2-managed or hand-started `node server.js` left on the port would make
# the service fail to bind. Stop it first (pm2 stop cims-backend).
$inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($inUse) {
  $owner = ($inUse | Select-Object -First 1).OwningProcess
  throw "Port $port is already in use by PID $owner. Stop it before installing the service (pm2 stop cims-backend, or end the node process)."
}

Write-Output "Installing $serviceName from $appDir on port $port..."

& $nssm install $serviceName $node 'server.js'
& $nssm set $serviceName AppDirectory $appDir
& $nssm set $serviceName AppStdout "$appDir\nssm-out.log"
& $nssm set $serviceName AppStderr "$appDir\nssm-err.log"
& $nssm set $serviceName AppExit Default Restart
& $nssm set $serviceName Start SERVICE_AUTO_START
& $nssm set $serviceName Description 'CIMS - Comedkares Innovation Hub Inventory Management System'

# PORT and the database path come from backend\.env; NSSM starts node with
# AppDirectory as the working directory, so dotenv picks that file up.

Start-Service $serviceName
Start-Sleep -Seconds 25
Get-Service $serviceName

Write-Output "`nChecking health endpoint..."
Invoke-WebRequest -Uri "http://localhost:$port/api/health" -UseBasicParsing |
  Select-Object -ExpandProperty Content

Write-Output "`nNext: register the nightly backup task with .\install-cims-backup-task.ps1"
