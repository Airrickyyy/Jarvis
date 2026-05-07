param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 5500
)

$jarvisFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $jarvisFolder

$landing = "http://127.0.0.1:$Port/index.html"

Write-Host ""
Write-Host "Jarvis folder: $jarvisFolder"
Write-Host ""
Write-Host "Open this URL in Chrome or Edge:"
Write-Host "  $landing"
Write-Host ""
Write-Host "After the page loads, click Start Jarvis mic — Chrome should prompt for microphone access."
Write-Host "Press Ctrl+C to stop."
Write-Host ""

$python = @(Get-Command python -ErrorAction SilentlyContinue)[0]
$pyExe = @(Get-Command py -ErrorAction SilentlyContinue)[0]
$launch = $null

if ($python) {
  $launch = $python.Source
} elseif ($pyExe) {
  $launch = $pyExe.Source
}

if ($launch) {
  & $launch "-m" "http.server" "$Port"
  exit $LASTEXITCODE
}

$php = Get-Command php -ErrorAction SilentlyContinue
if ($php) {
  & $php.Source -S ("127.0.0.1:{0}" -f $Port)
  exit $LASTEXITCODE
}

if (Get-Command node -ErrorAction SilentlyContinue) {
  Push-Location $jarvisFolder
  npx --yes http-server -p $Port -a 127.0.0.1 -c-1 --silent .
  exit $LASTEXITCODE
}

Write-Host "No Python (/py), PHP, or Node found on PATH."
Write-Host ""
Write-Host "Quickest fix: install Python https://www.python.org/downloads/"
Write-Host "and tick 'Add python.exe to PATH', then rerun this script."
Write-Host ""
Write-Host "Manual command from this folder:"
Write-Host ('  python -m http.server {0}' -f $Port)
Write-Host "Then open:"
Write-Host "  $landing"
exit 1
