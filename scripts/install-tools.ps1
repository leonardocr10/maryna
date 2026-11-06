# Installs Node.js 22 LTS and/or Python 3.12 for the current user, without winget and without administrator rights
# (works on Windows Server). Files come only from nodejs.org and python.org and are checked before use:
# Node by the official SHA-256 list, Python by its Python Software Foundation digital signature.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-tools.ps1 -Node -Python
# Node goes to %LOCALAPPDATA%\Programs\nodejs, Python to %LOCALAPPDATA%\Programs\Python\Python312.
# Both folders are added to the user's PATH. Exit code 0 = everything requested is installed.
# -CheckOnly (for tests): downloads and verifies, then stops before installing or touching PATH.
param([switch]$Node, [switch]$Python, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is many times faster without the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$arm = $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64'
$work = Join-Path $env:TEMP ('neurolaudos-setup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$programs = Join-Path $env:LOCALAPPDATA 'Programs'
New-Item -ItemType Directory -Force -Path $programs | Out-Null

function Add-UserPath([string]$dir) {
  if ($env:NL_SKIP_USER_PATH -eq '1') { return }   # tests only
  # Edits the registry value directly so entries such as %USERPROFILE%bin keep working (type and raw text preserved).
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  try {
    $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
    $parts = @($raw -split ';' | Where-Object { $_ })
    if ($parts -notcontains $dir) { $key.SetValue('Path', ((@($dir) + $parts) -join ';'), $kind) }
  } finally { $key.Close() }
}

$failed = $false
try {
  if ($Node) {
    try {
      $base = 'https://nodejs.org/dist/latest-v22.x/'
      $want = if ($arm) { 'win-arm64.zip' } else { 'win-x64.zip' }
      Write-Host 'Baixando o Node.js 22 (nodejs.org)...'
      $sums = (Invoke-WebRequest -UseBasicParsing ($base + 'SHASUMS256.txt')).Content -split "`n"
      $line = $sums | Where-Object { $_ -match ('\s(node-v22\.\d+\.\d+-' + [regex]::Escape($want) + ')\s*$') } | Select-Object -First 1
      if (-not $line) { throw 'versão do Node não encontrada na lista oficial' }
      $hash, $file = ($line.Trim() -split '\s+')
      $zip = Join-Path $work $file
      Invoke-WebRequest -UseBasicParsing ($base + $file) -OutFile $zip
      if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $hash.ToUpper()) { throw 'arquivo do Node com conferência (SHA-256) diferente da oficial' }
      if ($CheckOnly) { Write-Host "Node conferido: $file (SHA-256 ok)" } else {
      Write-Host 'Instalando o Node.js...'
      Expand-Archive -Path $zip -DestinationPath $work -Force
      $dest = Join-Path $programs 'nodejs'
      if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
      Move-Item (Join-Path $work ($file -replace '\.zip$', '')) $dest
      Add-UserPath $dest
      & (Join-Path $dest 'node.exe') -v | Out-Null
      Write-Host "Node.js instalado em $dest" }
    } catch { Write-Host "Falha ao instalar o Node.js: $($_.Exception.Message)"; $failed = $true }
  }
  if ($Python) {
    try {
      $ver = '3.12.10'
      $file = if ($arm) { "python-$ver-arm64.exe" } else { "python-$ver-amd64.exe" }
      Write-Host "Baixando o Python $ver (python.org)..."
      $exe = Join-Path $work $file
      Invoke-WebRequest -UseBasicParsing "https://www.python.org/ftp/python/$ver/$file" -OutFile $exe
      $sig = Get-AuthenticodeSignature $exe
      if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Python Software Foundation') { throw 'assinatura digital do instalador do Python inválida' }
      if ($CheckOnly) { Write-Host "Python conferido: $file (assinatura: $($sig.SignerCertificate.Subject -replace ',.*',''))" } else {
      Write-Host 'Instalando o Python (só para este usuário)...'
      $pyArgs = '/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 InstallLauncherAllUsers=0 Include_test=0 Include_doc=0 Shortcuts=0'
      $p = Start-Process -FilePath $exe -ArgumentList $pyArgs -Wait -PassThru
      if ($p.ExitCode -ne 0) { throw "instalador terminou com código $($p.ExitCode)" }
      $py = Join-Path $programs 'Python\Python312\python.exe'
      if (-not (Test-Path $py)) { throw 'python.exe não encontrado após a instalação' }
      Write-Host "Python instalado em $(Split-Path $py)" }
    } catch { Write-Host "Falha ao instalar o Python: $($_.Exception.Message)"; $failed = $true }
  }
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
if ($failed) { exit 1 } else { exit 0 }

