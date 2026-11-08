# Anamnese pelo ChatGPT (plugin MCP ou cópia e colagem)

Alternativa à geração pela API, que continua igual. Na seção **Anamnese**, o botão **Gerar anamnese pelo ChatGPT** abre o painel com três métodos:

| Método | Como funciona | Custo |
|---|---|---|
| OpenAI API | Geração atual pelo servidor. | Por uso, na conta da API. |
| ChatGPT — plugin (MCP) | O ChatGPT busca as anotações no NeuroLaudos e devolve o rascunho por ferramentas autorizadas. | Nenhuma chamada à API; conta no limite do plano do ChatGPT. |
| ChatGPT — cópia e colagem assistida | O sistema prepara o texto, você cola no ChatGPT e cola a resposta de volta. | Nenhuma chamada à API; conta no limite do plano do ChatGPT. |

Nada lê ou automatiza a página do ChatGPT (nem login, nem digitação, nem extração da resposta). O DOCX original não é alterado: as anotações são lidas do arquivo criptografado quando necessárias e não são copiadas para a tarefa.

## Regras comuns
- Só em avaliações **Com IA** e só para psicólogas(os) e administradores.
- Os dados vão **pseudonimizados**, como no pedido manual existente: nomes, datas e contatos viram marcadores (`[PACIENTE]`, `[PESSOA_1]`...). Os nomes voltam ao salvar.
- As anotações seguem a ordem do Word, parágrafo por parágrafo (tabelas em Markdown), para não misturar pai, mãe, madrasta e paciente.
- Instrução padrão e formato: `api/src/prompts.mjs` (`CHATGPT_ANAMNESIS_INSTRUCTION`, `CHATGPT_ANAMNESIS_FORMAT`, `chatgptCommand`, `MCP_SERVER_INSTRUCTIONS`).
- Cada tarefa tem um código `NL-XXXX-XXXX`, pertence a quem a criou e expira em `CHATGPT_TASK_HOURS` (padrão 24 h). Preparar uma nova encerra a anterior.
- A resposta é normalizada só no layout (títulos `## `, parágrafos separados por linha em branco). Nenhuma palavra é mudada.
- Cada tarefa grava **uma vez**. Repetir o mesmo `id_operacao` devolve o primeiro resultado; outro id é recusado.
- Se a Anamnese estiver vazia (ou for só a cópia intacta do arquivo), o rascunho entra direto como texto a revisar. Se já houver texto editado, gerado ou aprovado, o rascunho **espera a confirmação** da psicóloga (botão *Substituir pela versão do ChatGPT*). O texto anterior vai para Versões.
- O rascunho nunca é aprovado sozinho: a aprovação continua seção a seção.
- Na auditoria ficam só as ações (tarefa criada, plugin leu, rascunho recebido ou aplicado, autorização, desconexão), nunca o conteúdo.
- Limpeza a cada hora: tarefas vencidas expiram. Rascunhos não confirmados são apagados `CHATGPT_KEEP_DAYS` dias depois (padrão 7). Códigos e tokens OAuth vencidos também são apagados.

Status: Pendente, Em processamento (o plugin leu), Rascunho recebido, Revisado (confirmado, editado ou aprovado depois), Erro (avaliação travada ou modo manual no momento de salvar), Expirada, Descartada.

## Modo cópia e colagem (sempre disponível)
1. **Preparar texto para ChatGPT**: junta a instrução padrão e as anotações e copia tudo.
2. **Abrir ChatGPT**, colar com Ctrl+V e enviar.
3. Copiar a resposta pelo botão de cópia do próprio ChatGPT.
4. Colar em **Colar resposta do ChatGPT** e clicar em **Salvar anamnese**.

## Plugin MCP (desligado por padrão)
Requisitos verificados na documentação da OpenAI (Plugins / Apps SDK, novembro de 2026):
- Servidor MCP por **Streamable HTTP** em endereço **HTTPS público** ou por **Secure MCP Tunnel**.
- **OAuth 2.1** conforme a especificação de autorização do MCP:
  - metadados do recurso protegido (RFC 9728) e do servidor de autorização (RFC 8414);
  - PKCE `S256`, `resource` repetido nas etapas e `iss` na resposta (RFC 9207);
  - registro dinâmico de cliente (DCR, RFC 7591).
- Ferramentas de leitura e de gravação são aceitas pelo ChatGPT na web, conforme as permissões do workspace. No modo Lockdown ou com restrição do administrador, o recurso pode não estar disponível. Ao gravar, o ChatGPT pede confirmação.

O que foi implementado (`api/src/mcp.mjs`, `api/src/oauth.mjs`, `api/src/chatgpt-routes.mjs`):

| Endereço | Função |
|---|---|
| `POST /api/mcp` | Servidor MCP. |
| `/.well-known/oauth-protected-resource/api/mcp` e `/.well-known/oauth-authorization-server` | Metadados de descoberta. |
| `/api/oauth/register`, `/authorize`, `/token`, `/revoke` | Fluxo OAuth. |

Ferramentas do plugin:
- `obter_anamnese_pendente`: escopo `anamnese.ler`.
- `salvar_rascunho_anamnese`: escopo `anamnese.salvar`; não destrutiva e idempotente.
- `consultar_status_anamnese`: escopo `anamnese.ler`.

Segurança:
- O cliente é público (sem segredo) e só pode voltar para `https://chatgpt.com` (`CHATGPT_OAUTH_REDIRECT_HOSTS`).
- A autorização é dada na tela do NeuroLaudos, depois do login normal com senha e verificação em duas etapas.
- Na URL vai só um id aleatório do pedido.
- Códigos valem 5 min e uma vez só. Reusar um código revoga os tokens que ele gerou.
- Tokens de acesso valem 1 h. Os de renovação valem 30 dias, com rotação.
- O banco guarda só o hash SHA-256 dos códigos e tokens.
- Trocar a senha, desativar a conta ou mudar o papel invalida o acesso.
- Cada token só enxerga as tarefas da própria conta.
- **Desconectar ChatGPT** no painel revoga tudo.

### Como habilitar (só com autorização da psicóloga responsável e revisão de segurança, regra 6 do AGENTS.md)
1. Publique o site (porta 9091) em HTTPS. Use um proxy reverso com certificado ou um túnel HTTPS. A API continua só em 127.0.0.1, acessada pelo proxy do site (`/api` e `/.well-known`). Com `ng serve`, use `npm run dev:lan` ou acrescente o domínio em `allowedHosts`.
2. Em `api/.env`:
   ```
   CHATGPT_MCP_ENABLED=true
   PUBLIC_BASE_URL=https://neurolaudos.seudominio.com.br
   CORS_ORIGIN=https://neurolaudos.seudominio.com.br
   ```
3. Reinicie o sistema. No painel da Anamnese, a opção **ChatGPT — plugin (MCP)** fica ativa.
4. No ChatGPT (web): **Plugins** → **+** → **Add custom MCP server**.
   - Nome: NeuroLaudos IA.
   - URL: `https://neurolaudos.seudominio.com.br/api/mcp`.
   - Autenticação: **OAuth** (registro dinâmico).
   - Aceite o aviso e clique em **Create as a plugin**. Depois instale o plugin.
5. Na primeira vez que usar, o ChatGPT abre a tela de login do NeuroLaudos. Entre e clique em **Autorizar**.

### Como usar
1. Na Anamnese: **Gerar anamnese pelo ChatGPT** → **ChatGPT — plugin (MCP)** → **Preparar anamnese**. O comando é copiado.
2. **Abrir ChatGPT**, digite `@`, escolha **NeuroLaudos IA**, cole o comando e envie.
3. Confirme quando o ChatGPT pedir para salvar. O painel mostra *Rascunho recebido* sozinho, consultando o próprio servidor a cada 5 s.
4. Revise, edite e aprove a Anamnese como sempre.

### Riscos e limites
- Expor o sistema na internet aumenta a superfície de ataque, mesmo com OAuth. Prefira o Secure MCP Tunnel ou um proxy com restrição de acesso, use verificação em duas etapas em todas as contas e mantenha backups.
- O ChatGPT (OpenAI) recebe as anotações pseudonimizadas. Isso exige base legal e consentimento conforme a LGPD, como já ocorre com o pedido manual.
- A disponibilidade do recurso de MCP personalizado depende do plano e das políticas do workspace. Não há garantia de uso ilimitado.
- Dados de saúde que não são nome, data ou contato (por exemplo, o nome da escola citado de forma livre) só são trocados se estiverem na lista de privacidade da avaliação.
