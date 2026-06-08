# R6-B: Auto-start WSL Ubuntu on Windows logon (Hermes gateway persistence)
# On logon, wake WSL Ubuntu in background -> WSL systemd starts hermes-gateway.service (R6-A).
# Result: Telegram bot runs after reboot with zero manual steps.
# Remove with: schtasks /delete /tn "WSL-Hermes-Gateway" /f
# Run: powershell -ExecutionPolicy Bypass -File <thisfile>  (no admin needed; per-user logon trigger)

$ErrorActionPreference = "Stop"
$taskName = "WSL-Hermes-Gateway"
$wslExe = "C:\Windows\System32\wsl.exe"
$wslArgs = "-d Ubuntu --exec true"

$existing = schtasks /query /tn $taskName 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Existing task found -> deleting and re-creating"
    schtasks /delete /tn $taskName /f | Out-Null
}

schtasks /create /tn $taskName /tr "`"$wslExe`" $wslArgs" /sc ONLOGON /rl LIMITED /f

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "OK: scheduled task registered: $taskName"
    Write-Host "Trigger: ONLOGON / Action: wake WSL Ubuntu in background"
    Write-Host ""
    Write-Host "=== verify ==="
    schtasks /query /tn $taskName /fo LIST | Select-String "TaskName|Status|Logon|Next"
    Write-Host ""
    Write-Host "Run now to test:  schtasks /run /tn $taskName"
    Write-Host "Remove:           schtasks /delete /tn $taskName /f"
} else {
    Write-Host "FAILED to register (exit=$LASTEXITCODE)"
}
