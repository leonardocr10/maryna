@echo off
chcp 65001 >nul
title NeuroLaudos IA (rede local)
cd /d "%~dp0"

if not exist "api\node_modules" (
  echo Instalando dependencias pela primeira vez...
  call npm run setup || goto erro
)

sc query MySQL80 | find "RUNNING" >nul
if errorlevel 1 (
  echo O servico MySQL80 esta parado. Tentando iniciar...
  net start MySQL80 >nul 2>&1
)

start "" cmd /c "timeout /t 12 >nul & start http://localhost:4200"
echo.
echo ATENCAO: o sistema ficara acessivel para outros computadores desta rede.
echo Use apenas em rede confiavel (clinica/casa), com senha forte e dados de teste.
echo Se o Windows perguntar sobre o Firewall, permita somente em "Redes privadas".
echo.
call npm run dev:lan
goto fim

:erro
echo.
echo Falha ao iniciar. Veja a mensagem acima.

:fim
pause
