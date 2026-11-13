# Turns off everything the live skill tree added to Windows. The tree's own files are kept.
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Gaurav Skill Tree.vbs'
Remove-Item -LiteralPath $startup -Force -ErrorAction SilentlyContinue
# The tree's server writes its own process number here when it starts, so nothing else is ever stopped.
$pidFile = Join-Path $PSScriptRoot 'server.pid'
if (Test-Path -LiteralPath $pidFile) {
  $id = [int](Get-Content -LiteralPath $pidFile -Raw)
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
  if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match 'server\.js') { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^Lively' } | Stop-Process -Force -ErrorAction SilentlyContinue
# Lively forgets this wallpaper and no longer starts with Windows, so it can't come back after a restart.
$family = '12030rocksdanister.LivelyWallpaper_97hta09mmv6hy'
$layout = "$env:LOCALAPPDATA\Packages\$family\LocalCache\Local\Lively Wallpaper\WallpaperLayout.json"
if (Test-Path -LiteralPath $layout) { [IO.File]::WriteAllText($layout, '[]', (New-Object Text.UTF8Encoding $false)) }
$autostart = "HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\$family\AppStartup"
if (Test-Path -LiteralPath $autostart) { Set-ItemProperty -LiteralPath $autostart -Name 'State' -Value 1 -Type DWord }
# Back to Windows Spotlight, which is what the lock screen used before.
$cdm = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
Set-ItemProperty -Path $cdm -Name 'RotatingLockScreenEnabled' -Value 1 -Type DWord
Set-ItemProperty -Path $cdm -Name 'RotatingLockScreenOverlayEnabled' -Value 1 -Type DWord
'The live skill tree is off. Your normal wallpaper is back, and the lock screen is set to Windows Spotlight.'
