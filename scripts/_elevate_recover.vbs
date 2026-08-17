Set shell = CreateObject("Shell.Application")
shell.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File ""d:\JBMSOFT_Security\scripts\_recover_usb_now.ps1""", "", "runas", 1
