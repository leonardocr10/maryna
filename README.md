# NeuroLaudos IA — projeto para continuar no Codex

**Status: base funcional de desenvolvimento (MVP técnico), NÃO validado para produção clínica.**

## Objetivo
Aplicação Angular 19 + Node.js 22 / Express + SQLite embutido + OpenAI Responses API + `python-docx` para ajudar a psicóloga responsável a transformar dois DOCX obrigatórios em um laudo revisado.

**Entradas obrigatórias a cada avaliação**
1. `Arquivo base.docx`: preenchido pela estagiária, contendo identificação, tabelas, escores e classificações. **NUNCA modificar o original, pontuações ou textos preexistentes.**
2. `anamnese.docx`: anotações da psicóloga, convertidas pela IA em **tópicos com parágrafos discursivos, objetivos e fiéis ao relato**.

**Saída**: cópia DOCX do arquivo base com a anamnese e os parágrafos de *Interpretação Clínica / Interpretação e Observações Clínicas* inseridos nas posições originais. Toda geração é rascunho, revisada e aprovada por psicóloga responsável antes da exportação. Campos de hipóteses diagnósticas, conclusão e recomendações continuam sujeitos a elaboração/revisão expressa da profissional.

## Estrutura
- `api/src/server.mjs`: autenticação JWT, setup inicial, cadastro, upload DOCX criptografado AES-256-GCM, inspeção, IA, versionamento, aprovação, exportação.
- `web/`: aplicação Angular 19 standalone com telas de avaliações, uploads, editor e configurações da IA.
- `worker/docx_worker.py`: inspeção DOCX (inclui tabelas) e inserção sem sobrescrever documento original.
- `db/schema.sql`: schema SQLite (aplicado automaticamente) e logs de auditoria.
- `api/src/db.mjs`: acesso ao banco SQLite embutido (`node:sqlite`).
- `docs/`: requisitos, segurança e backlog.
- `templates/*PRIVADO*`: arquivos originais do usuário para conferência local; **excluídos do Git por .gitignore**. Não distribuir nem usar como fixture em CI.

## Instalação e execução
Requisitos no computador: **Node.js 22.13+** e **Python 3.11+**. Se faltarem, o `iniciar.bat` baixa e instala os dois sozinho (sites oficiais nodejs.org e python.org, conferidos antes de usar; sem winget e sem administrador, funciona também no Windows Server), além dos pacotes Python, da voz local e do `api/.env`. Não precisa de banco de dados instalado: os dados ficam em `api/data/neurolaudos.db` (SQLite embutido no Node).

- Dois cliques em `iniciar.bat`: abre neste PC (http://localhost:9091) e na rede local (http://<IP-desta-máquina>:9091). Na primeira vez instala as dependências e cria `api/.env` com segredos aleatórios.
- Equivalente pelo terminal, na raiz: `npm run setup` (uma vez), `npm run dev` ou `npm run dev:lan`, `npm test`.

**Levar para outro computador / backup:** copie a pasta do projeto inteira. O que importa são `api/data/` (banco), `api/storage/` (DOCX criptografados) e `api/.env` (contém `FILE_ENCRYPTION_KEY`; sem ele os DOCX não abrem). Esses três ficam fora do Git e contêm dados de pacientes: guarde com cuidado.

**Vindo de uma versão com MySQL:** mantenha `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` e `DB_PASSWORD` no `api/.env` e rode `npm run db:migrar-mysql` uma vez. O MySQL só é lido, nunca alterado.

Docker (opcional): `docker compose up --build -d` sobe só a API, com `api/data` e `api/storage` montados.

## Como usar (tela)
1. Abra `iniciar.bat` e entre.
2. À esquerda: **+ Nova avaliação** ou abra uma existente.
3. **Arquivos:** arraste o arquivo base e a anamnese (DOCX). O sistema valida e encontra os pontos de inserção.
4. **Gerar texto com IA:** um botão gera as 11 partes; mostra tokens e custo estimado em reais.
5. **Conferir e baixar:** pré-visualize o Word no navegador, edite qualquer parte (ou use o modo manual com o ChatGPT) e clique em **Aprovar e baixar Word**.

Arquivo base já preenchido: no Word final, o texto antigo de um destino é trocado pelo texto novo daquela parte. Param a troca e nunca mudam: tabelas, gráficos, quebras de página, títulos e textos fixos (Salienta-se, Referências etc.). Partes sem texto novo mantêm o que já havia, e o arquivo enviado fica guardado como está. O texto antigo não é enviado à IA como evidência. As interpretações são localizadas pelo título da seção; sem título, pela ordem no documento.

Descrição da demanda: copiada do arquivo base como está, sem IA, e no Word permanece o parágrafo original. Se o arquivo não tiver esse texto, escreva em Editar ou use Gerar com IA.

Texto da IA: as seções não usam categorias de desempenho (inferior, superior, média, limítrofe etc.), e as interpretações também não trazem números. Uma conferência automática refaz a seção uma vez se encontrar algum desses termos e, se ainda sobrar, mostra um aviso. A Anamnese fica de fora para seguir o relato.

Instrução da psicóloga: tem prioridade sobre as regras padrão (extensão, formato, vocabulário, categorias, números). As regras padrão só valem no que ela não disser o contrário, e a conferência não refaz o texto contra o pedido; apenas avisa. Continua valendo: não inventar dados nem acrescentar diagnóstico que ela não tenha indicado.

Custo: estimado a partir de `PRICES` em `api/src/server.mjs` (USD por 1M tokens, sobrescreva com `OPENAI_PRICE_INPUT`/`_CACHED`/`_OUTPUT`) e do câmbio `USD_BRL` no `api/.env`. O valor cobrado de fato está no painel da OpenAI. Na pré-visualização, o texto inserido aparece em vermelho (`GENERATED_TEXT_RED=false` desliga); o Word baixado sai sempre na cor normal.

Ditado por voz: o botão de microfone nos campos de texto (edição das seções, orientações da conclusão, instruções da avaliação e do modelo) transcreve a fala em português em tempo real. O texto provisório aparece abaixo do campo e entra no campo, na posição do cursor, a cada pausa da fala, sem apagar o que já estava escrito; dá para pausar, continuar, concluir e editar à mão durante o ditado. Só um campo dita por vez. O áudio vai do navegador direto para a OpenAI (WebRTC, modelo `gpt-live-transcribe`) com uma credencial temporária de 60 s criada pelo servidor; a chave da API nunca vai para o navegador, e nada do áudio ou do texto ditado é gravado ou registrado no servidor (só a abertura da sessão entra no registro de auditoria). Fica desligado por padrão: exige `DICTATION_ENABLED=true`, `AI_ENABLED=true` e `ALLOW_EXTERNAL_AI=true` no `api/.env` e autorização da psicóloga. Limites de custo: `DICTATION_MAX_SECONDS` por sessão e `DICTATION_DAILY_LIMIT` sessões por pessoa por dia. O microfone exige `localhost` ou HTTPS (no modo LAN por HTTP, os outros computadores não conseguem ditar). A transcrição nunca é reescrita por IA.

## Fluxo de trabalho e telas
- **Estagiária → psicóloga:** a estagiária cria a avaliação, envia os arquivos e clica em **Enviar para revisão**. A psicóloga vê a avaliação em "Aguardando sua revisão" no painel e pode **pedir correção** (o pedido volta para a estagiária, que marca como resolvido e envia de novo).
- **Conferir antes de seguir:** a avaliação lista o que falta (identificação, arquivos, seções sem lugar ou sem tabela) e avisos do arquivo base: nome, nascimento e idade que não conferem com o sistema, datas trocadas, tabelas sem valores e testes citados na anamnese sem resultado no arquivo. Só avisa: nada é calculado nem alterado.
- **Conferência final:** ao aprovar, aponta marcadores como `[PACIENTE]` não trocados, seções vazias, textos muito acima da extensão sugerida e avisos da geração.
- **Versões:** cada seção mostra as versões anteriores com o que mudou (palavra a palavra) e permite restaurar; restaurar também guarda o texto atual. Enquanto edita, o texto salva sozinho a cada pausa, numa única versão por sessão de edição.
- **Textos-padrão** (Configurações): parágrafos recorrentes da clínica, inseridos no cursor ao editar. Não guarde dados de paciente neles.
- **Pacientes:** ficha com todas as avaliações da pessoa e **Nova reavaliação** (já com sexo, escolaridade e modelo da última).
- **Prazos:** a data de finalização vira prazo no painel ("Atrasadas", "Vencem em 7 dias").
- **Relatórios:** avaliações criadas e aprovadas por mês, tempo médio de trabalho e gasto estimado com IA.
- **Devolutiva para a família** (ou para a própria pessoa, se adulta): depois do laudo aprovado, um texto em linguagem simples feito só a partir dos textos aprovados do laudo (demanda, interpretações, conclusão, recomendações), sem tabelas, sem anamnese, sem números nem classificações e sem acrescentar diagnóstico. É rascunho de IA (ou escrito à mão), com histórico, editado e aprovado pela psicóloga; o Word separado só sai depois da aprovação. Prompt em `api/src/prompts.mjs` (`devolutivaTask`, `DEVOLUTIVA_SYSTEM`).
- **Esqueci minha senha:** sem serviço de e-mail, o pedido aparece para o administrador em Configurações > Usuários, que passa uma senha temporária.

## Endpoints
- `GET /api/health`
- `POST /api/setup` (somente quando não existem usuários) · `POST /api/login` · `GET /api/me` · `PUT /api/me/password`
- `GET /api/evaluations/:id/review` · `POST /api/evaluations/:id/submit` · `POST /api/evaluations/:id/notes` (pedido de correção) · `POST /api/evaluations/:id/notes/:nid/resolve`
- `GET /api/evaluations/:id/sections/:key/history` · `POST /api/evaluations/:id/sections/:key/restore` · `PUT .../sections/:key` aceita `merge:true` (salvamento automático)
- `GET/PUT /api/evaluations/:id/devolutiva` · `POST .../devolutiva/generate` · `POST .../devolutiva/reopen` · `POST .../devolutiva/export` (Word, só aprovada)
- `GET/POST /api/snippets` · `PUT/DELETE /api/snippets/:id` · `POST /api/password-requests` (sem login)
- `GET/POST /api/users` · `PUT /api/users/:id` (nome, papel, ativo) · `POST /api/users/:id/password` (senha temporária) — só administrador
- `GET/POST /api/patients`
- `GET/POST /api/evaluations` · `GET/DELETE /api/evaluations/:id`
- `POST /api/evaluations/:id/upload/base|anamnesis` (multipart `file`, DOCX validado)
- `POST /api/evaluations/:id/inspect`
- `GET /api/evaluations/:id/references` (tabelas que cada seção usa, as mesmas enviadas à IA)
- `POST /api/evaluations/:id/generate/:key` (IA pela API; registra tokens e custo)
- `POST /api/evaluations/:id/prompt/:key` (pedido pronto para o modo manual com ChatGPT)
- `PUT /api/evaluations/:id/sections/:key` body `{content,approve}`
- `POST /api/evaluations/:id/preview` (DOCX com rascunhos atuais)
- `POST /api/evaluations/:id/approve` body `{approveSections:true}` opcional · `POST /api/evaluations/:id/export`
- `GET /api/dictation/status` · `POST /api/dictation/session` (credencial temporária para o ditado)
- `GET/PUT /api/ai/settings` (verifica se o modelo existe na conta) · `PUT /api/ai/prompts/:id` · `GET /api/ai/usage`

## Limitações abertas antes de produção
- Corrigir e validar o posicionamento visual de inserções para todos os diferentes modelos DOCX; preservar espaçamento, numeração de páginas e eventuais caixas de texto. Adicionar testes por modelos anonimizados.
- Pseudonimização (`api/src/privacy.mjs`): nome, data de nascimento, autora, CRP, telefone, e-mail, clínica e nomes após palavras-guia (Dr., psi, pediatra, colégio…) viram marcadores como `[PACIENTE]` antes do envio e voltam no texto final. A psicóloga confere e completa a lista na tela. Nomes soltos sem palavra-guia podem escapar: a lista precisa ser revisada. Ainda faltam base legal, política de retenção e contrato antes de uso clínico.
- Persistir somente arquivos criptografados, mas conteúdo de seções e dados do paciente estão no arquivo SQLite sem criptografia: implementar criptografia de banco, backup criptografado, monitoramento, rotação de segredos, segregação de funções e política de expurgo.
- Contas e papéis: o administrador cria contas (Configurações > Usuários) com senha temporária, troca o papel, desativa e redefine senha; a troca vale na hora, pois cada requisição relê a conta. Ainda faltam MFA e recuperação de senha por e-mail. Adicionar antes de liberar acesso remoto.
- Aprovação registra usuário e horário (`approved_by`/`approved_at`), mas ainda não há política de completude por template nem bloqueio de versão por assinatura.
- Não há geração de PDF operacional: adicionar conversor com validação visual.
- A conferência de pontuação não realiza normatização nem cálculo psicológico. A IA não pode inventar normas ou classificar testes.
- Não copiar instrumentos restritos nem tabelas normativas licenciadas para o sistema sem permissão.
- Testar robustez de DOCX malformado e proteção contra decompression bomb e abuso; isolamento do worker.
- UI contém fluxos básicos, ainda necessita refinamento, UX, tratamento de erro e testes e2e.

## Continuação orientada ao Codex
Leia `AGENTS.md` e `docs/BACKLOG_CODEX.md` antes de desenvolver. Use apenas dados totalmente fictícios nos testes. Preserve invariantes de integridade documental. Não faça commit de `.env`, segredos, relatórios de pacientes ou arquivos de referência privados.
