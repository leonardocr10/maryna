# Editor Word (OnlyOffice Docs)

A aba **Word** da avaliação abre o laudo num editor igual ao Word, para edição livre de uma **cópia**.
O editor é o [OnlyOffice Docs](https://www.onlyoffice.com/docs) (Community Edition, AGPL-3.0, gratuito até 20 conexões
simultâneas), instalado **no próprio computador do sistema**. Nada vai para servidores externos.

Como funciona:

- O sistema gera o laudo a partir das seções (sem o texto em vermelho) e o OnlyOffice abre essa cópia.
- A psicóloga edita qualquer coisa do documento. O OnlyOffice salva sozinho no NeuroLaudos IA ao fechar e no botão **Salvar**.
- Enquanto existir essa **versão final editada**, é ela que sai no Word e no PDF baixados (o download continua exigindo a avaliação aprovada).
- O **arquivo base enviado nunca muda**. "Recomeçar das seções" descarta a versão editada e gera de novo a partir das seções.
- Se as seções mudarem depois da versão editada, a aba avisa (a versão editada não muda sozinha).
- O sistema guarda as 5 últimas versões salvas da cópia editada.

## 1. Instalar o OnlyOffice (Docker)

Requisitos: Docker Desktop (Windows, com WSL 2) e cerca de 4 GB de RAM livres.

Gere um segredo aleatório com 32 caracteres ou mais (o mesmo vai no OnlyOffice e no `.env` da API):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Suba o servidor, só para este computador (porta 8080):

```powershell
docker run -d --name onlyoffice --restart=always -p 127.0.0.1:8080:80 `
  -e JWT_ENABLED=true -e JWT_SECRET=COLE_O_SEGREDO_AQUI -e ALLOW_PRIVATE_IP_ADDRESS=true `
  -v onlyoffice_data:/var/www/onlyoffice/Data -v onlyoffice_logs:/var/log/onlyoffice `
  onlyoffice/documentserver
```

A primeira subida leva alguns minutos. Confira em `http://127.0.0.1:8080/healthcheck` (responde `true`).

## 2. Publicar pelo Caddy (HTTPS)

O navegador precisa abrir o editor pelo mesmo endereço HTTPS do sistema. No `Caddyfile`, dentro do site do NeuroLaudos IA,
antes do `reverse_proxy` do app:

```
handle_path /onlyoffice/* {
	reverse_proxy 127.0.0.1:8080 {
		header_up X-Forwarded-Host {host}/onlyoffice
		header_up X-Forwarded-Proto {scheme}
	}
}
```

Recarregue o Caddy. Teste `https://SEU-ENDERECO/onlyoffice/healthcheck`.

## 3. Configurar a API (`api/.env`)

```
ONLYOFFICE_URL=https://SEU-ENDERECO/onlyoffice
ONLYOFFICE_JWT_SECRET=COLE_O_SEGREDO_AQUI
# Endereço pelo qual o OnlyOffice (dentro do Docker) alcança o sistema; padrão: PUBLIC_BASE_URL
ONLYOFFICE_API_URL=http://host.docker.internal:9091
```

Reinicie o sistema: o `.env` só é lido na partida (feche e abra o `iniciar.bat`).

## 4. Testar

Abra uma avaliação de teste (dados fictícios) › **Conferir seções** › aba **Word**. O laudo abre no editor; edite, clique em
Salvar (ícone de disquete do editor) e baixe o Word aprovado: ele deve trazer a edição.

## Segurança

- Todas as mensagens entre o sistema e o OnlyOffice são assinadas com o segredo (JWT). Pedidos sem assinatura são recusados.
- O link do arquivo é um token assinado que vale 12 horas, não uma sessão de usuário.
- O OnlyOffice fica preso a `127.0.0.1:8080`; de fora, só pelo Caddy em `/onlyoffice`.
- O nome do arquivo no editor é sempre `laudo.docx` (sem nome de paciente nos logs do OnlyOffice).
