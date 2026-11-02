# Cria api/.env com segredos aleatórios (não sobrescreve um .env existente).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root 'api\.env'
if (Test-Path $envFile) { Write-Host "api/.env já existe; nada alterado."; exit 0 }
function RandHex([int]$bytes) { $b = New-Object byte[] $bytes; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
$content = (Get-Content (Join-Path $root 'api\.env.example') -Raw) `
  -replace 'JWT_SECRET=.*', "JWT_SECRET=$(RandHex 48)" `
  -replace 'FILE_ENCRYPTION_KEY=.*', "FILE_ENCRYPTION_KEY=$(RandHex 32)" `
  -replace 'PYTHON_BIN=.*', 'PYTHON_BIN=python' `
  -replace 'ADMIN_PASSWORD=.*', 'ADMIN_PASSWORD='
[IO.File]::WriteAllText($envFile, $content)
Write-Host "api/.env criado com JWT_SECRET e FILE_ENCRYPTION_KEY aleatórios."
Write-Host "IMPORTANTE: guarde FILE_ENCRYPTION_KEY; sem ela os DOCX armazenados não podem ser lidos."
