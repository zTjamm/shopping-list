Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$outDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundPath {
    param([single]$x, [single]$y, [single]$w, [single]$h, [single]$r)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = [single]($r * 2)
    if ($d -gt $w) { $d = $w }
    if ($d -gt $h) { $d = $h }
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-Icon {
    param([int]$Size, [string]$FileName, [double]$Scale = 1.0)

    $S = [single]$Size
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 62, 226, 127),
        [System.Drawing.Color]::FromArgb(255, 9, 143, 86),
        45
    )
    $g.FillRectangle($bg, $rect)

    $g.TranslateTransform($S / 2, $S / 2)
    $g.ScaleTransform([single]$Scale, [single]$Scale)
    $g.TranslateTransform(-$S / 2, -$S / 2)

    # ручка пакета
    $handlePen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [single]($S * 0.039))
    $handlePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $handlePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawArc($handlePen, [single]($S * 0.412), [single]($S * 0.272), [single]($S * 0.176), [single]($S * 0.33), 180, 180)

    # корпус пакета
    $bag = New-RoundPath ([single]($S * 0.275)) ([single]($S * 0.415)) ([single]($S * 0.45)) ([single]($S * 0.395)) ([single]($S * 0.06))
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillPath($white, $bag)

    # галочка
    $checkPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 12, 146, 90), [single]($S * 0.056))
    $checkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $checkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $checkPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $points = @(
        (New-Object System.Drawing.PointF([single]($S * 0.375), [single]($S * 0.605))),
        (New-Object System.Drawing.PointF([single]($S * 0.462), [single]($S * 0.69))),
        (New-Object System.Drawing.PointF([single]($S * 0.632), [single]($S * 0.515)))
    )
    $g.DrawLines($checkPen, [System.Drawing.PointF[]]$points)

    $target = Join-Path $outDir $FileName
    $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

    $checkPen.Dispose()
    $white.Dispose()
    $bag.Dispose()
    $handlePen.Dispose()
    $bg.Dispose()
    $g.Dispose()
    $bmp.Dispose()

    Write-Output ("{0} ({1}x{1})" -f $FileName, $Size)
}

New-Icon -Size 192 -FileName 'icon-192.png'
New-Icon -Size 512 -FileName 'icon-512.png'
New-Icon -Size 180 -FileName 'icon-180.png'
New-Icon -Size 512 -FileName 'icon-maskable-512.png' -Scale 0.78
