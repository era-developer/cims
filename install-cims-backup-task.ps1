#Requires -RunAsAdministrator

# Registers a Windows scheduled task that backs up the CIMS database every
# night at 02:00 (and on the next start-up if the PC was off at 02:00).
# Runs as SYSTEM, so it does not depend on anyone being logged in.
#
# Paths are taken from where this script lives, so it works wherever the
# CIMS folder was copied to.
#
# Run from an elevated PowerShell:  .\install-cims-backup-task.ps1

$ErrorActionPreference = 'Stop'

$taskName = 'CIMS Backup'
$node = 'C:\Program Files\nodejs\node.exe'
$scriptsDir = Join-Path $PSScriptRoot 'backend\scripts'
$script = Join-Path $scriptsDir 'backup-db.js'
$log = Join-Path $PSScriptRoot 'backend\data\backups\backup.log'

if (-not (Test-Path $node)) { throw "node.exe not found at $node" }
if (-not (Test-Path $script)) { throw "backup script not found at $script" }
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$node`" `"$script`" >> `"$log`" 2>&1`"" `
  -WorkingDirectory $scriptsDir

$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At 2:00am),
  (New-ScheduledTaskTrigger -AtStartup)
)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable:$false `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal `
  -Description 'Nightly SQLite backup of the CIMS database to backend\data\backups' | Out-Null

Write-Output "Registered '$taskName'. Running it once now..."
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 8
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult, NextRunTime | Format-List
if (Test-Path $log) { Get-Content $log -Tail 3 }
