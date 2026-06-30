# install-mafw.ps1 — Register MAFW Gateway as a user scheduled task
$action = New-ScheduledTaskAction -Execute "node" -Argument "$(Split-Path $PSScriptRoot -Parent)\gateway\dist\index.js"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "MAFW-Gateway" -Action $action -Trigger $trigger -Settings $settings -Force
Write-Host "MAFW Gateway registered. Use 'npx mafw-gateway start' to run now."
