#Requires -RunAsAdministrator

# Registers a Windows scheduled task that backs up the KIMS database every
# night at 02:00 (and on the next start-up if the PC was off at 02:00).
# Runs as SYSTEM, so it does not depend on anyone being logged in.
#
# Run from an elevated PowerShell:  .\install-kims-backup-task.ps1

$ErrorActionPreference = 'Stop'

$taskName = 'KIMS Backup'
$node = 'C:\Program Files\nodejs\node.exe'
$script = 'D:\KIMS\backend\scripts\backup-db.js'
$log = 'D:\KIMS\backend\data\backups\backup.log'

if (-not (Test-Path $node)) { throw "node.exe not found at $node" }
if (-not (Test-Path $script)) { throw "backup script not found at $script" }

$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$node`" `"$script`" >> `"$log`" 2>&1`"" `
  -WorkingDirectory 'D:\KIMS\backend\scripts'

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
  -Description 'Nightly SQLite backup of the KIMS database to backend\data\backups' | Out-Null

Write-Output "Registered '$taskName'. Running it once now..."
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 8
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult, NextRunTime | Format-List
if (Test-Path $log) { Get-Content $log -Tail 3 }
