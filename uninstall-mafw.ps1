# uninstall-mafw.ps1 — Remove MAFW Gateway scheduled task
Unregister-ScheduledTask -TaskName "MAFW-Gateway" -Confirm:$false
Write-Host "MAFW Gateway unregistered."
