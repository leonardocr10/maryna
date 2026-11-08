# NeuroLaudos IA — Modo automático (extensão do Chrome)

Extensão de uso interno que gera, de forma supervisionada, os **rascunhos** das seções de uma avaliação com o ChatGPT e o plugin **NeuroLaudos IA (MCP)**, usando as abas que você já tem abertas e as suas sessões já conectadas. Não usa a API paga da OpenAI.

O que ela **nunca** faz:

- aprovar textos ou clicar em "Aprovar todas";
- substituir texto existente (rascunho sobre texto existente fica **aguardando sua confirmação** na seção);
- autorizar o plugin no ChatGPT por você (ela detecta o pedido, pausa e avisa);
- gerar seções de **texto fixo do arquivo**, a **Hipótese diagnóstica** ou seções sem dados;
- ler cookies, senhas ou tokens; usar endpoints internos do ChatGPT; contornar CAPTCHA ou bloqueios;
- guardar texto clínico. No armazenamento local ficam só: id da avaliação, chave e nome da seção, código NL da tarefa, etapa, status, horários e o id das abas.

O critério de sucesso de cada seção é o NeuroLaudos IA mostrar a tarefa como **Rascunho recebido**. Resposta do ChatGPT sozinha não conta.

## Modos

| Modo | O que faz |
|---|---|
| **Automático** | Percorre todas as seções escolhidas, em ordem, uma por vez. Para só em erro ou autorização obrigatória. |
| **Assistido** | Faz uma seção e pausa: você confere o rascunho e clica em **Próxima seção**. |
| **Simulação** | Confere a tela, os seletores, a janela ChatGPT de cada seção e, uma vez, o ChatGPT (campo, seletor @, plugin). Não prepara tarefa, não envia mensagem, não salva nada. |

## Instalação (manual, sem a Chrome Web Store)

O próprio NeuroLaudos IA mostra estes passos: em **Conferir seções**, clique em **Modo automático** sem a extensão instalada e a janela **Instalar o Modo automático** traz o botão **Baixar extensão (.zip)** (arquivo servido pelo app em `assets/extensao/`). Com a extensão instalada, o mesmo botão abre o painel.

1. Descompacte `neurolaudos-modo-automatico.zip` numa pasta fixa (ex.: `C:\NeuroLaudos\extensao`). Não apague a pasta depois: o Chrome usa os arquivos dela.
2. Abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta que contém `manifest.json`.
5. Fixe o ícone do robô na barra do Chrome (quebra-cabeça > alfinete).

Requisitos: Chrome 116 ou mais novo (Windows). No NeuroLaudos IA, o método **ChatGPT — plugin (MCP)** precisa estar ligado (`CHATGPT_MCP_ENABLED=true` e `PUBLIC_BASE_URL` https; veja `docs/CHATGPT_INTEGRACAO.md`) e o plugin precisa estar conectado à sua conta no ChatGPT.

## Configuração

- **Endereço do NeuroLaudos IA.** Já funcionam `http://localhost:9091` e `http://127.0.0.1:9091`. Para outro endereço (ex.: o https da clínica), clique no ícone da extensão > **Endereços do NeuroLaudos IA** > cole o endereço > **Adicionar**. O Chrome pede permissão só para esse endereço. Recarregue a aba do NeuroLaudos IA (F5).
- **Configurações** (no mesmo popup): espera máxima pela resposta do ChatGPT (padrão 15 min, inclui o tempo da sua autorização), espera pelo rascunho no NeuroLaudos IA (120 s) e tentativas automáticas por seção antes de enviar a mensagem (1).
- Esteja conectada no NeuroLaudos IA e no ChatGPT (chatgpt.com) antes de iniciar.

## Como usar

1. Abra a avaliação no NeuroLaudos IA, etapa **Conferir seções**.
2. Clique em **Modo automático** (botão verde ao lado de "Aprovar todas").
3. No painel, confira a contagem (seções, elegíveis, texto fixo ignorado, já com texto), escolha o modo, a política para seções com texto (padrão: não mexer), o que fazer em caso de erro (padrão: pausar) e se as imagens das seções vão junto (imagens não têm nomes trocados por marcadores).
4. Marque as seções e clique em **Iniciar** > confirme.
5. Para cada seção a extensão: abre a seção > abre a janela **ChatGPT** > seleciona **ChatGPT — plugin (MCP)** > reaproveita a tarefa aberta ou clica em **Preparar tarefa** > captura o código `NL-XXXX-XXXX` e o comando oficial > abre conversa nova na aba dedicada do ChatGPT > digita `@`, escolhe **NeuroLaudos IA** na lista e confere o chip do plugin > cola o comando e confere o código > envia > espera a resposta > volta ao NeuroLaudos IA e espera **Rascunho recebido** > fecha a janela > próxima seção.
6. Quando o ChatGPT pedir autorização para o plugin salvar, a extensão traz a aba do ChatGPT para frente e mostra um aviso. **Você** confere e confirma lá; a execução continua sozinha depois.
7. No fim, o painel mostra o relatório por seção (recebido, revisão necessária, erro, ignorada). Revise e aprove cada seção no NeuroLaudos IA, como sempre.

Controles: **Pausar** (não começa nada novo; a seção em andamento continua de onde parou), **Continuar** (confere de novo o status real e retoma da etapa segura), **Parar** (encerra; nada é apagado), **Ver detalhes** (códigos, etapas, erros e registro). Em erro, aparecem também **Tentar de novo**, **Pular seção** e, se o plugin não foi confirmado, **Já selecionei o plugin**.

## Garantias de execução

- **Sequencial**: uma seção e uma tarefa por vez; uma execução por vez em todo o Chrome.
- **Sem duplicidade**: tarefa aberta e válida da seção é reaproveitada; código expirado nunca é reutilizado; o mesmo código não serve a duas seções; seção concluída não é refeita.
- **Nunca envia duas vezes sozinha**: o horário do envio é gravado antes do clique. Depois disso, se algo falhar ou o Chrome fechar, a extensão só confere o status real; reenviar exige você clicar em **Tentar de novo**.
- **Chrome fechado e reaberto**: a execução volta **pausada**, com a seção na etapa de conferência.
- **Esperas por estado real** (MutationObserver + conferência), com limite por etapa. Nenhum clique por coordenada de tela. Se um elemento essencial não for encontrado com segurança, a extensão pausa e diz qual, em vez de clicar em algo parecido.

## Limitações conhecidas (leia antes de confiar no modo automático)

- **Interface do ChatGPT.** O ChatGPT não publica um contrato estável de interface. Os seletores (campo de mensagem, seletor `@`, chip do plugin, botões enviar/parar, botões de autorização) estão em `content/selectors.js` e foram escritos para a interface atual; podem quebrar quando ela mudar. Quando isso acontece a extensão **pausa** com a etapa e o motivo. Rode a **Simulação** depois de atualizações do ChatGPT.
- **Seleção do plugin.** A extensão só considera o plugin selecionado quando a interface mostra o chip/menção do plugin (texto `@NeuroLaudos IA` digitado não conta). Se o ChatGPT mudar a forma de escolher apps, use o **modo assistido da etapa**: selecione o plugin à mão e clique em **Já selecionei o plugin**.
- **Fim da resposta e autorização** são detectados pela interface (botão parar, botões de confirmar/negar). O que vale no fim é sempre o status no NeuroLaudos IA.
- **Termos de uso.** Automatizar a interface web do ChatGPT pode contrariar os termos do serviço da OpenAI e levar a limites ou bloqueios da conta. Use de forma supervisionada, com volume normal de uso.
- **Área de transferência.** Ao preparar a tarefa, o próprio NeuroLaudos IA copia o comando para a área de transferência (comportamento existente do app).
- A aba do NeuroLaudos IA precisa ficar aberta durante a execução. Feche só pelo **Parar**.

## Seletores

Lado NeuroLaudos IA: o app publica atributos estáveis (contrato desta extensão). Não remova sem atualizar `content/selectors.js`:

| Atributo | Onde |
|---|---|
| `data-nl-review`, `data-nl-evaluation`, `data-nl-readonly` | barra "Conferir seções" |
| `data-nl-head-tools`, `data-nl-action="approve-all"` | botões do topo (âncora do botão injetado) |
| `data-nl-section`, `data-nl-name`, `data-nl-kind` (`ai`/`fixed`/`hand`/`missing`), `data-nl-state` (`pend`/`gen`/`ap`/`file`) | barra de seções |
| `data-nl-editor` | cartão da seção aberta |
| `data-nl-action="chatgpt"` | botão ChatGPT da seção |
| `data-nl-cg`, `data-nl-ready`, `data-nl-mcp`, `data-nl-method`, `data-nl-busy`, `data-nl-task-code`, `data-nl-task-mode`, `data-nl-task-status`, `data-nl-task-expires`, `data-nl-needs-confirmation`, `data-nl-applied` | janela ChatGPT da seção |
| `data-nl-method-option="mcp"`, `data-nl-images`, `data-nl-action="prepare-mcp"`, `data-nl-command`, `data-nl-action="copy-command"`, `data-nl-action="close"` | controles da janela |
| evento `nlrefresh` na janela | pede ao app para reler o status da tarefa (só no servidor do próprio NeuroLaudos IA) |

Sem esses atributos (versão antiga do app) a extensão entra em **modo de compatibilidade** (leitura por textos visíveis) e confere o tipo de cada seção ao abri-la. O app tem o botão próprio `data-nl-action="auto-mode"`: a extensão marca `<html data-nlx-extension>`, atualiza o estado do botão (`data-state`, texto `.nlx-label`) e abre o painel no evento `nlx-open-panel`. Sem esse botão (versão antiga), a extensão injeta o seu ao lado de "Aprovar todas".

Lado ChatGPT, para atualizar depois de uma mudança de interface:

1. Abra o ChatGPT, clique com o botão direito no elemento (campo de mensagem, item do seletor `@`, chip do plugin, botão enviar/parar, botão de confirmar do plugin) > **Inspecionar**.
2. Prefira `data-testid`, `id`, `role` e `aria-label`. Evite classes geradas.
3. Atualize a lista correspondente em `content/selectors.js` (`CG.composer`, `CG.option`, `CG.send`, `CG.stop`, `CG.authText`...). A primeira que bater e estiver visível é usada.
4. Em `chrome://extensions`, clique em **Recarregar** na extensão e rode a **Simulação**.

## Atualização

1. Substitua os arquivos da pasta da extensão pelos da nova versão (mesma pasta).
2. Em `chrome://extensions`, clique em **Recarregar** (ícone ↻) na extensão.
3. Recarregue (F5) as abas do NeuroLaudos IA e do ChatGPT.

Uma execução em andamento continua salva; ela volta pausada se o Chrome reiniciar.

## Testes

Automatizados (Node 20+, sem dependências, dados 100% sintéticos):

```bash
cd chrome-extension
npm test          # fila, validação, estado e o fluxo completo contra páginas simuladas
npm run check     # manifest, arquivos, sintaxe, nenhuma chave nem endpoint interno
npm run zip       # check + gera ../dist/neurolaudos-modo-automatico.zip e a cópia em web/src/assets/extensao/ (rode após mudar a extensão)
```

Casos cobertos em `tests/flow.test.mjs`: uma seção elegível; várias seções; texto fixo; seções com rascunho; seções já aprovadas; tarefa pendente reaproveitada; tarefa expirada; plugin não selecionado (e "Já selecionei o plugin"); plugin ausente; falha de comunicação com o ChatGPT; autorização humana; limite de uso; rascunho não recebido; pausar e continuar; fechar e reabrir o Chrome; mudança de avaliação; execução simultânea; modo assistido; simulação; seção que precisa confirmar substituição; plugin MCP desligado; ChatGPT desconectado; avaliação somente leitura.

Testes de DOM em navegador (páginas sintéticas em `tests/dom/`, com `chrome.*` simulado): sirva a pasta `chrome-extension` (ex.: `python -m http.server 9097 --directory chrome-extension`) e abra `tests/dom/neurolaudos-fixture.html`, `tests/dom/chatgpt-fixture.html` ou `tests/dom/panel-preview.html` (`?view=setup|paused`). No console, `await cs({cmd: 'nl.scan'})` chama o content script como o worker faria.

Roteiro manual com o sistema real (use uma avaliação de teste com dados fictícios):

1. **Simulação** numa avaliação com várias seções: todas as verificações ✓ em **Ver detalhes**.
2. **Assistido** com uma seção: rascunho recebido, pausa, conferência na seção.
3. **Automático** com várias seções, incluindo uma com texto (política "Gerar mesmo assim" > **Revisão necessária**) e uma de texto fixo (ignorada).
4. Pausar durante a resposta do ChatGPT, continuar; fechar o Chrome no meio e reabrir (volta pausado, sem reenviar).
5. Desconectar o plugin no ChatGPT e iniciar: pausa com "plugin não apareceu".
6. Navegar entre telas do NeuroLaudos IA sem recarregar: o botão continua ao lado de "Aprovar todas", sem duplicar.

## Estrutura

```
manifest.json
background/service-worker.js     orquestração, abas, mensagens, permissões
modules/automation-manager.js    fluxo por seção (etapas, esperas, erros, pausa)
modules/task-queue.js            fila ordenada e contadores
modules/state-manager.js         estado persistente e recuperação após reinício
modules/task-validator.js        código NL, comando, status
modules/error-handler.js         mensagens em português com etapa e sugestão
modules/constants.js
content/selectors.js             todos os seletores (NeuroLaudos IA e ChatGPT)
content/dom-observer.js          esperas por estado, cliques e digitação
content/neurolaudos.js           botão, painel e ações na avaliação
content/chatgpt.js               conversa, plugin, envio, estado da resposta
ui/panel.*                       painel de acompanhamento (iframe da extensão)
popup/popup.*                    resumo, endereços e configurações
assets/icons/                    ícones (scripts/make-icons.py)
tests/                           testes automatizados e páginas sintéticas
```
