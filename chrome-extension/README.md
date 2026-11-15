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

Por padrão todas as seções usam **uma única conversa do ChatGPT** (o `@NeuroLaudos IA` vai só na primeira mensagem); desligue a opção para abrir conversa nova em cada seção. O ChatGPT trabalha **em segundo plano**: a aba abre ao lado sem tirar você do NeuroLaudos IA e só vem para frente quando o ChatGPT pede sua autorização ou algo dá errado (se um controle do ChatGPT não responder em segundo plano, a extensão traz a aba e tenta de novo, nunca reenviando a mensagem). Desligue em **Configurações** no ícone da extensão. O painel lembra as últimas escolhas (modo, erro, imagens, conversa); seções com texto começam sempre em "Gerar rascunho mesmo assim".

## Instalação (manual, sem a Chrome Web Store)

O próprio NeuroLaudos IA mostra estes passos: em **Conferir seções**, clique em **Modo automático** sem a extensão instalada e a janela **Instalar o Modo automático** traz o botão **Baixar extensão (.zip)** (arquivo servido pelo app em `assets/extensao/`). Com a extensão instalada, o mesmo botão abre o painel.

1. Descompacte `neurolaudos-modo-automatico.zip` numa pasta fixa (ex.: `C:\NeuroLaudos\extensao`). Não apague a pasta depois: o Chrome usa os arquivos dela.
2. Abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta que contém `manifest.json`.
5. Fixe o ícone do robô na barra do Chrome (quebra-cabeça > alfinete).

Requisitos: Chrome 116 ou mais novo (Windows). No NeuroLaudos IA, o método **ChatGPT — plugin (MCP)** precisa estar ligado (`CHATGPT_MCP_ENABLED=true` e `PUBLIC_BASE_URL` https; veja `docs/CHATGPT_INTEGRACAO.md`) e o plugin precisa estar conectado à sua conta no ChatGPT.

## Configuração

- **Endereço do NeuroLaudos IA.** Já funcionam `http://localhost:9091`, `http://127.0.0.1:9091` e `https://66-94-100-166.sslip.io` (produção). Em qualquer outro endereço (IP da rede, https), abra o NeuroLaudos IA, clique no ícone da extensão e em **Ativar neste site**: o Chrome pede permissão só para esse endereço e a página recarrega. Sem isso, o app continua mostrando "Instalar o Modo automático" mesmo com a extensão instalada. Para outro endereço (ex.: o https da clínica), clique no ícone da extensão > **Endereços do NeuroLaudos IA** > cole o endereço > **Adicionar**. O Chrome pede permissão só para esse endereço. Recarregue a aba do NeuroLaudos IA (F5).
- **Configurações** (no mesmo popup): espera máxima pela resposta do ChatGPT (padrão 15 min, inclui o tempo da sua autorização), espera pelo rascunho no NeuroLaudos IA (120 s) e tentativas automáticas por seção antes de enviar a mensagem (1).
- Esteja conectada no NeuroLaudos IA e no ChatGPT (chatgpt.com) antes de iniciar.

## Como usar

1. Abra a avaliação no NeuroLaudos IA, etapa **Conferir seções**.
2. Clique em **Modo automático** (botão verde ao lado de "Aprovar todas").
3. No painel, escolha o modo (Automático ou Assistido), a política para seções com texto (padrão: gerar rascunho mesmo assim, que espera sua confirmação para substituir), o que fazer em caso de erro (padrão: pausar), se usa uma única conversa do ChatGPT (padrão: sim) e se as imagens das seções vão junto (imagens não têm nomes trocados por marcadores). Passe o mouse no ⓘ para ver os detalhes.
4. Marque as seções (**Todas** / **Nenhuma**) e clique em **Gerar N seções** > confirme.
5. Para cada seção a extensão: abre a seção > abre a janela **ChatGPT** > seleciona **ChatGPT — plugin (MCP)** > reaproveita a tarefa aberta ou clica em **Preparar tarefa** > captura o código `NL-XXXX-XXXX` e o comando oficial > abre conversa nova na aba dedicada do ChatGPT > digita `@`, escolhe **NeuroLaudos IA** na lista e confere o chip do plugin > cola o comando e confere o código > envia > espera a resposta > volta ao NeuroLaudos IA e espera **Rascunho recebido** > fecha a janela > próxima seção.
6. Quando o ChatGPT pedir autorização para o plugin salvar, a extensão traz a aba do ChatGPT para frente e mostra um aviso. **Você** confere e confirma lá; a execução continua sozinha depois.
7. No fim, o painel mostra o relatório por seção (recebido, revisão necessária, erro, ignorada). Revise e aprove cada seção no NeuroLaudos IA, como sempre.

Controles: **Pausar** (não começa nada novo; a seção em andamento continua de onde parou), **Continuar** (confere de novo o status real e retoma da etapa segura), **Parar** (encerra; nada é apagado), **Ver detalhes** (códigos, etapas, erros e registro). Em erro, aparecem também **Tentar de novo**, **Pular seção** e, se o plugin não foi confirmado, **Já selecionei o plugin**.

### Várias avaliações de uma vez (lote; em paralelo desde a 1.0.9)

1. Na lista **Avaliações**, marque até **10** avaliações (caixa por linha, ou a do cabeçalho para a página). Aprovadas não podem ser marcadas.
2. Clique em **Modo automático (N)**. O painel abre com a lista escolhida e as opções do lote, entre elas a escolha das seções e a instrução da Conclusão de cada avaliação. Por padrão o lote é uma **fila**: uma avaliação por vez, na ordem escolhida (a lista mostra Aguardando, Em andamento, Concluída ou Com falhas). Rodar várias ao mesmo tempo (1 a N) fica em **Avançado** e não é recomendado: abas do ChatGPT em paralelo causaram seções incompletas.
   - **Refazer o que faltou**: por avaliação ou para a fila toda, recoloca na fila só as seções sem rascunho (erro, expiradas, não alcançadas); as já recebidas não são enviadas de novo.
   - **Projeto do ChatGPT** (menu da extensão > Configurações): cole o endereço de um projeto (`https://chatgpt.com/g/g-p-…/project`) e as conversas abrem dentro dele, fora de Recentes. Se não for encontrado, usa conversas comuns e o painel avisa. Não ponha nome de paciente no projeto.
3. Cada avaliação em andamento ganha a sua **raia**: uma aba do NeuroLaudos IA (a primeira é a aba onde você clicou; as outras são cópias dela, abertas em segundo plano, para levar o login) e uma aba do ChatGPT com as suas conversas. Quando uma avaliação termina, a raia pega a próxima da fila.
4. O painel mostra um cartão por avaliação ativa (seção atual, código da tarefa, etapa e tempo), o progresso do lote e a lista de avaliações. **Pausar todas**, **Continuar todas**, **Parar** e **Continuar de onde parou** valem para o lote; um erro pausa só a raia daquela avaliação, com **Continuar**, **Tentar de novo**, **Pular seção** e **Pular avaliação** no cartão dela.

Regras do lote:

- **Dentro de cada avaliação, uma seção por vez**, sempre em **conversa nova do ChatGPT** e só com os dados dela (a opção "uma única conversa" fica desligada no lote).
- **Envios espaçados para a conta inteira**: entre duas mensagens ao ChatGPT, de qualquer raia, há pelo menos `batchGapSeconds` (padrão 20 s). A geração das respostas é que roda ao mesmo tempo.
- **Limite de uso do ChatGPT**: o limite é da conta, não da aba. Quando aparece, todas as raias param de enviar por `rateLimitMinutes` (padrão 10 min) e a seção que bateu no limite é enviada de novo **na mesma aba do ChatGPT e com a mesma tarefa**, só se o NeuroLaudos IA mostra a tarefa ainda não lida pelo plugin (no máximo 3 vezes; depois a raia pausa).
- **Conclusão** só entra quando a instrução dela já está completa; **Recomendações** ficam de fora se a Conclusão ainda não tem texto; **Descrição da demanda** só com a opção ligada. Hipótese diagnóstica nunca vai.
- Avaliação que não abre (sem arquivo base/anamnese, somente leitura) fica como "Não foi aberta" e a raia segue com a próxima.
- **Isolamento por avaliação**: cada raia vê só a sua parte do estado; a fila é distribuída dentro da atualização serializada do estado (duas raias nunca pegam a mesma avaliação); cada pedido à página leva o id da avaliação e a página só responde se for ela que está aberta (se a aba mudou, a raia volta para a sua); o rascunho é salvo pelo servidor na avaliação e seção do código da tarefa (`NL-XXXX-XXXX`). Os nomes dos pacientes ficam só na memória da página e do painel.
- Não use as abas do lote enquanto ele roda; use outra janela.

Limitações concretas do paralelo (por isso o padrão é 3, máximo 10):

- O **limite de mensagens** do ChatGPT é por conta e por plano; com várias raias ele chega antes. A extensão não sabe o limite do seu plano: só reage quando o ChatGPT o mostra.
- O Chrome **desacelera abas em segundo plano** (temporizadores mais lentos depois de alguns minutos escondidas). As esperas da extensão reagem a mudanças da página, mas podem levar mais tempo em abas escondidas. As abas do lote não são descartadas pela economia de memória.
- Cada aba do ChatGPT usa bastante **memória** (centenas de MB); 10 raias = 20 abas.
- Cada conversa pode pedir **sua autorização** para o plugin salvar; com várias raias, os pedidos podem aparecer juntos. A extensão traz a aba certa para frente, uma de cada vez que você clicar em **ChatGPT** no cartão.

## Garantias de execução

- **Sequencial**: uma seção e uma tarefa por vez; uma execução (ou um lote) por vez em todo o Chrome.
- **Sem duplicidade**: tarefa aberta e válida da seção é reaproveitada; código expirado nunca é reutilizado; o mesmo código não serve a duas seções; seção concluída não é refeita.
- **Nunca envia duas vezes sozinha**: o horário do envio é gravado antes do clique. Depois disso, se algo falhar ou o Chrome fechar, a extensão só confere o status real; reenviar exige você clicar em **Tentar de novo**.
- **Chrome fechado e reaberto**: a execução volta **pausada**, com a seção na etapa de conferência.
- **Esperas por estado real** (MutationObserver + conferência), com limite por etapa. Nenhum clique por coordenada de tela. Se um elemento essencial não for encontrado com segurança, a extensão pausa e diz qual, em vez de clicar em algo parecido.

## Limitações conhecidas (leia antes de confiar no modo automático)

- **Interface do ChatGPT.** O ChatGPT não publica um contrato estável de interface. Os seletores (campo de mensagem, seletor `@`, chip do plugin, botões enviar/parar, botões de autorização) estão em `content/selectors.js` e foram escritos para a interface atual; podem quebrar quando ela mudar. Quando isso acontece a extensão **pausa** com a etapa e o motivo. Depois de atualizações do ChatGPT, teste no modo **Assistido** com uma seção.
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
4. Em `chrome://extensions`, clique em **Recarregar** na extensão e teste no modo **Assistido** com uma seção.

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

Casos cobertos em `tests/flow.test.mjs`: uma seção elegível; várias seções; texto fixo; seções com rascunho; seções já aprovadas; tarefa aberta de antes da execução nunca reaproveitada (código novo); nova execução começa do zero (conversa nova); tarefa expirada; plugin não selecionado (e "Já selecionei o plugin"); plugin ausente; falha de comunicação com o ChatGPT; autorização humana; limite de uso; rascunho não recebido; pausar e continuar; fechar e reabrir o Chrome; mudança de avaliação; execução simultânea; modo assistido; seção que precisa confirmar substituição; plugin MCP desligado; ChatGPT desconectado; avaliação somente leitura.

Testes de DOM em navegador (páginas sintéticas em `tests/dom/`, com `chrome.*` simulado): sirva a pasta `chrome-extension` (ex.: `python -m http.server 9097 --directory chrome-extension`) e abra `tests/dom/neurolaudos-fixture.html`, `tests/dom/chatgpt-fixture.html` ou `tests/dom/panel-preview.html` (`?view=setup|paused`). No console, `await cs({cmd: 'nl.scan'})` chama o content script como o worker faria.

Roteiro manual com o sistema real (use uma avaliação de teste com dados fictícios):

1. **Assistido** com uma seção: rascunho recebido, pausa, conferência na seção.
2. **Automático** com várias seções, incluindo uma com texto (política "Gerar mesmo assim" > **Revisão necessária**) e uma de texto fixo (ignorada).
3. Pausar durante a resposta do ChatGPT, continuar; fechar o Chrome no meio e reabrir (volta pausado, sem reenviar).
4. Desconectar o plugin no ChatGPT e iniciar: pausa com "plugin não apareceu".
5. Navegar entre telas do NeuroLaudos IA sem recarregar: o botão continua ao lado de "Aprovar todas", sem duplicar.

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
