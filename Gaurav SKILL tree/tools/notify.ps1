param([Parameter(Mandatory = $true)][string]$Title, [Parameter(Mandatory = $true)][string]$Message)
# Shows a Windows notification. Windows also shows it on the lock screen if that is allowed in Settings.
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
$escape = { param($t) [System.Security.SecurityElement]::Escape($t) }
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$(& $escape $Title)</text><text>$(& $escape $Message)</text></binding></visual></toast>")
$sender = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($sender).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
'Notification sent.'
