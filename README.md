# NeuroLaudos IA — projeto para continuar no Codex

**Status: base funcional de desenvolvimento (MVP técnico), NÃO validado para produção clínica.**

## Objetivo
Aplicação Angular 19 + Node.js 22 / Express + MySQL 8.4 + OpenAI Responses API + `python-docx` para ajudar a psicóloga responsável a transformar dois DOCX obrigatórios em um laudo revisado.

**Entradas obrigatórias a cada avaliação**
1. `Arquivo base.docx`: preenchido pela estagiária, contendo identificação, tabelas, escores e classificações. **NUNCA modificar o original, pontuações ou textos preexistentes.**
2. `anamnese.docx`: anotações da psicóloga, convertidas pela IA em **tópicos com parágrafos discursivos, objetivos e fiéis ao relato**.

**Saída**: cópia DOCX do arquivo base com a anamnese e os parágrafos de *Interpretação Clínica / Interpretação e Observações Clínicas* inseridos nas posições originais. Toda geração é rascunho, revisada e aprovada por psicóloga responsável antes da exportação. Campos de hipóteses diagnósticas, conclusão e recomendações continuam sujeitos a elaboração/revisão expressa da profissional.

## Estrutura
- `api/src/server.mjs`: autenticação JWT, setup inicial, cadastro, upload DOCX criptografado AES-256-GCM, inspeção, IA, versionamento, aprovação, exportação.
- `web/`: aplicação Angular 19 standalone com telas de avaliações, uploads, editor e configurações da IA.
- `worker/docx_worker.py`: inspeção DOCX (inclui tabelas) e inserção sem sobrescrever documento original.
- `db/schema.sql`: schema MySQL e logs de auditoria.
- `docs/`: requisitos, segurança e backlog.
- `templates/*PRIVADO*`: arquivos originais do usuário para conferência local; **excluídos do Git por .gitignore**. Não distribuir nem usar como fixture em CI.

## Execução local no Windows (sem Docker, sem admin)
Pré-requisitos: Node 22+, Python 3.11+.
Atalho na raiz do projeto:
```powershell
npm run setup   # dependências npm + python-docx + api/.env
npm run db:init # MySQL existente (porta 3306): pede a senha do root, cria banco/usuário e aplica o schema
npm run dev     # banco + API (node) + web; Ctrl+C para parar
npm test        # testes do worker + checagem da API + build web
npm run dev:lan # igual ao dev, mas outros PCs da rede local acessam http://<IP-desta-máquina>:4200 (ou iniciar-rede.bat)
```
Passo a passo equivalente:
```powershell
python -m pip install python-docx==1.2.0
powershell -ExecutionPolicy Bypass -File scripts\setup-env.ps1   # gera api/.env com segredos aleatórios
cd api; npm run db:init                                          # MySQL já instalado (DB_PORT=3306 no api/.env)
# ou, sem MySQL: scripts\start-db.ps1 (MariaDB portátil, use DB_PORT=3307)
cd api; npm install; npm start                                   # API em http://localhost:3001
cd web; npm install; npm start                                   # UI em http://localhost:4200 (proxy /api -> 3001)
python -m unittest discover -s tests                             # testes do worker DOCX
```
`GET /api/health` retorna `db:true` quando o banco está acessível. A API recusa iniciar se `JWT_SECRET`, `FILE_ENCRYPTION_KEY` ou o worker estiverem ausentes.

## Execução local (Docker)
1. Instalar Docker Compose, Node 22, Python 3.11+ e `python-docx` se quiser rodar API fora do Docker.
2. Copiar `api/.env.example` para `api/.env`. Definir `JWT_SECRET` (32+ chars aleatórios), `FILE_ENCRYPTION_KEY` (64 caracteres hex), `DB_PASSWORD` e `CORS_ORIGIN`.
3. `docker compose up --build -d` para MySQL + API. Porta API `http://localhost:3001` (local somente).
4. `cd web && npm install && npm start` para interface `http://localhost:4200`.
5. Na tela de login, usar *Primeiro acesso (setup)* apenas uma vez, informando e-mail real do administrador e senha forte com 14+ caracteres. Depois Entrar.
6. Criar paciente, avaliação, anexar **ambos** os DOCX, clicar analisar.
7. Configurar `OPENAI_API_KEY` no backend. Para habilitar IA, depois de verificar termos, privacidade e autorização: `AI_ENABLED=true`, `ALLOW_EXTERNAL_AI=true`, e habilitar no painel com modelo existente na conta API. Reiniciar API após editar `.env`.
8. Gerar e aprovar **cada seção**. Aprovar a avaliação, exportar `.docx`.

Sem chave e autorização explicitamente configuradas, a IA retorna bloqueio (503). O app não reutiliza sessões do ChatGPT Web: a API é contratada e faturada separadamente.

## Como usar (tela)
1. Abra `iniciar.bat` (só neste PC) ou `iniciar-rede.bat` (rede local) e entre.
2. À esquerda: **+ Nova avaliação** ou abra uma existente.
3. **Arquivos:** arraste o arquivo base e a anamnese (DOCX). O sistema valida e encontra os pontos de inserção.
4. **Gerar texto com IA:** um botão gera as 11 partes; mostra tokens e custo estimado em reais.
5. **Conferir e baixar:** pré-visualize o Word no navegador, edite qualquer parte (ou use o modo manual com o ChatGPT) e clique em **Aprovar e baixar Word**.

Custo: estimado a partir de `PRICES` em `api/src/server.mjs` (USD por 1M tokens, sobrescreva com `OPENAI_PRICE_INPUT`/`_CACHED`/`_OUTPUT`) e do câmbio `USD_BRL` no `api/.env`. O valor cobrado de fato está no painel da OpenAI. `GENERATED_TEXT_RED=true` deixa o texto gerado em vermelho no Word (modo teste).

## Endpoints
- `GET /api/health`
- `POST /api/setup` (somente quando não existem usuários) · `POST /api/login` · `PUT /api/me/password`
- `GET/POST /api/patients`
- `GET/POST /api/evaluations` · `GET/DELETE /api/evaluations/:id`
- `POST /api/evaluations/:id/upload/base|anamnesis` (multipart `file`, DOCX validado)
- `POST /api/evaluations/:id/inspect`
- `POST /api/evaluations/:id/generate/:key` (IA pela API; registra tokens e custo)
- `POST /api/evaluations/:id/prompt/:key` (pedido pronto para o modo manual com ChatGPT)
- `PUT /api/evaluations/:id/sections/:key` body `{content,approve}`
- `POST /api/evaluations/:id/preview` (DOCX com rascunhos atuais)
- `POST /api/evaluations/:id/approve` body `{approveSections:true}` opcional · `POST /api/evaluations/:id/export`
- `GET/PUT /api/ai/settings` (verifica se o modelo existe na conta) · `PUT /api/ai/prompts/:id` · `GET /api/ai/usage`

## Limitações abertas antes de produção
- Corrigir e validar o posicionamento visual de inserções para todos os diferentes modelos DOCX; preservar espaçamento, numeração de páginas e eventuais caixas de texto. Adicionar testes por modelos anonimizados.
- A extração envia o **conteúdo estruturado do documento** à API externa se a integração for habilitada. **Ainda não há desidentificação automática suficiente**. Implantar minimização/pseudonimização consistente, base legal, política de retenção e contrato antes de usar dados reais. API não deve ser ativada em ambiente clínico até aprovação.
- Persistir somente arquivos criptografados, mas conteúdo de seções e dados do paciente estão no MySQL: implementar criptografia de banco, backup criptografado, monitoramento, rotação de segredos, segregação de funções e política de expurgo.
- Auth inicial não inclui MFA, renovação/invalidacão de tokens, criação de outros usuários nem recuperação de senha. Adicionar antes de liberar acesso remoto.
- Aprovação registra usuário e horário (`approved_by`/`approved_at`), mas ainda não há política de completude por template nem bloqueio de versão por assinatura.
- Não há geração de PDF operacional: adicionar conversor com validação visual.
- A conferência de pontuação não realiza normatização nem cálculo psicológico. A IA não pode inventar normas ou classificar testes.
- Não copiar instrumentos restritos nem tabelas normativas licenciadas para o sistema sem permissão.
- Testar robustez de DOCX malformado e proteção contra decompression bomb e abuso; isolamento do worker.
- UI contém fluxos básicos, ainda necessita refinamento, UX, tratamento de erro e testes e2e.

## Continuação orientada ao Codex
Leia `AGENTS.md` e `docs/BACKLOG_CODEX.md` antes de desenvolver. Use apenas dados totalmente fictícios nos testes. Preserve invariantes de integridade documental. Não faça commit de `.env`, segredos, relatórios de pacientes ou arquivos de referência privados.
