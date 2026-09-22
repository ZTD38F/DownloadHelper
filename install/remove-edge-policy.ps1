#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$Base = 'https://github.com/ZTD38F/DownloadHelper/releases/download/nightly'
$Id = (Invoke-WebRequest "$Base/extension-id.txt" -UseBasicParsing).Content.Trim()
$Policy = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist'
if (Test-Path $Policy) {
  $props = Get-ItemProperty -Path $Policy
  foreach ($p in $props.PSObject.Properties) {
    if ($p.Name -match '^\d+$' -and $p.Value -like "$Id;*") { Remove-ItemProperty -Path $Policy -Name $p.Name -Force }
  }
}
Write-Host 'DownloadHelper Edge force-install policy removed. Restart Edge.'
