# uninstall-mafw.ps1
# MAFW Loop Agent v3.5 — Windows Uninstaller

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MAFW Loop Agent v3.5 Uninstaller" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查管理员权限
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "请以管理员身份运行此脚本" -ForegroundColor Red
    exit 1
}

# 2. 停止并移除 Windows Task Scheduler 任务
Write-Host "[...] Removing Windows Task Scheduler task..." -ForegroundColor Yellow
$Task = Get-ScheduledTask -TaskName "MAFW-Scheduler" -ErrorAction SilentlyContinue
if ($Task) {
    Stop-ScheduledTask -TaskName "MAFW-Scheduler" -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName "MAFW-Scheduler" -Confirm:$false
    Write-Host "[OK] Task Scheduler task removed: MAFW-Scheduler" -ForegroundColor Green
} else {
    Write-Host "[INFO] Task not found: MAFW-Scheduler" -ForegroundColor Gray
}

# 3. 清理旧版 NSSM 服务（v2.0 兼容）
Write-Host "[...] Cleaning up old v2.0 NSSM services..." -ForegroundColor Yellow
$NssmPath = "C:/Tools/nssm/nssm.exe"
if (Test-Path $NssmPath) {
    & $NssmPath stop MAFW-Scheduler 2>$null | Out-Null
    & $NssmPath remove MAFW-Scheduler confirm 2>$null | Out-Null
    & $NssmPath stop MAFW-OpenCode-Server 2>$null | Out-Null
    & $NssmPath remove MAFW-OpenCode-Server confirm 2>$null | Out-Null
    Write-Host "[OK] Old NSSM services removed" -ForegroundColor Green
}

# 4. 完成
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Uninstallation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "注意: MAFW 插件文件和数据目录未被删除" -ForegroundColor Yellow
Write-Host "如需完全清理，请手动删除以下目录:" -ForegroundColor Gray
Write-Host "  - .opencode/plugins/mafw-plugin.ts" -ForegroundColor Gray
Write-Host "  - .opencode/mafw/" -ForegroundColor Gray
Write-Host "  - scheduler/registered-projects.json" -ForegroundColor Gray
Write-Host ""
