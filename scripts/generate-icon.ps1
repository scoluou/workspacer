# Generates src-tauri/icons/icon.ico: layered "W" glyph on a blue->violet tile
# (brand gradient from index.html: #4f8cff -> #8b5cf6), rendered per-size so
# small frames stay legible, then packed as a multi-size PNG-compressed ICO.
#
# Usage:  powershell -File scripts/generate-icon.ps1
# Self-check: re-parses the written .ico and asserts every frame decodes at
# its declared size. Exits non-zero if the output is malformed.

Add-Type -AssemblyName System.Drawing

$OutIco     = Join-Path $PSScriptRoot '..\src-tauri\icons\icon.ico'
$PreviewDir = Join-Path $env:TEMP 'workspacer-icon-preview'
New-Item -ItemType Directory -Force -Path $PreviewDir | Out-Null

# Per-size tuning: fewer layer cuts and relatively thicker strokes as it shrinks.
$Specs = @(
  @{ Size = 256; Bands = 3; Stroke = 27.0; GlyphW = 0.60; GlyphH = 0.46 },
  @{ Size = 128; Bands = 3; Stroke = 13.5; GlyphW = 0.60; GlyphH = 0.46 },
  @{ Size = 64;  Bands = 2; Stroke = 7.0;  GlyphW = 0.62; GlyphH = 0.48 },
  @{ Size = 48;  Bands = 2; Stroke = 5.4;  GlyphW = 0.62; GlyphH = 0.48 },
  @{ Size = 32;  Bands = 1; Stroke = 3.8;  GlyphW = 0.64; GlyphH = 0.50 },
  @{ Size = 24;  Bands = 1; Stroke = 3.0;  GlyphW = 0.66; GlyphH = 0.52 },
  @{ Size = 16;  Bands = 1; Stroke = 2.2;  GlyphW = 0.70; GlyphH = 0.56 }
)

$Color1 = [System.Drawing.Color]::FromArgb(0x4F, 0x8C, 0xFF)  # --accent
$Color2 = [System.Drawing.Color]::FromArgb(0x8B, 0x5C, 0xF6)  # violet

function New-RoundedRectPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Render-Frame($spec) {
  $size = $spec.Size
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # Tile: full-bleed rounded square, 135deg CSS gradient == 45deg in GDI+.
  $tile = New-RoundedRectPath 0 0 $size $size ($size * 0.185)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF(0, 0, $size, $size)), $Color1, $Color2, [single]45.0)
  $g.FillPath($brush, $tile)

  # W polyline in a normalized box, mapped to the centered glyph rect.
  $gw = $size * $spec.GlyphW; $gh = $size * $spec.GlyphH
  $gx = ($size - $gw) / 2;    $gy = ($size - $gh) / 2
  $norm = @(@(0.00, 0.02), @(0.19, 0.98), @(0.50, 0.38), @(0.81, 0.98), @(1.00, 0.02))
  $pts = @()
  foreach ($p in $norm) {
    $pts += New-Object System.Drawing.PointF([single]($gx + $p[0] * $gw), [single]($gy + $p[1] * $gh))
  }
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [single]$spec.Stroke)
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round

  # Layered look: draw the W clipped to horizontal bands with thin gaps.
  $bands = $spec.Bands
  $gap = if ($bands -ge 3) { $size * 0.022 } else { $size * 0.025 }
  $top = $gy - $spec.Stroke / 2
  $total = $gh + $spec.Stroke
  $bandH = ($total - ($bands - 1) * $gap) / $bands
  for ($i = 0; $i -lt $bands; $i++) {
    $g.SetClip((New-Object System.Drawing.RectangleF(0, [single]($top + $i * ($bandH + $gap)), $size, [single]$bandH)))
    $g.DrawLines($pen, $pts)
    $g.ResetClip()
  }

  $pen.Dispose(); $brush.Dispose(); $tile.Dispose(); $g.Dispose()
  return $bmp
}

# ---- render all sizes ----
$frames = @()
foreach ($spec in $Specs) {
  $bmp = Render-Frame $spec
  $png = New-Object System.IO.MemoryStream
  $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Save((Join-Path $PreviewDir ("icon-{0}.png" -f $spec.Size)), [System.Drawing.Imaging.ImageFormat]::Png)
  $frames += @{ Size = $spec.Size; Bytes = $png.ToArray(); Bitmap = $bmp }
  $png.Dispose()
}

# ---- pack ICO (PNG-compressed frames, Vista+) ----
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($f in $frames) {
  $bw.Write([byte]($f.Size -band 0xFF))  # 256 is stored as 0
  $bw.Write([byte]($f.Size -band 0xFF))
  $bw.Write([byte]0)                     # palette
  $bw.Write([byte]0)                     # reserved
  $bw.Write([uint16]1)                   # planes
  $bw.Write([uint16]32)                  # bpp
  $bw.Write([uint32]$f.Bytes.Length)
  $bw.Write([uint32]$offset)
  $offset += $f.Bytes.Length
}
foreach ($f in $frames) { $bw.Write($f.Bytes) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($OutIco, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()

# ---- self-check: re-parse the .ico and decode every frame ----
$bytes = [System.IO.File]::ReadAllBytes($OutIco)
$count = [BitConverter]::ToUInt16($bytes, 4)
if ($count -ne $frames.Count) { Write-Error "ICO frame count $count != $($frames.Count)"; exit 1 }
$ok = $true
for ($i = 0; $i -lt $count; $i++) {
  $eoff = 6 + $i * 16
  $declared = $bytes[$eoff]; if ($declared -eq 0) { $declared = 256 }
  $len = [BitConverter]::ToUInt32($bytes, $eoff + 8)
  $off = [BitConverter]::ToUInt32($bytes, $eoff + 12)
  $fms = New-Object System.IO.MemoryStream($bytes, $off, $len)
  $fbmp = New-Object System.Drawing.Bitmap($fms)
  $status = if ($fbmp.Width -eq $declared -and $fbmp.Height -eq $declared) { 'OK' } else { $ok = $false; 'BAD' }
  Write-Output ("frame {0}: declared {1}x{1}, decoded {2}x{3} [{4}]" -f $i, $declared, $fbmp.Width, $fbmp.Height, $status)
  $fbmp.Dispose(); $fms.Dispose()
}
if (-not $ok) { Write-Error 'ICO self-check failed'; exit 1 }

# ---- contact sheet: every size nearest-neighbor zoomed, dark + light rows ----
$zoomOf = @{}; $cellW = 0; $rowH = 0
foreach ($f in $frames) {
  $z = [Math]::Max(1, [Math]::Floor(96 / $f.Size))
  $zoomOf[$f.Size] = $z
  $cellW += $f.Size * $z + 24
  $rowH = [Math]::Max($rowH, $f.Size * $z)
}
$labelH = 26
$sheet = New-Object System.Drawing.Bitmap(($cellW + 24), (2 * ($rowH + $labelH) + 36))
$sg = [System.Drawing.Graphics]::FromImage($sheet)
$sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$font = New-Object System.Drawing.Font('Segoe UI', 9)
foreach ($row in @(0, 1)) {
  $bg = if ($row -eq 0) { [System.Drawing.Color]::FromArgb(0x1B, 0x1D, 0x21) } else { [System.Drawing.Color]::FromArgb(0xF3, 0xF4, 0xF6) }
  $fg = if ($row -eq 0) { [System.Drawing.Color]::FromArgb(0xD4, 0xD6, 0xDA) } else { [System.Drawing.Color]::FromArgb(0x33, 0x37, 0x3D) }
  $y = 12 + $row * ($rowH + $labelH + 12)
  $sg.FillRectangle((New-Object System.Drawing.SolidBrush($bg)), 0, $y - 12, $sheet.Width, $rowH + $labelH + 12)
  $x = 24
  foreach ($f in $frames) {
    $z = $zoomOf[$f.Size]; $d = $f.Size * $z
    $sg.DrawImage($f.Bitmap, (New-Object System.Drawing.Rectangle($x, $y, $d, $d)))
    $label = "$($f.Size)"
    $lw = $sg.MeasureString($label, $font).Width
    $sg.DrawString($label, $font, (New-Object System.Drawing.SolidBrush($fg)), [single]($x + ($d - $lw) / 2), [single]($y + $d + 4))
    $x += $d + 24
  }
}
$sheet.Save((Join-Path $PreviewDir 'contact-sheet.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$sg.Dispose(); $sheet.Dispose()
foreach ($f in $frames) { $f.Bitmap.Dispose() }

Write-Output "wrote $OutIco ($($bytes.Length) bytes, $count frames)"
Write-Output "previews in $PreviewDir"
