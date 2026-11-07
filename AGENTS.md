# Instruções permanentes para Codex — NeuroLaudos IA

Você está trabalhando no software de auxílio à elaboração de laudos neuropsicológicos. Linguagem do produto: português brasileiro.

## Regras inegociáveis
1. Toda avaliação exige upload do DOCX-base da estagiária e DOCX de anamnese da psicóloga. Nunca substituir ou sobrescrever arquivos originais.
2. Não alterar nenhum valor, escore, percentil, classificação, tabela, cabeçalho, rodapé, autor, assinatura, referência ou texto já existente no DOCX-base. Inserir apenas textos nas regiões previamente aprovadas como destino. Exceções aprovadas pela responsável, sempre por escolha e aprovação da psicóloga, nunca pela IA:
   - Partes de texto fixo sob uma caixa de título de uma célula (ex.: Fontes fundamentais de informações, Instrumentos/avaliações aplicadas, Procedimentos de análise, Instrumentos/resultados), chaves `fixo_*`: sem edição, o Word mantém os parágrafos originais; editadas e aprovadas, o texto substitui só os parágrafos logo abaixo do título.
   - A linha de local e data do fechamento ("Cidade, D de mês de AAAA."), trocada inteira pelo texto salvo na avaliação; em branco, fica a do arquivo.
   - Campos de identificação (valor após "Nome:", "Data de Nascimento:" etc.), preenchidos com os dados da avaliação.
   A Hipótese diagnóstica é região de destino escrita só pela psicóloga: a IA nunca redige diagnóstico (geração e pedido ao ChatGPT recusados).
3. Anamnese: tópicos relevantes, um ou mais parágrafos discursivos objetivos por tópico; preservar fontes (pai, mãe, responsável, próprio paciente), divergências, temporalidade e desconhecidos.
4. Interpretação: sem classificação explícita no parágrafo salvo quando psicóloga solicitar; não inventar sintomas, testes, datas, correlações ou diagnóstico. Nunca transformar mera contagem de sintomas em diagnóstico.
5. Gerar somente rascunhos de IA. Salvar geração + histórico + evidências; edição e aprovação por psicóloga; exportação apenas quando aprovada.
6. Privacidade: dados de saúde são sensíveis. Nada em logs, prompts de teste, screenshots, CI ou exemplos públicos que identifique pacientes. Integração externa desligada por padrão; exige autorização explícita e revisão de segurança.
7. Não usar os arquivos `templates/*PRIVADO*` em testes automatizados ou commits. Criar fixtures 100% sintéticas.
8. API OpenAI via backend; jamais colocar chave no frontend. Verificar se o modelo existe na conta API em runtime, sem presumir disponibilidade a partir do ChatGPT Web.
9. Valide document integrity: hash do original antes/depois, diff XML para garantir mudanças limitadas, teste de renderização e comparação visual.
10. Cada seção é gerada/regenerada (também com instrução) somente com os dados do próprio tópico: o trecho dela no DOCX-base (tabelas e textos). Interpretações não recebem anamnese nem outras seções. Exceções por natureza: Descrição da demanda e Anamnese usam a anamnese; Conclusão usa os textos das seções de resultados; Recomendações usam as seções escritas; a Devolutiva usa só os textos aprovados do laudo (nunca tabelas nem anamnese) e é um documento separado.
11. Ao concluir cada entrega, rodar testes e relatar os itens realmente prontos e os bloqueios de produção.

## Prompts da IA
Todos os prompts (papel clínico, tarefas por seção, guias por instrumento, extensão de referência e parâmetros da API) ficam em `api/src/prompts.mjs`. Não duplicar instruções no `server.mjs`. Validação manual com dados sintéticos: `node --env-file=.env scripts/validate-interpretation.mjs <modelo>` ou a suíte `npm run validar:ia -- <modelo>` em `api/` (casos em `api/scripts/validation-cases.mjs`; chamadas pagas; `--dry` só monta os pedidos). Rode a suíte depois de mudar prompts, guias ou o modelo.

## Prioridades imediatas
Ver `docs/BACKLOG_CODEX.md`.
