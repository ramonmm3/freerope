# Saves the App Store Connect API key as GitHub secrets so the iOS workflow can upload to TestFlight.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File C:\Crossrope\web\ios\set-secrets.ps1
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
$repo = 'ramonmm3/freerope'
$key = Get-ChildItem "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Documents" -Filter 'AuthKey_*.p8' -Recurse -Depth 2 -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $key) {
  Add-Type -AssemblyName System.Windows.Forms
  $pick = New-Object System.Windows.Forms.OpenFileDialog -Property @{ Title = 'Pick the AuthKey_XXXX.p8 you downloaded from App Store Connect'; Filter = 'API key (*.p8)|*.p8' }
  if ($pick.ShowDialog() -ne 'OK') { Write-Host 'No key picked.'; exit 1 }
  $key = Get-Item $pick.FileName
}
$keyId = $key.BaseName -replace '^AuthKey_', ''
Write-Host "Using $($key.Name) (Key ID $keyId)"
$issuer = 'e0a663a1-ef5f-4ee2-a223-7a111952f157' # Issuer ID shown above the team keys list (not secret)
Get-Content $key.FullName -Raw | & $gh secret set ASC_KEY_P8 -R $repo
& $gh secret set ASC_KEY_ID -R $repo -b $keyId
& $gh secret set ASC_ISSUER_ID -R $repo -b $issuer.Trim()
& $gh secret list -R $repo
Write-Host 'Done. You can delete the .p8 from Downloads once a build has uploaded (keep a backup somewhere private).'
