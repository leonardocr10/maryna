@echo off
chcp 65001 >nul
setlocal EnableExtensions
title NeuroLaudos IA
cd /d "%~dp0"

rem ---- Node.js 22.13+ (API with embedded SQLite) ----
call :ensure_node || goto erro
rem ---- Python 3.11+ (Word worker and local voice) ----
call :ensure_python || goto erro

rem ---- Project dependencies: each step runs only when something is missing ----
if not exist "api\node_modules" (
  echo Instalando dependencias da API...
  call npm --prefix api install || goto erro
)
if not exist "web\node_modules" (
  echo Instalando dependencias da tela...
  call npm --prefix web install || goto erro
)
"%PY%" -c "import docx, piper, edge_tts" >nul 2>&1 || (
  echo Instalando pacotes do Python...
  "%PY%" -m pip install --disable-pip-version-check python-docx==1.2.0 piper-tts==1.8.0 edge-tts==7.3.1 || goto erro
)
if not exist "worker\voices\pt_BR-faber-medium.onnx" (
  call node scripts\setup-voice.mjs || echo Aviso: a voz local nao foi baixada. O botao Ouvir usa a voz do Windows.
)
if not exist "api\.env" (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-env.ps1 || goto erro
)
rem The API uses this Python even if api\.env says "python" (dotenv keeps variables already set).
set "PYTHON_BIN=%PY%"

echo.
echo Abrindo na porta 9091:
echo   - neste computador: http://localhost:9091
echo   - outros computadores e internet: http://IP-DESTE-COMPUTADOR:9091 (enderecos abaixo)
echo.
echo ATENCAO: o sistema aceita acessos de fora deste computador.
echo   - Pela internet, a conexao NAO e criptografada (http): senha e dados de saude
echo     passam abertos. Prefira um tunel com HTTPS (ex.: Cloudflare Tunnel ou Tailscale)
echo     em vez de abrir a porta 9091 no roteador.
echo   - Use senha forte em todas as contas.
echo   - Se o Windows perguntar sobre o Firewall, permita o Node.js para a porta 9091.
echo.
call npm run dev:lan
goto fim

rem =====================================================================
:ensure_node
where node >nul 2>&1 && node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" >nul 2>&1 && exit /b 0
echo Node.js 22.13 ou mais novo nao encontrado. Instalando o Node.js LTS...
call :need_winget "https://nodejs.org" || exit /b 1
winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" >nul 2>&1 && exit /b 0
echo Nao foi possivel instalar o Node.js. Instale pelo site https://nodejs.org e abra este arquivo de novo.
exit /b 1

:ensure_python
set "PY="
call :try_python python
call :try_python py
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do call :try_python "%%~fD\python.exe"
if defined PY exit /b 0
echo Python 3.11 ou mais novo nao encontrado. Instalando o Python 3.12...
call :need_winget "https://www.python.org/downloads/" || exit /b 1
winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do call :try_python "%%~fD\python.exe"
if defined PY (
  for %%F in ("%PY%") do set "PATH=%%~dpF;%%~dpFScripts;%PATH%"
  exit /b 0
)
echo Nao foi possivel instalar o Python. Instale pelo site https://www.python.org/downloads/
echo (marque "Add python.exe to PATH") e abra este arquivo de novo.
exit /b 1

:try_python
rem Accepts a command only if it really runs Python 3.11+ (the Microsoft Store shortcut fails this test).
if defined PY exit /b 0
"%~1" -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1 && set "PY=%~1"
exit /b 0

:need_winget
where winget >nul 2>&1 && exit /b 0
echo O instalador do Windows (winget) nao esta disponivel neste computador.
echo Abrindo a pagina de download: %~1
start "" "%~1"
exit /b 1

rem =====================================================================
:erro
echo.
echo Falha ao iniciar. Veja a mensagem acima.

:fim
pause
