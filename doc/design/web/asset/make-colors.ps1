# 从 tokens.json 生成人类可读的色卡 PNG。
#
#   pwsh -File make-colors.ps1
#
# tokens.json 由仓库根的 DESIGN.md 导出（见 doc/design/index.md 的同步规则）。

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$tokensPath = Join-Path $here "design.tokens.json"
$outPath = Join-Path $here "colors.png"

$doc = Get-Content $tokensPath -Raw -Encoding UTF8 | ConvertFrom-Json

# 按令牌文件里的顺序取出颜色令牌，跳过 $ 开头的保留字段
$items = @()
foreach ($prop in $doc.color.PSObject.Properties) {
  if ($prop.Name.StartsWith('$')) { continue }
  $v = $prop.Value.'$value'
  $r = [int][Math]::Round($v.components[0] * 255)
  $g = [int][Math]::Round($v.components[1] * 255)
  $b = [int][Math]::Round($v.components[2] * 255)
  $alpha = if ($null -ne $v.alpha) { $v.alpha } else { 1 }
  $items += [pscustomobject]@{
    Name  = $prop.Name
    R     = $r
    G     = $g
    B     = $b
    Alpha = $alpha
    Hex   = $v.hex
  }
}

# 版面
$cols = 6
$rows = [int][Math]::Ceiling($items.Count / $cols)
$margin = 48
$swatch = 200
$gap = 24
$labelH = 56
$titleH = 120
$cardBg = [System.Drawing.Color]::FromArgb(255, 255, 255)
$ink = [System.Drawing.Color]::FromArgb(255, 24, 24, 27)
$muted = [System.Drawing.Color]::FromArgb(255, 113, 113, 122)
$line = [System.Drawing.Color]::FromArgb(255, 222, 222, 224)

$width = ($margin * 2) + ($cols * $swatch) + (($cols - 1) * $gap)
$height = $titleH + ($rows * ($swatch + $labelH)) + (($rows - 1) * $gap) + $margin

$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$g.Clear($cardBg)

$titleFont = New-Object System.Drawing.Font "Segoe UI Semibold", 22
$subFont = New-Object System.Drawing.Font "Segoe UI", 11
$nameFont = New-Object System.Drawing.Font "Segoe UI Semibold", 11
$hexFont = New-Object System.Drawing.Font "Consolas", 11
$inkBrush = New-Object System.Drawing.SolidBrush $ink
$mutedBrush = New-Object System.Drawing.SolidBrush $muted
$linePen = New-Object System.Drawing.Pen $line, 1

$g.DrawString("cst-pilot web - color tokens", $titleFont, $inkBrush, $margin, 44)
$g.DrawString("source: DESIGN.md", $subFont, $mutedBrush, $margin, 82)

$i = 0
foreach ($item in $items) {
  $col = $i % $cols
  $row = [int][Math]::Floor($i / $cols)
  $x = $margin + $col * ($swatch + $gap)
  $y = $titleH + $row * ($swatch + $labelH + $gap)

  $alphaByte = [int][Math]::Round($item.Alpha * 255)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($alphaByte, $item.R, $item.G, $item.B))
  $g.FillRectangle($brush, $x, $y, $swatch, $swatch)
  $g.DrawRectangle($linePen, $x, $y, $swatch, $swatch)
  $brush.Dispose()

  $g.DrawString($item.Name, $nameFont, $inkBrush, $x, $y + $swatch + 8)
  $label = if ($item.Alpha -lt 1) { "$($item.Hex)  a=$($item.Alpha)" } else { $item.Hex }
  $g.DrawString($label, $hexFont, $mutedBrush, $x, $y + $swatch + 28)

  $i++
}

$g.Dispose()
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "写入 $outPath  ($($items.Count) 个颜色, ${width}x${height})"
