# Local self-signed code-signing certificate.
# For verifying the signing / auto-update chain only. Not for public distribution.
#
#   powershell -ExecutionPolicy Bypass -File scripts/win-self-sign.ps1 -Trust
#   powershell -ExecutionPolicy Bypass -File scripts/win-self-sign.ps1 -Remove
#
# The certificate lives in CurrentUser\My with a non-exportable private key.
# -Trust also adds it to CurrentUser\Root and CurrentUser\TrustedPublisher so
# Get-AuthenticodeSignature reports Status=Valid (electron-updater requires it).
param(
  [string]$Subject = "MAFW Dev",
  [int]$Years = 3,
  [switch]$Trust,
  [switch]$Remove,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$fullSubject = if ($Subject.StartsWith("CN=")) { $Subject } else { "CN=$Subject" }

function Get-MatchingCerts {
  param([string]$StorePath)
  Get-ChildItem -Path $StorePath -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $fullSubject }
}

if ($Remove) {
  $removed = 0
  foreach ($storePath in @(
      "Cert:\CurrentUser\My",
      "Cert:\CurrentUser\Root",
      "Cert:\CurrentUser\TrustedPublisher"
    )) {
    foreach ($cert in (Get-MatchingCerts $storePath)) {
      Remove-Item -LiteralPath $cert.PSPath -Force
      $removed++
      Write-Host "removed $($cert.Thumbprint) from $storePath"
    }
  }
  if ($removed -eq 0) { Write-Host "no certificate for $fullSubject" }
  exit 0
}

$cert = Get-ChildItem -Path "Cert:\CurrentUser\My" -ErrorAction SilentlyContinue |
  Where-Object { $_.Subject -eq $fullSubject -and $_.HasPrivateKey } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if ($Force -and $cert) {
  Remove-Item -LiteralPath $cert.PSPath -Force
  $cert = $null
}

if (-not $cert) {
  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $fullSubject `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyUsage DigitalSignature `
    -KeyExportPolicy NonExportable `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears($Years)
  Write-Host "created $($cert.Thumbprint)"
}
else {
  Write-Host "reusing $($cert.Thumbprint) (expires $($cert.NotAfter.ToString('yyyy-MM-dd')))"
}

if ($Trust) {
  $exportPath = Join-Path $env:TEMP "mafw-self-sign-$($cert.Thumbprint).cer"
  Export-Certificate -Cert $cert -FilePath $exportPath -Force | Out-Null
  try {
    foreach ($storePath in @("Cert:\CurrentUser\Root", "Cert:\CurrentUser\TrustedPublisher")) {
      $already = Get-ChildItem -Path $storePath -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
      if ($already) { continue }
      Import-Certificate -FilePath $exportPath -CertStoreLocation $storePath | Out-Null
      Write-Host "trusted in $storePath"
    }
  }
  finally {
    Remove-Item -LiteralPath $exportPath -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "subject:    $($cert.Subject)"
Write-Host "thumbprint: $($cert.Thumbprint)"
Write-Host "expires:    $($cert.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host ""
Write-Host "build with:"
Write-Host '  $env:MAFW_WIN_SELF_SIGN="1"; cd packages/desktop; npx electron-builder --win --dir --config electron-builder.config.ts'
Write-Host ""
Write-Host "undo trust + certificate:"
Write-Host '  powershell -ExecutionPolicy Bypass -File scripts/win-self-sign.ps1 -Remove'
