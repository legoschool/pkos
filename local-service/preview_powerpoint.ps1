param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
$sourcePath=[IO.Path]::GetFullPath($Source)
$destinationPath=[IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw 'Source file does not exist' }
if ([IO.Path]::GetExtension($sourcePath).ToLowerInvariant() -notin @('.ppt','.pptx','.pps','.ppsx','.odp')) { throw 'Unsupported presentation type' }
if ([IO.Path]::GetExtension($destinationPath).ToLowerInvariant() -ne '.pdf') { throw 'Output must be a PDF' }
if (Test-Path -LiteralPath $destinationPath) { throw 'Destination already exists' }
if (Get-Process POWERPNT -ErrorAction SilentlyContinue) { throw 'PowerPoint is in use; retry after finishing your work' }
function Source-Hash([string]$Path) {
 $stream=[IO.File]::OpenRead($Path);$sha=[Security.Cryptography.SHA256]::Create()
 try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') } finally { $stream.Dispose();$sha.Dispose() }
}
$before=Source-Hash $sourcePath
$parent=[IO.Path]::GetDirectoryName($destinationPath)
if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'Output folder does not exist' }
$temporary=Join-Path $parent ('.pkos-preview-'+[Guid]::NewGuid().ToString('N')+'.pdf')
$app=$null;$presentation=$null;$oldSecurity=$null;$oldAlerts=$null
try {
 $app=New-Object -ComObject PowerPoint.Application
 if ($app.Presentations.Count -ne 0) { throw 'Another presentation is open' }
 $oldSecurity=$app.AutomationSecurity;$oldAlerts=$app.DisplayAlerts
 $app.AutomationSecurity=3;$app.DisplayAlerts=1
 # ReadOnly=true, Untitled=true (copy), WithWindow=false.
 $presentation=$app.Presentations.Open($sourcePath,-1,-1,0)
 $slides=$presentation.Slides.Count
 $presentation.SaveAs($temporary,32)
 $presentation.Saved=-1;$presentation.Close()
 [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation);$presentation=$null
 if ((Source-Hash $sourcePath) -ne $before) { throw 'Source changed during conversion' }
 $stream=[IO.File]::OpenRead($temporary)
 try { $header=New-Object byte[] 5;if ($stream.Read($header,0,5) -ne 5 -or [Text.Encoding]::ASCII.GetString($header) -ne '%PDF-') { throw 'Invalid PDF output' } } finally { $stream.Dispose() }
 [IO.File]::Move($temporary,$destinationPath)
 @{converted=$true;slides=$slides;sourceHash=$before;bytes=(Get-Item -LiteralPath $destinationPath).Length} | ConvertTo-Json -Compress
} finally {
 if ($presentation) { try { $presentation.Saved=-1;$presentation.Close() } catch {};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) }
 if ($app) {
  if ($null -ne $oldSecurity) { try { $app.AutomationSecurity=$oldSecurity;$app.DisplayAlerts=$oldAlerts } catch {} }
  # Leave presentations opened by the user during conversion untouched.
  try { if ($app.Presentations.Count -eq 0) { $app.Quit() } } catch {}
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
 }
 if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
 [GC]::Collect();[GC]::WaitForPendingFinalizers()
}
