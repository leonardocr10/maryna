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

:erro
echo.
echo Falha ao iniciar. Veja a mensagem acima.

:fim
pause
