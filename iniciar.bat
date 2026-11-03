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

echo.
echo Abrindo neste computador (http://localhost:4200) e na rede local (endereco mostrado abaixo).
echo ATENCAO: outros computadores desta rede tambem conseguem acessar.
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
