$ErrorActionPreference = 'Continue'
Write-Host '=== USB Recovery Start ==='

$vol = Get-Volume | Where-Object { $_.DriveType -eq 'Removable' -and -not $_.DriveLetter }
if (-not $vol) {
    $vol = Get-Volume | Where-Object { $_.Path -like '*e9d78048-a7fe-11ef-956d-244bfe8ba3aa*' }
}

if ($vol) {
    Write-Host "Found volume: $($vol.Path) Size=$($vol.Size)"
    $part = Get-Partition | Where-Object { $_.AccessPaths -contains $vol.Path }
    if (-not $part) {
        $part = Get-Partition -DiskNumber 2 -PartitionNumber 1 -ErrorAction SilentlyContinue
    }
    if ($part) {
        Write-Host "Partition Disk=$($part.DiskNumber) Part=$($part.PartitionNumber)"
        foreach ($c in 69..90) {
            $letter = [char]$c
            if (Get-Volume -DriveLetter $letter -ErrorAction SilentlyContinue) { continue }
            try {
                Set-Partition -InputObject $part -NewDriveLetter $letter -ErrorAction Stop
                Write-Host "SUCCESS: Assigned ${letter}:"
                Get-Volume -DriveLetter $letter | Format-List DriveLetter,FileSystem,Size
                exit 0
            } catch {
                Write-Host "Set-Partition ${letter}: failed - $($_.Exception.Message)"
            }
        }
        # mountvol fallback
        $volPath = $vol.Path
        if ($volPath) {
            foreach ($c in 69..90) {
                $letter = [char]$c
                if (Test-Path "${letter}:\") { continue }
                $r = cmd /c "mountvol ${letter}: $volPath" 2>&1
                Write-Host "mountvol ${letter}: $r"
                if (Test-Path "${letter}:\") {
                    Write-Host "SUCCESS mountvol ${letter}:"
                    exit 0
                }
            }
        }
    }
}

Write-Host '=== Trying diskpart ==='
$dp = @"
select disk 2
select partition 1
assign letter=E
exit
"@
$dp | diskpart

Start-Sleep -Seconds 2
if (Test-Path 'E:\') {
    Write-Host 'SUCCESS: E:\ exists'
    Get-Volume -DriveLetter E | Format-List
    exit 0
}

Write-Host 'FAILED - need admin rights'
exit 1
