# Converts a .docx to .pdf with the Microsoft Word installed on this computer (local; nothing leaves the machine).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File docx_to_pdf.ps1 <input.docx> <output.pdf>
# Exit codes: 0 ok, 2 Word not installed, 3 conversion failed. Messages never include document content.
param([Parameter(Mandatory = $true)][string]$In, [Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
try { $word = New-Object -ComObject Word.Application } catch { [Console]::Error.WriteLine('word not installed'); exit 2 }
$doc = $null
try {
  $word.Visible = $false
  $word.DisplayAlerts = 0
  # ReadOnly, no conversion prompt, not added to recent files
  $doc = $word.Documents.Open($In, $false, $true, $false)
  # 17 = wdExportFormatPDF; optimise for print; no document properties (author etc.); structure tags for accessibility
  $doc.ExportAsFixedFormat($Out, 17, $false, 0, 0, 1, 1, 0, $false, $true, 1, $true, $true, $false)
  exit 0
} catch {
  [Console]::Error.WriteLine('pdf conversion failed: ' + $_.Exception.GetType().Name)
  exit 3
} finally {
  if ($doc) { $doc.Close(0) | Out-Null }
  $word.Quit() | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
