@echo off
chcp 65001 >nul
title NeuroLaudos IA
cd /d "%~dp0"

where node >nul 2>&1 || (echo Instale o Node.js 22 ou mais novo: https://nodejs.org & goto erro)
where python >nul 2>&1 || (echo Instale o Python 3.11 ou mais novo: https://www.python.org & goto erro)

if not exist "api\node_modules" (
  echo Instalando dependencias pela primeira vez...
  call npm run setup || goto erro
)

start "" cmd /c "timeout /t 12 >nul & start http://localhost:4200"
call npm run dev
goto fim

:erro
echo.
echo Falha ao iniciar. Veja a mensagem acima.

:fim
pause
