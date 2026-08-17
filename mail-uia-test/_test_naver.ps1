$out = & 'd:\JBMSOFT_Security\security\mail-uia-scrape.ps1' -Mode Full | Out-String
$d = $out | ConvertFrom-Json
$w = $d.windows | Where-Object { $_.isNaverReadMail } | Select-Object -First 1
Write-Output "title=$($w.title)"
Write-Output "to=$($w.recipients -join ',')"
Write-Output "subj=$($w.subject)"
Write-Output "att=$($w.attachments -join ',')"
Write-Output "body=$($w.bodyPreview)"
