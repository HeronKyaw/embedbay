param(
  [string]$BundleRoot = (Join-Path $PSScriptRoot "..\backend\target\release\bundle")
)

$ErrorActionPreference = "Stop"

Write-Host "=== EmbedBay Windows Release Verification ===" -ForegroundColor Cyan
Write-Host "Bundle root: $BundleRoot"

$nsisDir = Join-Path $BundleRoot "nsis"
$msiDir  = Join-Path $BundleRoot "msi"

$nsisExe = Get-ChildItem -Path $nsisDir -Filter "EmbedBay_*_x64-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$msiPkg  = Get-ChildItem -Path $msiDir  -Filter "EmbedBay_*_x64_en-US.msi" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $nsisExe) {
  throw "Missing NSIS installer under $nsisDir (expected EmbedBay_*_x64-setup.exe)"
}
if (-not $msiPkg) {
  throw "Missing WiX MSI installer under $msiDir (expected EmbedBay_*_x64_en-US.msi)"
}

foreach ($artifact in @($nsisExe, $msiPkg)) {
  $hash = (Get-FileHash -Path $artifact.FullName -Algorithm SHA256).Hash
  $sig  = Get-AuthenticodeSignature -FilePath $artifact.FullName
  $sizeMb = [Math]::Round($artifact.Length / 1MB, 2)
  Write-Host ""
  Write-Host "Artifact : $($artifact.Name)" -ForegroundColor Green
  Write-Host "Path     : $($artifact.FullName)"
  Write-Host "Size     : $sizeMb MB ($($artifact.Length) bytes)"
  Write-Host "SHA-256  : $hash"
  Write-Host "Signature: $($sig.Status)"
  if ($sig.Status -ne "Valid") {
    Write-Warning "Installer '$($artifact.Name)' is not Authenticode-signed (expected for local dev builds; CI requires code-signing cert)."
  }
}

Write-Host ""
Write-Host "Recommended manual smoke-test checks on a clean Windows 10/11 VM:" -ForegroundColor Yellow
Write-Host "  1. Run NSIS per-user install: `"$($nsisExe.FullName)`" (verify no UAC prompt and desktop shortcut works)"
Write-Host "  2. Toggle 'Autostart: Enabled' in EmbedBay Settings and verify HKCU\Software\Microsoft\Windows\CurrentVersion\Run contains EmbedBay --minimized"
Write-Host "  3. Close window -> verify WebView2 closes while EmbedBay.exe + child DB processes keep running in System Tray"
Write-Host "  4. Silent MSI test: msiexec /i `"$($msiPkg.FullName)`" /qn"
Write-Host "  5. Uninstall NSIS test -> verify keep-data dialog preserves %LOCALAPPDATA%\com.embedbay.app when Yes is chosen"
