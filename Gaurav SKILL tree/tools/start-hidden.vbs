' Starts the skill tree in the background with no window. Windows runs a copy of this at login.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "F:\WBT-Staging\Gaurav SKILL tree"
shell.Run """F:\node.exe"" --optimize-for-size --max-old-space-size=32 ""F:\WBT-Staging\Gaurav SKILL tree\server.js""", 0, False
