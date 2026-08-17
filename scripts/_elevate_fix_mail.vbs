Set shell = CreateObject("Shell.Application")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
ps1 = scriptDir & "\_fix_mail_now.ps1"
shell.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """", "", "runas", 1
