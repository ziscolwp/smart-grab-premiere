# Smart Grab for Premiere — Windows installer (copy + fetch binaries + enable CEP).
# Tolerant: a failed binary download is a warning, not fatal (use "Update yt-dlp" in the panel later).
$ErrorActionPreference = "Continue"

$SelfDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$PanelSrc = Join-Path $SelfDir "panel"
$Dest     = Join-Path $env:APPDATA "Adobe\CEP\extensions\SmartGrabPanel"
$Bin      = Join-Path $PanelSrc "bin"

Write-Host "Installing Smart Grab for Premiere (Windows)..."
New-Item -ItemType Directory -Force -Path $Bin | Out-Null

function Fetch($url, $out) {
  Write-Host "  - $(Split-Path -Leaf $out)"
  try { Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing }
  catch { Write-Host "    (skipped: $($_.Exception.Message))" }
}

# yt-dlp — nightly channel (extractor fixes land here first).
if (-not (Test-Path "$Bin\yt-dlp.exe")) {
  Fetch "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe" "$Bin\yt-dlp.exe"
}

# ffmpeg/ffprobe — yt-dlp's own official Windows builds.
if (-not (Test-Path "$Bin\ffmpeg.exe") -or -not (Test-Path "$Bin\ffprobe.exe")) {
  $zip = Join-Path $Bin "_ffmpeg.zip"
  Fetch "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip" $zip
  if (Test-Path $zip) {
    $tmp = Join-Path $Bin "_ffmpeg_tmp"
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    Get-ChildItem -Path $tmp -Recurse -Include ffmpeg.exe, ffprobe.exe |
      ForEach-Object { Copy-Item $_.FullName $Bin -Force }
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# deno — JS runtime yt-dlp uses for YouTube's player challenges (optional but
# recommended for full YouTube support).
if (-not (Test-Path "$Bin\deno.exe")) {
  $dz = Join-Path $Bin "_deno.zip"
  Fetch "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" $dz
  if (Test-Path $dz) {
    Expand-Archive -Path $dz -DestinationPath $Bin -Force
    Remove-Item $dz -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Copying panel..."
if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Path "$PanelSrc\*" -Destination $Dest -Recurse -Force

Write-Host "Enabling CEP debug mode (PPro 2021-2025+)..."
foreach ($v in 10..12) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  New-ItemProperty -Path $key -Name PlayerDebugMode -Value "1" -PropertyType String -Force | Out-Null
}

Write-Host ""
Write-Host "Installed. Restart Premiere Pro, then: Window > Extensions > Smart Grab"
Read-Host "Press Enter to close"
