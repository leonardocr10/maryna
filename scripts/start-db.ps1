# Banco local sem Docker e sem admin: MariaDB 11.4 portátil em .local/ (porta 3307, só 127.0.0.1).
# Uso: powershell -ExecutionPolicy Bypass -File scripts\start-db.ps1
$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $PSScriptRoot
$local   = Join-Path $root '.local'
$version = '11.4.4'
$home_   = Join-Path $local "mariadb-$version-winx64"
$bin     = Join-Path $home_ 'bin'
$data    = Join-Path $local 'mysql-data'
$rootPw  = if ($env:MYSQL_ROOT_PASSWORD) { $env:MYSQL_ROOT_PASSWORD } else { 'localdevroot' }
$appPw   = if ($env:MYSQL_PASSWORD) { $env:MYSQL_PASSWORD } else { 'localdevonly' }

if (-not (Test-Path $bin)) {
  New-Item -ItemType Directory -Force $local | Out-Null
  $zip = Join-Path $local 'mariadb.zip'
  Write-Host "Baixando MariaDB $version..."
  Invoke-WebRequest "https://archive.mariadb.org/mariadb-$version/winx64-packages/mariadb-$version-winx64.zip" -OutFile $zip
  Expand-Archive $zip -DestinationPath $local -Force
  Remove-Item $zip
}

$firstRun = -not (Test-Path $data)
if ($firstRun) {
  & "$bin\mariadb-install-db.exe" "--datadir=$data" --port=3307 "--password=$rootPw"
  if ($LASTEXITCODE) { throw 'mariadb-install-db falhou' }
}

$running = Get-NetTCPConnection -LocalPort 3307 -State Listen -ErrorAction SilentlyContinue
if (-not $running) {
  Start-Process -WindowStyle Hidden "$bin\mariadbd.exe" -ArgumentList "--datadir=`"$data`"", '--port=3307', '--bind-address=127.0.0.1', '--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci'
  for ($i = 0; $i -lt 30; $i++) { Start-Sleep 1; if (Get-NetTCPConnection -LocalPort 3307 -State Listen -ErrorAction SilentlyContinue) { break } }
}

$client = "$bin\mariadb.exe"
$sql = @"
CREATE DATABASE IF NOT EXISTS neurolaudos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'neurolaudos'@'localhost' IDENTIFIED BY '$appPw';
CREATE USER IF NOT EXISTS 'neurolaudos'@'127.0.0.1' IDENTIFIED BY '$appPw';
GRANT ALL PRIVILEGES ON neurolaudos.* TO 'neurolaudos'@'localhost';
GRANT ALL PRIVILEGES ON neurolaudos.* TO 'neurolaudos'@'127.0.0.1';
FLUSH PRIVILEGES;
"@
$sql | & $client -h 127.0.0.1 -P 3307 -u root "-p$rootPw"
Get-Content (Join-Path $root 'db\schema.sql') -Raw | & $client -h 127.0.0.1 -P 3307 -u root "-p$rootPw"
if ($LASTEXITCODE) { throw 'Falha ao aplicar db/schema.sql' }
Write-Host 'MariaDB rodando em 127.0.0.1:3307 (banco neurolaudos).'
Write-Host "Parar: & '$bin\mariadb-admin.exe' -h 127.0.0.1 -P 3307 -u root -p shutdown"
