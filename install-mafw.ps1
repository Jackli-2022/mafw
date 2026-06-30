# install-mafw.ps1
# MAFW Loop Agent v3.5 — Windows Installer
# 以管理员身份运行 PowerShell

param(
    [Parameter(Mandatory=$true, HelpMessage="目标项目目录，例如 D:/Projects/myapp")]
    [string]$ProjectDir,

    [Parameter(HelpMessage="MAFW 插件源码目录，默认使用当前脚本所在目录")]
    [string]$PluginDir = $PSScriptRoot,

    [Parameter(HelpMessage="开发模式：创建符号链接，修改源码后重启 TUI 生效")]
    [switch]$Symlink,

    [string]$LogDir = "C:/Logs/mafw"
)

function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    $input | Write-Output
    $host.UI.RawUI.ForegroundColor = $fc
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MAFW Loop Agent v3.5 Installer" -ForegroundColor Cyan
Write-Host "  Phase Relay + TMEM + Compression" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查管理员权限
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "请以管理员身份运行此脚本" | Write-ColorOutput Red
    exit 1
}

# 2. 检查前置依赖
try {
    $NodePath = (Get-Command node -ErrorAction Stop).Source
    Write-Host "[OK] Node.js: $NodePath" -ForegroundColor Green
} catch {
    Write-Error "未找到 Node.js。请确保已安装 Node.js >= 18" | Write-ColorOutput Red
    exit 1
}

try {
    $OpenCodePath = (Get-Command opencode -ErrorAction Stop).Source
    Write-Host "[OK] OpenCode: $OpenCodePath" -ForegroundColor Green
} catch {
    Write-Error "未找到 opencode。请确保已安装: npm install -g opencode-ai" | Write-ColorOutput Red
    exit 1
}

# 3. 检查项目目录和插件目录
$ProjectDir = (Resolve-Path $ProjectDir).Path
$PluginDir = (Resolve-Path $PluginDir).Path

if (-not (Test-Path $ProjectDir)) {
    Write-Error "项目目录不存在: $ProjectDir" | Write-ColorOutput Red
    exit 1
}
Write-Host "[OK] Project directory: $ProjectDir" -ForegroundColor Green

if (-not (Test-Path "$PluginDir/.opencode/plugins/mafw-plugin.ts")) {
    Write-Error "插件目录无效，未找到 .opencode/plugins/mafw-plugin.ts" | Write-ColorOutput Red
    exit 1
}
Write-Host "[OK] Plugin directory: $PluginDir" -ForegroundColor Green

# 4. 编译 Scheduler
Write-Host "`n[...] Compiling Scheduler..." -ForegroundColor Yellow
Set-Location $PluginDir

# 安装主项目依赖（如果有 package.json）
if (Test-Path "$PluginDir/package.json") {
    Write-Host "    npm install (main project)..." -ForegroundColor Gray
    npm install 2>&1 | ForEach-Object { "    $_" } | Write-Host
}

# 编译主项目
if (Test-Path "$PluginDir/tsconfig.json") {
    Write-Host "    tsc build (main project)..." -ForegroundColor Gray
    npx tsc 2>&1 | ForEach-Object { "    $_" } | Write-Host
}

# 安装 Scheduler 依赖
$SchedulerDir = "$PluginDir/scheduler"
if (Test-Path "$SchedulerDir/package.json") {
    Write-Host "    npm install (scheduler)..." -ForegroundColor Gray
    Set-Location $SchedulerDir
    npm install 2>&1 | ForEach-Object { "    $_" } | Write-Host

    # 编译 Scheduler
    Write-Host "    tsc build (scheduler)..." -ForegroundColor Gray
    npx tsc 2>&1 | ForEach-Object { "    $_" } | Write-Host

    if (-not (Test-Path "$SchedulerDir/dist/index.js")) {
        Write-Warning "Scheduler 编译失败，请检查错误信息" | Write-ColorOutput Yellow
    } else {
        Write-Host "[OK] Scheduler compiled successfully" -ForegroundColor Green
    }
} else {
    Write-Warning "Scheduler package.json 未找到，跳过编译" | Write-ColorOutput Yellow
}

Set-Location $ProjectDir

# 5. 安装 MAFW 插件到 OpenCode
Write-Host "`n[...] Installing MAFW plugin to OpenCode..." -ForegroundColor Yellow
if ($Symlink) {
    # 开发模式：符号链接
    Write-Host "    Development mode: creating symlink..." -ForegroundColor Gray
    $TargetPluginDir = "$ProjectDir/.opencode/plugins"
    if (-not (Test-Path $TargetPluginDir)) {
        New-Item -ItemType Directory -Force -Path $TargetPluginDir | Out-Null
    }

    $SymlinkPath = "$TargetPluginDir/mafw-plugin"
    if (Test-Path $SymlinkPath) {
        Remove-Item $SymlinkPath -Recurse -Force
    }

    # 创建符号链接指向插件源码
    New-Item -ItemType SymbolicLink -Path $SymlinkPath -Target "$PluginDir/.opencode/plugins/mafw-plugin.ts" -Force | Out-Null
    Write-Host "[OK] Symlink created: $SymlinkPath -> $PluginDir/.opencode/plugins/mafw-plugin.ts" -ForegroundColor Green
    Write-Host "    (开发模式: 修改源码后重启 TUI 生效)" -ForegroundColor Gray
} else {
    # 生产模式：直接安装
    Write-Host "    Production mode: opencode plugin install..." -ForegroundColor Gray
    opencode plugin install $PluginDir 2>&1 | ForEach-Object { "    $_" } | Write-Host
    Write-Host "[OK] Plugin installed to OpenCode" -ForegroundColor Green
}

# 6. 创建日志目录
Write-Host "`n[...] Creating log directory..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Write-Host "[OK] Log directory: $LogDir" -ForegroundColor Green

# 注意: .opencode/mafw/ 目录结构由插件在运行时自动创建，
# 详见 src/plugin.ts 中的 MafwPlugin.activate()

# 8. 清理旧版服务（如果存在）
Write-Host "`n[...] Cleaning up old v2.0 services..." -ForegroundColor Yellow
# NSSM 服务（v2.0 使用）
$NssmPath = "C:/Tools/nssm/nssm.exe"
if (Test-Path $NssmPath) {
    & $NssmPath stop MAFW-Scheduler 2>$null | Out-Null
    & $NssmPath remove MAFW-Scheduler confirm 2>$null | Out-Null
    & $NssmPath stop MAFW-OpenCode-Server 2>$null | Out-Null
    & $NssmPath remove MAFW-OpenCode-Server confirm 2>$null | Out-Null
    Write-Host "[OK] Old NSSM services removed" -ForegroundColor Green
}

# Task Scheduler 旧任务（如果存在）
$OldTask = Get-ScheduledTask -TaskName "MAFW-Scheduler" -ErrorAction SilentlyContinue
if ($OldTask) {
    Unregister-ScheduledTask -TaskName "MAFW-Scheduler" -Confirm:$false
    Write-Host "[OK] Old Task Scheduler task removed" -ForegroundColor Green
}

# 9. 注册 Windows Task Scheduler
Write-Host "`n[...] Registering Windows Task Scheduler..." -ForegroundColor Yellow
$SchedulerScript = "$PluginDir/scheduler/dist/index.js"
if (-not (Test-Path $SchedulerScript)) {
    Write-Warning "Scheduler 脚本未找到: $SchedulerScript" -Write-ColorOutput Yellow
    Write-Warning "请先确保 Scheduler 已编译: cd scheduler && npm run build" -Write-ColorOutput Yellow
}

$Action = New-ScheduledTaskAction -Execute "node" -Argument $SchedulerScript -WorkingDirectory $ProjectDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName "MAFW-Scheduler" `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Force | Out-Null

Write-Host "[OK] Task Scheduler registered: MAFW-Scheduler" -ForegroundColor Green

# 10. 立即启动 Scheduler
Write-Host "`n[...] Starting MAFW-Scheduler..." -ForegroundColor Yellow
Start-ScheduledTask -TaskName "MAFW-Scheduler"
Start-Sleep -Seconds 3

# 11. 验证安装
Write-Host "`n[...] Verifying installation..." -ForegroundColor Yellow
$HealthUrl = "http://127.0.0.1:3000/health"
try {
    $Response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    $Data = $Response.Content | ConvertFrom-Json
    Write-Host "[OK] Scheduler is running" -ForegroundColor Green
    Write-Host "    Status: $($Data.status)" -ForegroundColor Gray
    Write-Host "    Registered projects: $($Data.registeredProjects.Count)" -ForegroundColor Gray
} catch {
    Write-Warning "Scheduler 尚未响应 (可能需要更多启动时间)" -ForegroundColor Yellow
    Write-Warning "请稍后手动检查: curl http://127.0.0.1:3000/health" -ForegroundColor Yellow
}

# 12. 完成
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "  MAFW v3.5 — Phase Relay Architecture" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project:      $ProjectDir" -ForegroundColor Gray
Write-Host "Plugin:       $PluginDir" -ForegroundColor Gray
Write-Host "Logs:         $LogDir" -ForegroundColor Gray
Write-Host "Health:       http://127.0.0.1:3000/health" -ForegroundColor Gray
Write-Host ""
Write-Host "Usage:" -ForegroundColor Cyan
Write-Host "  1. cd $ProjectDir" -ForegroundColor Gray
Write-Host "  2. opencode  (启动 TUI)" -ForegroundColor Gray
Write-Host "  3. /goal 设计登录系统  (提交 Goal)" -ForegroundColor Gray
Write-Host "  4. TUI 可以关闭，Goal 在后台自动运行" -ForegroundColor Gray
Write-Host ""
Write-Host "Management:" -ForegroundColor Cyan
Write-Host "  Start:  Start-ScheduledTask -TaskName MAFW-Scheduler" -ForegroundColor Gray
Write-Host "  Stop:   Stop-ScheduledTask -TaskName MAFW-Scheduler" -ForegroundColor Gray
Write-Host "  Status: Get-ScheduledTask -TaskName MAFW-Scheduler" -ForegroundColor Gray
Write-Host "  Uninstall: .\uninstall-mafw.ps1" -ForegroundColor Gray
Write-Host ""
