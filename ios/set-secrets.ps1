# Saves the App Store Connect API key as GitHub secrets so the iOS workflow can upload to TestFlight.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File ios\set-secrets.ps1
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
$repo = 'ramonmm3/freerope'
$key = Get-ChildItem "$env:USERPROFILE\Downloads\AuthKey_*.p8" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $key) { Write-Host 'No AuthKey_*.p8 in Downloads. Download the key from App Store Connect first.'; exit 1 }
$keyId = $key.BaseName -replace '^AuthKey_', ''
Write-Host "Using $($key.Name) (Key ID $keyId)"
$issuer = Read-Host 'Paste the Issuer ID (shown above the keys list)'
Get-Content $key.FullName -Raw | & $gh secret set ASC_KEY_P8 -R $repo
& $gh secret set ASC_KEY_ID -R $repo -b $keyId
& $gh secret set ASC_ISSUER_ID -R $repo -b $issuer.Trim()
& $gh secret list -R $repo
Write-Host 'Done. You can delete the .p8 from Downloads once a build has uploaded (keep a backup somewhere private).'
