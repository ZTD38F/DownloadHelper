#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$Base = 'https://github.com/ZTD38F/DownloadHelper/releases/download/nightly'
$Id = (Invoke-WebRequest "$Base/extension-id.txt" -UseBasicParsing).Content.Trim()
if ($Id -notmatch '^[a-p]{32}$') { throw "Invalid extension ID from release: $Id" }
$Policy = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist'
New-Item -Path $Policy -Force | Out-Null
$Existing = Get-ItemProperty -Path $Policy -ErrorAction SilentlyContinue
$slot = 1
while ($null -ne $Existing.$slot) { $slot++ }
New-ItemProperty -Path $Policy -Name "$slot" -PropertyType String -Value "$Id;$Base/updates.xml" -Force | Out-Null
Write-Host "DownloadHelper policy installed for Microsoft Edge. Extension ID: $Id"
Write-Host 'Restart Edge. Edge will install/update the signed CRX from the rolling release.'
