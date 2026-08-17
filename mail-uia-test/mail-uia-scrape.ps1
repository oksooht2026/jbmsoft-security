# mail-uia-scrape.ps1
param(
  [ValidateSet('Signal', 'Full')]
  [string]$Mode = 'Full'
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [Console]::OutputEncoding

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$BROWSER = @('chrome', 'msedge', 'whale', 'firefox', 'opera', 'brave')
$ATTACH_PATTERN = '[^\s\\/:*?"<>|]+\.(pdf|docx?|xlsx?|pptx?|hwp|hwpx|zip|rar|7z|png|jpe?g|gif|txt|csv|ppt|xls)\b'
$MAX_DEPTH = if ($Mode -eq 'Signal') { 14 } else { 26 }
$MAX_NODES = if ($Mode -eq 'Signal') { 900 } else { 3500 }

$SUCCESS_DOC_RE = '메일을\s*성공|성공적으로\s*보냈|보냈습니다|message\s*sent|mail\s*sent|your\s*message\s*has\s*been\s*sent|전송\s*완료|발송\s*완료|메일이\s*전송|메시지를\s*보냈|메일을\s*보냈'
$SENT_TITLE_RE = '보낸\s*메일|보낸\s*편지|sent\s*mail|#sent|sentmail|발송\s*함'
$GMAIL_COMPOSE_RE = '새\s*메일|new\s*message|compose\s*mail|메일\s*쓰기'
$GMAIL_TOAST_RE = '메일보러가기|메일이\s*전송|메시지를\s*보냈|메일을\s*보냈|message\s*sent|view\s*message|전송되었습니다|your\s*message\s*has\s*been\s*sent'
$GROUPWARE_COMPOSE_RE = '메일\s*쓰기|메일쓰기|받는\s*사람|받는사람|숨은\s*참조|참조\s*추가|제목\s*없음'
$GROUPWARE_TOAST_RE = '발송\s*되었|발송\s*하였|전송\s*되었|메일을\s*보냈|메일\s*발송|성공적으로\s*발송|메일\s*전송|보내기\s*완료'
$SEND_TOAST_RE = ($GMAIL_TOAST_RE + '|' + $GROUPWARE_TOAST_RE)
$TIME_ROW_RE = '^(오늘|어제|\d{1,2}:\d{2}|\d{4}[./-]\d|\d+\s*/\s*\d+)$'
$emailRe = [regex]'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}'

function Test-IsUrlLike([string]$text) {
  if (-not $text -or $text.Trim().Length -lt 2) { return $true }
  $t = $text.Trim()
  if ($t -match '^(https?://|devtools://|chrome://|edge://|about:)') { return $true }
  if ($t -match 'mail\.google\.com|mail\.naver|mail\.daum|daouoffice|#inbox|#compose|/gw/app/mail') { return $true }
  if ($t -match '^[\w.-]+\.(com|net|org|co\.kr|io)/[^\s]*$') { return $true }
  if ($t.Length -gt 60 -and $t -match '[\#/\\?=&]' -and $t -notmatch '\s') { return $true }
  return $false
}

function Test-IsOmnibarName([string]$name) {
  if (-not $name) { return $false }
  $n = $name.ToLowerInvariant()
  return ($n -match 'address and search|omnibox|search bar|주소 및 검색|주소창|검색 표시줄')
}

function Test-NaverNoiseRow([string]$text) {
  if (-not $text) { return $true }
  $t = $text.Trim()
  if ($t.Length -lt 2) { return $true }
  if ($t -match '^(보낸\s*메일함|받은\s*메일함|메일\s*쓰기|전체선택|선택|읽음|안읽음|중요|별표)$') { return $true }
  if ($t -match '^(네이버톡|알림\d+|서비스|캘린더|주소록|MYBOX|Keep|Works|메모|스마트|환경설정|고객센터|정보킹|Notes|Unwanted|Filter|html\.|body\.|css selector|@font)') { return $true }
  if ($t -match '정보킹|내정보\s*보기|서비스\s*모두|메일\s*용량|전체\s*메일') { return $true }
  if ($t -match '^\d+\s*/\s*\d+$') { return $true }
  if ($t -match $TIME_ROW_RE) { return $true }
  if ($t -match '^(오늘|어제)\s+\d') { return $true }
  if ($t.Length -gt 120) { return $true }
  return $false
}

function Parse-NaverSentFirst([string[]]$sentRows) {
  $clean = @($sentRows | Where-Object { $_ -and -not (Test-IsUrlLike $_) -and -not (Test-NaverNoiseRow $_) })
  $recipient = ''
  $subject = ''
  $sentAt = ''

  for ($i = 0; $i -lt $clean.Count; $i++) {
    $row = $clean[$i]
    if (-not $recipient -and $row -match '@') {
      $m = $emailRe.Match($row)
      if ($m.Success) {
        $recipient = $m.Value.ToLower()
        for ($j = $i + 1; $j -lt [Math]::Min($i + 4, $clean.Count); $j++) {
          $next = $clean[$j]
          if ($next -match $TIME_ROW_RE -or $next -match '^(오늘|어제)\s') {
            $sentAt = $next
            continue
          }
          if (-not $subject -and $next -notmatch '@' -and $next.Length -le 220) {
            $subject = $next
            break
          }
        }
        break
      }
    }
  }

  return @{ recipient = $recipient; subject = $subject; sentAt = $sentAt }
}

function Test-PageNoise([string]$text) {
  if (-not $text -or $text.Trim().Length -lt 2) { return $true }
  $t = $text.Trim()
  if ($t.Length -gt 600) { return $true }
  if ($t -match 'Toolbar|비활성화|SmartEditor|gecko|DEXT5|MYBOX|Google LLC|Oracle Cloud|Verify your email|AI 메일|HTML|CSS|Toolbar Area') { return $true }
  if ($t -match '메일을\s*성공|성공적으로\s*보냈|주소록에\s*추가|연락처\s*저장') { return $true }
  return $false
}

function Test-NaverSubjectCandidate([string]$text) {
  if (Test-PageNoise $text) { return $false }
  if ($text -match '^(메일\s*쓰기|네이버|NAVER|Gmail|Chrome|Edge|받은|보낸|답장|전달|삭제|이동|목록|더\s*보기)') { return $false }
  if ($text -match '@|https?://') { return $false }
  if ($text.Length -lt 2 -or $text.Length -gt 200) { return $false }
  return $true
}

function Get-NaverRecipientFromEmails([string[]]$emails) {
  $uniq = @($emails | Where-Object { $_ } | Select-Object -Unique)
  foreach ($e in $uniq) {
    if ($e -notmatch '@naver\.com$') { return $e.ToLower() }
  }
  if ($uniq.Count -gt 0) { return $uniq[$uniq.Count - 1].ToLower() }
  return ''
}

function Parse-NaverDonePage($documents, $sentRows) {
  $emails = @()
  foreach ($doc in @($documents | Where-Object { $_ })) {
    foreach ($m in $emailRe.Matches($doc)) { $emails += $m.Value }
  }
  foreach ($row in @($sentRows | Where-Object { $_ })) {
    foreach ($m in $emailRe.Matches($row)) { $emails += $m.Value }
  }
  $recipient = Get-NaverRecipientFromEmails $emails
  return @{ recipient = $recipient; subject = ''; bodyPreview = ''; attachments = @() }
}

function Parse-NaverReadMail($documents) {
  $recipient = ''
  $subject = ''
  $body = ''
  $attachments = [System.Collections.Generic.List[string]]@()

  $docs = @($documents | Where-Object { $_ -and -not (Test-IsUrlLike $_) -and $_.Length -gt 15 } | Sort-Object { $_.Length } -Descending)
  if ($docs.Count -eq 0) {
    return @{ recipient = $recipient; subject = $subject; bodyPreview = $body; attachments = @() }
  }

  $lines = @($docs[0] -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not (Test-IsUrlLike $_) })
  $labelRe = '^(보낸\s*사람|받는\s*사람|참조|숨은\s*참조|날짜|첨부|파일|미리보기|답장|전체\s*답장|전달|삭제|이동|더\s*보기|목록|이전|다음|PC|다운로드|저장|MYBOX|취소)$'
  $pastHeader = $false
  $pastAttach = $false
  $bodyLines = [System.Collections.Generic.List[string]]@()

  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if (Test-PageNoise $line) { continue }

    if ($line -match '받는\s*사람') {
      for ($j = $i + 1; $j -lt [Math]::Min($i + 4, $lines.Count); $j++) {
        if ($lines[$j] -match '@') {
          $recipient = $emailRe.Match($lines[$j]).Value.ToLower()
          break
        }
      }
      $pastHeader = $true
      continue
    }

    if (-not $subject -and $i -lt 10 -and (Test-NaverSubjectCandidate $line)) {
      $subject = $line
      continue
    }

    if ($line -match $ATTACH_PATTERN -or ($line -match '\.(txt|pdf|docx?|xlsx?|pptx?|hwp|hwpx|zip|png|jpe?g|gif)\b' -and $line.Length -le 120)) {
      $fn = ($line -replace '\s+\d+(\.\d+)?\s*(KB|MB|GB|bytes?).*$','').Trim()
      if ($fn.Length -ge 3 -and $fn.Length -le 120 -and -not (Test-PageNoise $fn)) {
        [void]$attachments.Add($fn)
      }
      $pastAttach = $true
      continue
    }

    if ($line -match $labelRe) { continue }
    if ($line -match '^\d{4}년') { $pastHeader = $true; continue }
    if ($line -match '@|<[^>]+>') { continue }
    if ($line -match '^(쪽지|일반|중요|읽음|안읽음)$') { continue }

    if (($pastHeader -or $pastAttach) -and $line.Length -ge 1 -and $line.Length -le 500) {
      [void]$bodyLines.Add($line)
    }
  }

  if ($bodyLines.Count -gt 0) {
    $body = ($bodyLines | Select-Object -First 8) -join "`n"
  }

  return @{
    recipient = $recipient
    subject = $subject
    bodyPreview = $body
    attachments = @($attachments | Select-Object -Unique)
  }
}

function Parse-NaverFromSentRows([string[]]$sentRows, [string]$title) {
  $recipient = ''
  $subject = ''
  $body = ''
  $attachments = [System.Collections.Generic.List[string]]@()

  $allText = ($sentRows -join ' ')
  $emails = @()
  foreach ($m in $emailRe.Matches($allText)) { $emails += $m.Value }
  $recipient = Get-NaverRecipientFromEmails $emails

  if ($title -match '^(.+?)\s*-\s*(Chrome|Edge|Whale|Firefox)') {
    $t = $Matches[1].Trim()
    if (Test-NaverSubjectCandidate $t) { $subject = $t }
  }

  foreach ($row in @($sentRows | Where-Object { $_ })) {
    if ($row -match '^(.+\.(txt|pdf|docx?|xlsx?|pptx?|hwp|hwpx|zip|png|jpe?g|gif))(\d+(\.\d+)?(KB|MB|GB))') {
      [void]$attachments.Add($Matches[1])
      continue
    }
    if ($row -match $ATTACH_PATTERN) {
      $fn = ($row -replace '\d+(\.\d+)?\s*(KB|MB|GB).*$','').Trim()
      if ($fn.Length -ge 3 -and $fn.Length -le 120) { [void]$attachments.Add($fn) }
    }
  }

  foreach ($row in @($sentRows | Where-Object { $_ -and -not (Test-NaverNoiseRow $_) })) {
    if (-not $body -and $row.Length -ge 1 -and $row.Length -le 20 -and $row -notmatch '@|\.com|\.txt|KB|MB|메일|네이버|받은|보낸|답장|전달|가계|Keep|MYBOX|주소|캘린|메모|Works|수신|확인|임시|선택|펼침|닫기') {
      if ($row -match '^[ㅇㅆㅎㅏㅂㅈㄷㄱㄴㅁㅇ]{2,}$' -or ($row -match '^(.)\1{1,}$')) {
        $body = $row
      }
    }
  }

  if (-not $subject -and $allText -match '메일\s*제목\s*([^\s].{1,80})') {
    $cand = ($Matches[1] -replace '(새\s*창|메일\s*보기|전체|받은|보낸).*$','').Trim()
    if (Test-NaverSubjectCandidate $cand) { $subject = $cand }
  }

  return @{
    recipient = $recipient
    subject = $subject
    bodyPreview = $body
    attachments = @($attachments | Select-Object -Unique)
  }
}

function Merge-NaverFields($a, $b) {
  if (-not $a) { return $b }
  if (-not $b) { return $a }
  $subA = [string]$a.subject
  $subB = [string]$b.subject
  $bodyA = [string]$a.bodyPreview
  $bodyB = [string]$b.bodyPreview
  return @{
    recipient = $(if ($b.recipient) { $b.recipient } elseif ($a.recipient) { $a.recipient } else { '' })
    subject = $(if ($subB -and $subB.Length -ge $subA.Length) { $subB } elseif ($subA) { $subA } else { $subB })
    bodyPreview = $(if ($bodyB -and $bodyB.Length -ge $bodyA.Length) { $bodyB } elseif ($bodyA) { $bodyA } else { $bodyB })
    attachments = @((@($a.attachments) + @($b.attachments)) | Select-Object -Unique)
  }
}

function Parse-MailComposeFields($edits, $documents) {
  $recipients = @()
  $subject = ''
  $body = ''
  $cleanEdits = @($edits | Where-Object { $_ -and -not (Test-IsUrlLike $_) })
  foreach ($e in $cleanEdits) {
    if ($e -match '@') {
      foreach ($m in $emailRe.Matches($e)) { $recipients += $m.Value.ToLower() }
    } elseif (-not $subject -and $e.Length -le 220 -and $e.Length -ge 1) {
      $subject = $e
    }
  }
  $docs = @($documents | Where-Object { $_ -and -not (Test-IsUrlLike $_) })
  if ($docs.Count -gt 0) {
    $body = ($docs | Sort-Object { $_.Length } -Descending | Select-Object -First 1)
  }
  return @{ recipients = @($recipients | Select-Object -Unique); subject = $subject; bodyPreview = $body }
}

function Get-TextValue($element) {
  try {
    $vp = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($vp) { return [string]$vp.Current.Value }
  } catch {}
  try {
    $tp = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
    if ($tp) {
      $limit = if ($Mode -eq 'Signal') { 800 } else { 12000 }
      $txt = $tp.DocumentRange.GetText($limit)
      if ($txt) { return [string]$txt }
    }
  } catch {}
  return ''
}

function Walk-Tree($element, [int]$depth, $bag) {
  if ($depth -gt $MAX_DEPTH -or $bag.NodeCount -ge $MAX_NODES) { return }
  $bag.NodeCount++

  $ctrl = $element.Current.ControlType.ProgrammaticName
  $name = [string]$element.Current.Name

  if (Test-IsOmnibarName $name) {
    $val = Get-TextValue $element
    if ($val -and $val.Trim().Length -gt 0) {
      $bag.BrowserUrl = $val.Trim()
    }
    return
  }

  if ($Mode -eq 'Full' -and ($ctrl -eq 'ControlType.Edit' -or $ctrl -eq 'ControlType.ComboBox')) {
    $val = Get-TextValue $element
    if ($val -and $val.Trim().Length -gt 0 -and -not (Test-IsUrlLike $val)) {
      [void]$bag.Edits.Add($val.Trim())
    }
  }

  if ($depth -gt 0 -and $name -and ($name -match $GMAIL_COMPOSE_RE -or $name -match $GROUPWARE_COMPOSE_RE)) { $bag.HasComposePopup = $true }

  if ($ctrl -eq 'ControlType.Document') {
    $val = Get-TextValue $element
    if ($val -and $val.Trim().Length -gt 8 -and -not (Test-IsUrlLike $val)) {
      [void]$bag.Documents.Add($val.Trim())
      if ($val -match $SUCCESS_DOC_RE) { $bag.IsSuccessPage = $true }
    }
  }

  if ($ctrl -eq 'ControlType.Text' -or $ctrl -eq 'ControlType.StatusBar') {
    $text = $name
    if (-not $text -or $text.Length -lt 2) { $text = Get-TextValue $element }
    if ($text -and $text.Trim().Length -ge 2 -and $text.Length -le 300 -and -not (Test-IsUrlLike $text)) {
      if ($text -match $SEND_TOAST_RE) {
        $bag.IsSendToast = $true
        [void]$bag.ToastTexts.Add($text.Trim())
      }
    }
  }

  if ($Mode -eq 'Full' -and ($ctrl -eq 'ControlType.ListItem' -or $ctrl -eq 'ControlType.DataItem' -or $ctrl -eq 'ControlType.Text' -or $ctrl -eq 'ControlType.TableItem')) {
    $text = $name
    if (-not $text -or $text.Length -lt 2) { $text = Get-TextValue $element }
    if ($text -and $text.Trim().Length -ge 2 -and $text.Length -le 300 -and -not (Test-IsUrlLike $text)) {
      if ($text -match $ATTACH_PATTERN) {
        [void]$bag.AttachmentNames.Add($text.Trim())
      } elseif ($ctrl -match 'ListItem|DataItem|TableItem' -or ($ctrl -eq 'ControlType.Text' -and $text -match '@')) {
        [void]$bag.SentRows.Add($text.Trim())
      }
    }
  }

  if ($Mode -eq 'Full' -and $ctrl -match 'Button') {
    $nameLower = $name.ToLowerInvariant()
    if ($nameLower -match '^send$|send message|send mail') { $bag.HasSendButton = $true }
    $sendKr = -join @([char]0xBCF4, [char]0xB4DC, [char]0xAE30)
    if ($name -eq $sendKr) { $bag.HasSendButton = $true }
  }

  $children = $element.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($child in $children) {
    Walk-Tree $child ($depth + 1) $bag
  }
}

function Map-Fields($bag, [string]$title, [string]$browserUrl, [bool]$isNaverSentFolder, [bool]$isComposeMode, [bool]$isNaverReadMail, [bool]$isNaverSendDone) {
  $recipients = @()
  $subject = ''
  $body = ''
  $attachments = [System.Collections.Generic.List[string]]@()
  $naverFirst = $null

  foreach ($doc in $bag.Documents) {
    foreach ($m in $emailRe.Matches($doc)) { $recipients += $m.Value.ToLower() }
  }

  if ($Mode -eq 'Full') {
    $edits = @($bag.Edits | Where-Object { -not (Test-IsUrlLike $_) } | Select-Object -Unique)
    foreach ($e in $edits) {
      if ($e -match '@') {
        foreach ($m in $emailRe.Matches($e)) { $recipients += $m.Value.ToLower() }
      } elseif (-not $subject -and $e.Length -le 220) { $subject = $e }
    }
  }

  $sentRows = @($bag.SentRows | Where-Object { -not (Test-IsUrlLike $_) } | Select-Object -Unique)

  if ($isNaverReadMail -or ($isNaverSentFolder -and $browserUrl -match 'mail\.naver')) {
    $read = $null
    if ($bag.Documents.Count -gt 0) {
      $read = Parse-NaverReadMail @($bag.Documents)
    }
    $fromRows = Parse-NaverFromSentRows $sentRows $title
    $merged = Merge-NaverFields $read $fromRows
    if ($merged.recipient) { $recipients = @($merged.recipient) }
    if ($merged.subject) { $subject = $merged.subject }
    if ($merged.bodyPreview) { $body = $merged.bodyPreview }
    foreach ($a in $merged.attachments) { [void]$attachments.Add($a) }
  }
  elseif ($isNaverSendDone) {
    $done = Parse-NaverDonePage @($bag.Documents) $sentRows
    if ($done.recipient) { $recipients = @($done.recipient) }
  }

  if ($isComposeMode -and $Mode -eq 'Full' -and -not $isNaverReadMail) {
    $composeFields = Parse-MailComposeFields @($bag.Edits) @($bag.Documents)
    if ($composeFields.recipients.Count -gt 0) { $recipients = @($composeFields.recipients) }
    if ($composeFields.subject) { $subject = $composeFields.subject }
    if ($composeFields.bodyPreview) { $body = $composeFields.bodyPreview }
  }

  if ($isNaverSentFolder -and -not $isNaverReadMail -and $sentRows.Count -gt 0 -and -not $recipients.Count) {
    $naverFirst = Parse-NaverSentFirst $sentRows
    if ($naverFirst.recipient) { $recipients = @($naverFirst.recipient) }
    if ($naverFirst.subject) { $subject = $naverFirst.subject }
  } elseif ($sentRows.Count -gt 0 -and -not $isNaverReadMail -and -not ($isNaverSentFolder -and $browserUrl -match 'mail\.naver')) {
    $first = $sentRows | Where-Object { -not (Test-NaverNoiseRow $_) } | Select-Object -First 1
    if ($first -match '@') {
      $recipients += $emailRe.Match($first).Value.ToLower()
    } elseif (-not $subject -and $first.Length -le 220) {
      $subject = $first
    }
  }

  $docs = @($bag.Documents | Where-Object { -not (Test-IsUrlLike $_) -and -not (Test-PageNoise $_) })
  if ($docs.Count -gt 0 -and -not $body -and -not $isNaverReadMail) {
    $body = ($docs | Sort-Object { $_.Length } -Descending | Select-Object -First 1)
  }

  if ($bag.IsSuccessPage -and $docs.Count -gt 0 -and -not $isNaverReadMail) {
    foreach ($doc in $docs) {
      $lines = @($doc -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not (Test-IsUrlLike $_) })
      foreach ($line in $lines) {
        if ($line -match $SUCCESS_DOC_RE) { continue }
        if ($line -match '@') {
          foreach ($m in $emailRe.Matches($line)) { $recipients += $m.Value.ToLower() }
        } elseif (-not $subject -and $line.Length -ge 2 -and $line.Length -le 200) {
          $subject = $line
        } elseif (-not $body -and $line.Length -gt 10) {
          $body = $line
        }
      }
    }
  }

  if ($title -and -not $subject) {
    $parts = @($title -split ' - ' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($parts.Count -ge 1 -and (Test-NaverSubjectCandidate $parts[0])) {
      $subject = $parts[0]
    } elseif ($parts.Count -ge 2 -and -not (Test-IsUrlLike $parts[0]) -and $parts[0] -notmatch '^(Gmail|NAVER|Daum|Chrome|Edge|Whale|메일|네이버|받은|보낸)') {
      $subject = $parts[0]
    }
  }

  foreach ($toast in $bag.ToastTexts) {
    if ($toast -match $SEND_TOAST_RE -and -not $subject) {
      foreach ($line in ($toast -split "`r?`n")) {
        $line = $line.Trim()
        if ($line -match '@') {
          foreach ($m in $emailRe.Matches($line)) { $recipients += $m.Value.ToLower() }
        } elseif ($line.Length -ge 2 -and $line.Length -le 200 -and $line -notmatch $SEND_TOAST_RE) {
          if (-not $subject) { $subject = $line }
        }
      }
    }
  }

  if ($body.Length -gt 800) { $body = $body.Substring(0, 800) + '...' }

  foreach ($a in $bag.AttachmentNames) {
    if (-not (Test-IsUrlLike $a)) { [void]$attachments.Add($a) }
  }

  return @{
    recipients    = @($recipients | Select-Object -Unique)
    subject       = $subject
    bodyPreview   = $body
    attachments   = @($attachments | Select-Object -Unique)
    sentRows      = $sentRows
    naverFirstMail = $naverFirst
    sendToastTexts = @($bag.ToastTexts | Select-Object -Unique)
  }
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition
)

$out = @()

foreach ($win in $windows) {
  try {
    $title = [string]$win.Current.Name
    if (-not $title -or $title.Length -lt 2) { continue }

    $procId = $win.Current.ProcessId
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    $procName = $proc.ProcessName.ToLower()
    if ($BROWSER -notcontains $procName) { continue }

    $titleLower = $title.ToLowerInvariant()

    $bag = [PSCustomObject]@{
      NodeCount       = 0
      Edits           = [System.Collections.Generic.List[string]]@()
      Documents       = [System.Collections.Generic.List[string]]@()
      AttachmentNames = [System.Collections.Generic.List[string]]@()
      SentRows        = [System.Collections.Generic.List[string]]@()
      HasSendButton   = $false
      IsSuccessPage   = $false
      HasComposePopup = $false
      IsSendToast = $false
      ToastTexts      = [System.Collections.Generic.List[string]]@()
      BrowserUrl      = ''
    }

    Walk-Tree $win 0 $bag

    $pageUrl = $bag.BrowserUrl
    $docHay = ($bag.Documents -join "`n")
    $isMailWindow = (
      $titleLower -match 'mail|gmail|outlook|inbox|compose|sent|naver|nmail|daum|hanmail|daou|office|webmail|편지|메일|네이버' -or
      $title -match 'mail\.(naver|google)|daouoffice\.com' -or
      $pageUrl -match 'mail\.(naver|google)|daouoffice\.com.*/mail|#inbox|#sent|/v2/read|/v2/folders?' -or
      $docHay -match '받는\s*사람|보낸\s*사람|메일을\s*성공'
    )
    if (-not $isMailWindow) { continue }

    $isGroupware = ($pageUrl -match 'daouoffice\.com' -or $title -match 'daou|다우|oksooht')
    $isGroupwarePopup = ($pageUrl -match 'daouoffice\.com/mail/popup/process')
    $isGmail = ($pageUrl -match 'mail\.google\.com' -or $title -match 'Gmail|Google Mail')
    $isNaverSendDone = ($pageUrl -match 'mail\.naver\.com/v2/(new|sent)/done')
    $isNaverReadMail = (
      $pageUrl -match 'mail\.naver\.com/v2/read/' -or
      $title -match 'mail\.naver\.com/v2/read' -or
      (($pageUrl -match 'mail\.naver\.com' -or $title -match '네이버\s*메일') -and $docHay -match '받는\s*사람')
    )
    $isNaverSentFolder = ($pageUrl -match 'mail\.naver\.com/v2/folders?/1' -or $title -match '보낸\s*메일')
    $isGmailSentFolder = ($isGmail -and ($pageUrl -match '#sent' -or $title -match '보낸\s*편지|Sent Mail'))
    $isGroupwareCompose = [bool](
      $isGroupwarePopup -or
      $bag.HasComposePopup -or
      ($isGroupware -and $bag.HasSendButton -and $bag.Edits.Count -ge 1)
    )
    $isGmailCompose = [bool]($bag.HasComposePopup -or ($isGmail -and $bag.HasSendButton -and $bag.Edits.Count -ge 1))
    $isComposeMode = (-not $isNaverSendDone) -and ($isGmailCompose -or $isGroupwareCompose)
    $isSentFolder = ($isNaverSentFolder -or $isGmailSentFolder -or ($isGroupware -and $title -match '보낸\s*메일') -or ($title -match $SENT_TITLE_RE))
    $isSuccessTitle = ($title -match $SUCCESS_DOC_RE) -or $isNaverSendDone -or $bag.IsSendToast

    $fields = Map-Fields $bag $title $pageUrl $isNaverSentFolder $isComposeMode $isNaverReadMail $isNaverSendDone

    $out += [PSCustomObject]@{
      hwnd             = $win.Current.NativeWindowHandle
      title            = $title
      process          = $procName
      pageUrl          = $pageUrl
      hasSendButton    = [bool]$bag.HasSendButton
      hasComposePopup  = [bool]$isComposeMode
      isGroupwarePopup = [bool]$isGroupwarePopup
      isSendToast      = [bool]$bag.IsSendToast
      isGmailSendToast = [bool]$bag.IsSendToast
      isSuccessPage    = [bool]($bag.IsSuccessPage -or $isSuccessTitle)
      isSentFolder     = [bool]$isSentFolder
      isGmailSentFolder = [bool]$isGmailSentFolder
      isNaverSendDone  = [bool]$isNaverSendDone
      isNaverReadMail  = [bool]$isNaverReadMail
      isNaverSentFolder = [bool]$isNaverSentFolder
      sendToastTexts   = $fields.sendToastTexts
      gmailToastTexts  = $fields.sendToastTexts
      recipients       = $fields.recipients
      subject          = $fields.subject
      bodyPreview      = $fields.bodyPreview
      attachments      = $fields.attachments
      sentRows         = $fields.sentRows
      naverFirstMail   = $fields.naverFirstMail
    }
  } catch {}
}

@{ mode = $Mode; windows = $out; at = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Depth 6 -Compress
