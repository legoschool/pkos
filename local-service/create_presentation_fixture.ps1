param([Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference='Stop'
if (Get-Process POWERPNT -ErrorAction SilentlyContinue) { throw 'PowerPoint is in use' }
$source=[IO.Path]::GetFullPath($Target)
if (Test-Path -LiteralPath $source) { throw 'Fixture destination exists' }
$app=$null;$deck=$null
try {
 $app=New-Object -ComObject PowerPoint.Application
 if ($app.Presentations.Count -ne 0) { throw 'Another presentation is open' }
 $deck=$app.Presentations.Add(0);$slide=$deck.Slides.Add(1,12)
 $title=$slide.Shapes.AddTextbox(1,40,35,600,60);$title.TextFrame.TextRange.Text='PKOS preview test';$title.TextFrame.TextRange.Font.Size=28
 $shape=$slide.Shapes.AddShape(1,40,130,300,120);$shape.Fill.ForeColor.RGB=16711680;$shape.TextFrame.TextRange.Text='Original layout stays visible'
 $second=$deck.Slides.Add(2,12)
 $secondTitle=$second.Shapes.AddTextbox(1,40,35,600,60);$secondTitle.TextFrame.TextRange.Text='Second slide';$secondTitle.TextFrame.TextRange.Font.Size=28
 $secondShape=$second.Shapes.AddShape(1,350,160,220,130);$secondShape.Fill.ForeColor.RGB=65280
 $deck.SaveAs($source,1);$deck.Close();$deck=$null
} finally {
 if ($deck) { $deck.Saved=-1;$deck.Close() }
 if ($app) { if ($app.Presentations.Count -eq 0) { $app.Quit() };[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) }
 [GC]::Collect();[GC]::WaitForPendingFinalizers()
}
Write-Output $source
