#Requires -RunAsAdministrator

# Installs KIMS (Kalam Pragati) as a Windows service via NSSM.
#
# This machine also runs CIMS (Comedkare) as a service named "CIMS" out of
# D:\cims\backend on port 5000. Everything below is deliberately distinct from
# that install -- service name, app directory, port, log files and database --
# so the two portals run side by side without touching each other.
#
# Run from an elevated PowerShell:  .\install-kims-service.ps1

$ErrorActionPreference = 'Stop'

$serviceName = 'KIMS'
$conflictingService = 'CIMS'
$appDir = 'D:\KIMS\backend'
$port = 5001

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

# Guard against clobbering the Comedkare service. Installing under the wrong
# name would take the live CIMS portal down, which must never happen.
if ($serviceName -eq $conflictingService) { throw "Refusing to install over the $conflictingService service." }

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output "Service '$serviceName' already exists; stopping and removing it first."
  if ($existing.Status -eq 'Running') { Stop-Service $serviceName -Force }
  & $nssm remove $serviceName confirm
  Start-Sleep -Seconds 3
}

# Warn if something is already on our port -- almost always a manually started
# `node server.js` left running from testing.
$inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($inUse) {
  $owner = ($inUse | Select-Object -First 1).OwningProcess
  throw "Port $port is already in use by PID $owner. Stop it before installing the service."
}

Write-Output "Installing $serviceName from $appDir on port $port..."

& $nssm install $serviceName $node 'server.js'
& $nssm set $serviceName AppDirectory $appDir
& $nssm set $serviceName AppStdout "$appDir\nssm-out.log"
& $nssm set $serviceName AppStderr "$appDir\nssm-err.log"
& $nssm set $serviceName AppExit Default Restart
& $nssm set $serviceName Start SERVICE_AUTO_START
& $nssm set $serviceName Description 'KIMS - Kalam Pragati Inventory Management System'

# PORT and the database path come from backend\.env; NSSM starts node with
# AppDirectory as the working directory, so dotenv picks that file up.

Start-Service $serviceName
Start-Sleep -Seconds 25
Get-Service $serviceName

Write-Output "`nChecking health endpoint..."
Invoke-WebRequest -Uri "http://localhost:$port/api/health" -UseBasicParsing |
  Select-Object -ExpandProperty Content

Write-Output "`nConfirming the Comedkare CIMS service is still running..."
$cims = Get-Service -Name $conflictingService -ErrorAction SilentlyContinue
if ($cims) {
  Write-Output "  $conflictingService : $($cims.Status)"
} else {
  Write-Output "  $conflictingService service not installed on this machine."
}
