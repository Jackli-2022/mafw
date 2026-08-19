# MAFW Gateway system tray (Windows only)
# Spawned by the gateway: powershell -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File tray.ps1 -Port <port> -PidFile <path>
param(
    [int]$Port = 3000,
    [string]$PidFile = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Draw a simple icon programmatically so no binary asset is needed.
function New-MafwIcon {
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 80, 120, 255))
    $g.FillEllipse($bg, 1, 1, 30, 30)
    $fg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $font = New-Object System.Drawing.Font "Segoe UI", 16, ([System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF 2, 2, 28, 28
    $g.DrawString("M", $font, $fg, $rect, $sf)
    $handle = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($handle)
    $g.Dispose()
    $bmp.Dispose()
    return $icon
}

$script:Tray = $null
$script:ExitRequested = $false

function Show-Dashboard {
    try { Start-Process "http://localhost:$Port/" } catch {}
}

function Stop-Gateway {
    try { Start-Process "mafw" -ArgumentList "stop" -WindowStyle Hidden } catch {}
    # The gateway kills this tray on shutdown; exit anyway as a fallback.
    [System.Windows.Forms.Application]::Exit()
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = New-MafwIcon
$tray.Text = "MAFW Gateway - http://localhost:$Port"
$tray.Visible = $true

$openItem = New-Object System.Windows.Forms.MenuItem "Open Dashboard"
$openItem.add_Click({ Show-Dashboard })
$stopItem = New-Object System.Windows.Forms.MenuItem "Stop Gateway"
$stopItem.add_Click({ Stop-Gateway })
$exitItem = New-Object System.Windows.Forms.MenuItem "Exit Tray"
$exitItem.add_Click({
    $tray.Visible = $false
    $tray.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$menu = New-Object System.Windows.Forms.ContextMenu
$menu.MenuItems.AddRange(@($openItem, $stopItem, $exitItem))
$tray.ContextMenu = $menu
$tray.add_DoubleClick({ Show-Dashboard })

# Write our own PID so the gateway can clean us up on shutdown.
if ($PidFile) {
    try { Set-Content -LiteralPath $PidFile -Value $PID -Encoding ASCII } catch {}
}

# Self-cleanup: if the gateway dies without telling us (e.g. hard kill on
# Windows), exit after a few failed health checks.
$healthFailures = 0
$healthTimer = New-Object System.Windows.Forms.Timer
$healthTimer.Interval = 5000
$healthTimer.add_Tick({
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 3
        $healthFailures = 0
    } catch {
        $healthFailures++
        if ($healthFailures -ge 5) {
            $healthTimer.Stop()
            $tray.Visible = $false
            $tray.Dispose()
            [System.Windows.Forms.Application]::Exit()
        }
    }
})
$healthTimer.Start()

[System.Windows.Forms.Application]::Run()
$tray.Visible = $false
$tray.Dispose()
