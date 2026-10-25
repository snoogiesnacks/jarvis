<#
.SYNOPSIS
  Schedule A.V.O. to run unattended on this PC (Windows Task Scheduler).

.DESCRIPTION
  REQUIRES CEO APPROVAL. Nothing is scheduled unless you pass -Apply.
  Without -Apply this only prints what it would create.

  The task runs as YOU, only while you are signed in (no stored password),
  at the times you choose, and runs:  node avo\run.mjs  then  node avo\digest.mjs
  Output goes to avo\runs\, avo\audit.log and avo\reports\digest\.
  The emergency stop still works: create avo\STOP (or STOP.txt) and the next
  scheduled run refuses to start.

  Remove it any time:  .\Register-AVOTask.ps1 -Remove -Apply

.EXAMPLE
  .\Register-AVOTask.ps1                         # preview, daily at 13:00
  .\Register-AVOTask.ps1 -At 09:30,15:30 -Apply  # create: twice a day
  .\Register-AVOTask.ps1 -Remove -Apply          # delete the task
#>
[CmdletBinding()]
param(
  [string[]]$At = @('13:00'),
  [switch]$Apply,
  [switch]$Remove,
  [string]$TaskName = 'JARVIS AVO simulation'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node was not found on PATH. Install Node.js or open a new PowerShell window.' }

if ($Remove) {
  if ($Apply) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task '$TaskName' (if it existed)." -ForegroundColor Green
  } else {
    Write-Host "Preview: would remove scheduled task '$TaskName'. Add -Apply to do it."
  }
  return
}

$cmd = "/c cd /d `"$repo`" && `"$node`" avo\run.mjs && `"$node`" avo\digest.mjs"
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmd -WorkingDirectory $repo
$triggers = foreach ($t in $At) { New-ScheduledTaskTrigger -Daily -At $t }
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew -StartWhenAvailable:$false

Write-Host "Task name : $TaskName"
Write-Host "Runs as   : $env:USERDOMAIN\$env:USERNAME (only while signed in; no password stored; not elevated)"
Write-Host "Times     : daily at $($At -join ', ')"
Write-Host "Command   : cmd.exe $cmd"
Write-Host "Time limit: 30 minutes per run; overlapping runs are skipped"
if (-not $Apply) {
  Write-Host "`nPreview only. Nothing was scheduled. Add -Apply to create it." -ForegroundColor Yellow
  return
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'A.V.O. offline staff simulation (Claude seat on Claude Code login; stand-ins for Halle/Gemini). Approved by Jahmod.' -Force | Out-Null
Write-Host "`nScheduled. Check it in Task Scheduler > Task Scheduler Library > '$TaskName'." -ForegroundColor Green
