# BotTeam stack control: Gemma (llama-server :8080) + Rakazo (Docker in WSL, :5173/:3110) + BotTeam app + 3D office (:3300)
#   powershell -ExecutionPolicy Bypass -File D:\localai\botteam.ps1 status|start|stop
# start: opens BotTeam (it auto-starts the LLM and Rakazo) and the office server; stop: stops all four (data kept).
param([ValidateSet("status", "start", "stop")] [string]$Action = "status")
$ErrorActionPreference = "Stop"
$Root = "D:\localai"
$App = "$Root\botadmin\dist\BotAdmin.exe"
$Office = "$Root\botoffice"
$Rk = "wsl.exe -d Ubuntu-24.04 -- bash /mnt/d/localai/botadmin/rakazo.sh"

function Up($url) { try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3).StatusCode -lt 500 } catch { $false } }
function OfficePid { (Get-NetTCPConnection -LocalPort 3300 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess }
function Line($ok, $name, $info) { Write-Host ("{0} {1,-10} {2}" -f ($(if ($ok) { "[OK]  " } else { "[--]  " }), $name, $info)) }

function Status {
  Line (Up "http://127.0.0.1:8080/health") "LLM" "Gemma 4 llama-server http://127.0.0.1:8080"
  $c = (Invoke-Expression "$Rk status") -match '^C ' | ForEach-Object { ($_.Substring(2) | ConvertFrom-Json) }
  $run = @($c | Where-Object State -eq "running").Count
  $bad = @($c | Where-Object { $_.State -ne "running" -and $_.Status -notmatch '^Exited \(0\)' }).Count # computer/data-init are one-shot jobs
  Line ((Up "http://127.0.0.1:3110/health") -and -not $bad) "Rakazo" "api http://127.0.0.1:3110 | web http://127.0.0.1:5173 | $(if ($run) { "running $run, failed $bad" } else { "stopped" })"
  Line ([bool](Get-Process BotAdmin -ErrorAction SilentlyContinue)) "BotTeam" $App
  Line (Up "http://127.0.0.1:3300") "Office3D" "http://127.0.0.1:3300"
}

switch ($Action) {
  "status" { Status }
  "start" {
    if (-not (Get-Process BotAdmin -ErrorAction SilentlyContinue)) { Start-Process $App; Write-Host "BotTeam opened (it starts LLM + Rakazo itself; first start ~1-3 min)" }
    if (-not (OfficePid)) {
      if (-not (Test-Path "$Office\.next\BUILD_ID")) { Write-Host "building office (first time)..."; npm --prefix $Office run build | Out-Null }
      New-Item -ItemType Directory -Force "$Root\logs" | Out-Null
      # hidden, bound to 127.0.0.1 only (package.json "start")
      Start-Process cmd.exe -ArgumentList "/c npm --prefix `"$Office`" run start > `"$Root\logs\botoffice.log`" 2>&1" -WindowStyle Hidden
      for ($i = 0; $i -lt 30 -and -not (Up "http://127.0.0.1:3300"); $i++) { Start-Sleep 1 }
    }
    Status
  }
  "stop" {
    $p = OfficePid; if ($p) { taskkill /PID $p /T /F | Out-Null }
    Get-Process BotAdmin -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null; if (-not $_.WaitForExit(5000)) { $_.Kill() } }
    Invoke-Expression "$Rk stop" | Out-Null # compose stop: containers kept, never "down -v"
    Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force
    Status
  }
}
