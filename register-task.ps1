$startupFolder = [System.Environment]::GetFolderPath('Startup')
$vbsPath = "$startupFolder\DiscordClaudeBot.vbs"
$vbsContent = "Set WshShell = CreateObject(""WScript.Shell"")" + "`r`n" + "WshShell.Run ""cmd /c cd /d C:\Users\user\discord-claude-bot && node bot.js"", 0, False"
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII
Write-Host "Done! Created startup script: $vbsPath"
