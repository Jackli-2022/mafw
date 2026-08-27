$path = Join-Path $env:USERPROFILE ".mafw\config.yaml"
$bytes = [System.IO.File]::ReadAllBytes($path)
Write-Output "File size: $($bytes.Length) bytes"

# Check BOM
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    Write-Output "BOM: YES (UTF-8 BOM detected)"
} else {
    Write-Output "BOM: NO"
}

# First 20 hex bytes
$maxShow = [Math]::Min(20, $bytes.Length)
$hex = ($bytes[0..($maxShow-1)] | ForEach-Object { "0x{0:X2}" -f $_ }) -join ' '
Write-Output "First $maxShow bytes: $hex"

# Check for other BOMs
if ($bytes.Length -ge 2) {
    if ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) { Write-Output "BOM: UTF-16 LE" }
    if ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) { Write-Output "BOM: UTF-16 BE" }
    if ($bytes[0] -eq 0x00 -and $bytes[1] -eq 0x00 -and $bytes.Length -ge 4 -and $bytes[2] -eq 0xFE -and $bytes[3] -eq 0xFF) { Write-Output "BOM: UTF-32 BE" }
}

# Try to read content
try {
    $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    Write-Output "--- Content (first 2000 chars) ---"
    Write-Output $text.Substring(0, [Math]::Min(2000, $text.Length))
} catch {
    Write-Output "Error reading text: $_"
}
