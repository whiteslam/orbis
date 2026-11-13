# Connects the skill tree to Windows: server at login, and Lively showing it as the desktop wallpaper.
# Gaurav approved this on 4 Nov 2026. turn-off-live.cmd undoes it.
$ErrorActionPreference = 'Stop'
$root = 'F:\WBT-Staging\Gaurav SKILL tree'
$family = '12030rocksdanister.LivelyWallpaper_97hta09mmv6hy'
$lively = "$env:LOCALAPPDATA\Packages\$family\LocalCache\Local\Lively Wallpaper"
$entry = "$lively\Library\wallpapers\gaurav-skill-tree"
# Lively sees its own folders under this path, which Windows redirects to the folder above.
$entryAsLivelySeesIt = "$env:LOCALAPPDATA\Lively Wallpaper\Library\wallpapers\gaurav-skill-tree"

# 1. The server starts by itself at login. Only the tree's own server is restarted.
Copy-Item "$root\tools\start-hidden.vbs" (Join-Path ([Environment]::GetFolderPath('Startup')) 'Gaurav Skill Tree.vbs') -Force
$pidFile = "$root\tools\server.pid"
if (Test-Path -LiteralPath $pidFile) {
  $id = [int](Get-Content -LiteralPath $pidFile -Raw)
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
  if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match 'server\.js') { Stop-Process -Id $id -Force }
}
Start-Sleep -Seconds 1
Start-Process wscript.exe -ArgumentList "`"$root\tools\start-hidden.vbs`""

# 2. Close Lively while its files change.
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^Lively' } | Stop-Process -Force
Start-Sleep -Seconds 2

# 3. The wallpaper entry.
New-Item -ItemType Directory -Force $entry | Out-Null
Copy-Item "$root\tools\lively\index.html" "$entry\index.html" -Force
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile("$root\tools\lockscreen.png")
$thumb = New-Object System.Drawing.Bitmap 640, 360
$g = [System.Drawing.Graphics]::FromImage($thumb)
$g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($source, 0, 0, 640, 360)
$thumb.Save("$entry\thumbnail.jpg", [System.Drawing.Imaging.ImageFormat]::Jpeg)
$g.Dispose(); $thumb.Dispose(); $source.Dispose()
$info = [ordered]@{
  AppVersion = '2.2.1.5'; Title = "Gaurav's skill tree"; Thumbnail = 'thumbnail.jpg'; Preview = $null
  Desc = 'A live skill tree built from my own commits.'; Author = 'Gaurav'; License = ''; Contact = ''
  Type = 1; Arguments = '--pause-event true'; FileName = 'index.html'
}
[IO.File]::WriteAllText("$entry\LivelyInfo.json", ($info | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

# 4. Tell Lively to use it on the main screen, with no welcome window.
$settings = Get-Content "$lively\Settings.json" -Raw | ConvertFrom-Json
$settings.IsFirstRun = $false
$settings.ControlPanelOpened = $true
# Pause whenever any other app is in use, not only when one fills the screen. 0 means pause.
$settings.AppFocusPause = 0
$settings.AppFullscreenPause = 0
[IO.File]::WriteAllText("$lively\Settings.json", ($settings | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding $false))
$layout = @(@{ Display = $settings.SelectedDisplay; LivelyInfoPath = $entryAsLivelySeesIt })
[IO.File]::WriteAllText("$lively\WallpaperLayout.json", (ConvertTo-Json -InputObject $layout -Depth 8), (New-Object Text.UTF8Encoding $false))

# 5. Start Lively again.
Start-Process "shell:AppsFolder\$family!App"
# Lively opens its settings window on start. Close it straight away so it doesn't sit over other work.
$until = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $until) {
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'Lively.UI.WinUI' } | Stop-Process -Force
  Start-Sleep -Milliseconds 400
}
'Setup finished.'
