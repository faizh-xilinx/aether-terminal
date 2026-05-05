#!/usr/bin/env pwsh
# Generates a 1024x1024 placeholder app icon using System.Drawing.
# Replace assets/icon.png with your real icon any time, then re-run `npm run icons`.

param(
  [string]$OutPath = "$PSScriptRoot/../assets/icon.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp  = New-Object System.Drawing.Bitmap $size, $size
$gfx  = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Background gradient (midnight)
$rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$top    = [System.Drawing.Color]::FromArgb(255, 16, 21, 32)
$bottom = [System.Drawing.Color]::FromArgb(255, 7, 11, 18)
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $top, $bottom, 90
$gfx.FillRectangle($grad, $rect)

# Accent radial glow
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath
$glow.AddEllipse((New-Object System.Drawing.Rectangle (-200), (-200), 800, 800))
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $glow
$pgb.CenterColor = [System.Drawing.Color]::FromArgb(70, 124, 154, 255)
$pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 124, 154, 255))
$gfx.FillPath($pgb, $glow)

# Rounded square card
$card = New-Object System.Drawing.Drawing2D.GraphicsPath
$radius = 220
$inset  = 80
$x = $inset; $y = $inset; $w = $size - 2*$inset; $h = $size - 2*$inset
$card.AddArc($x, $y, $radius, $radius, 180, 90)
$card.AddArc($x + $w - $radius, $y, $radius, $radius, 270, 90)
$card.AddArc($x + $w - $radius, $y + $h - $radius, $radius, $radius, 0, 90)
$card.AddArc($x, $y + $h - $radius, $radius, $radius, 90, 90)
$card.CloseFigure()
$cardBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 26, 31, 42))
$gfx.FillPath($cardBrush, $card)

$borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(180, 124, 154, 255)), 6
$gfx.DrawPath($borderPen, $card)

# Stylised glyph "A>" – terminal prompt fused with the brand letter
$accent = [System.Drawing.Color]::FromArgb(255, 124, 154, 255)
$accentBrush = New-Object System.Drawing.SolidBrush $accent

$fontFamilies = @("JetBrains Mono", "Cascadia Code", "Consolas", "Segoe UI")
$family = $null
foreach ($name in $fontFamilies) {
  try { $family = New-Object System.Drawing.FontFamily $name; break } catch {}
}
if (-not $family) { $family = [System.Drawing.FontFamily]::GenericMonospace }

$font = New-Object System.Drawing.Font $family, 460, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment     = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect2 = New-Object System.Drawing.RectangleF 0, 30, $size, $size
$gfx.DrawString("A", $font, $accentBrush, $rect2, $sf)

# Underline (cursor caret)
$caret = New-Object System.Drawing.Rectangle 360, 760, 304, 36
$caretBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 124, 154, 255))
$gfx.FillRectangle($caretBrush, $caret)

$dir = Split-Path -Parent $OutPath
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)

$gfx.Dispose()
$bmp.Dispose()
Write-Host "Wrote placeholder icon: $OutPath"
