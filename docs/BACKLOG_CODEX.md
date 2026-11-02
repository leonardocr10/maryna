# Backlog executável — sequência sugerida ao Codex

## P0 — segurança / consistência
- [ ] Criar fixtures DOCX com dados 100% sintéticos: tabelas, sete marcadores, anamnese e cabeçalho.
- [ ] Testes automatizados Python worker: exatamente oito pontos, não alterar tabelas nem escores, layout mantido.
- [ ] Sanitizar/extrair somente seções necessárias do DOCX para envio à IA: evite envio irrestrito de todas as tabelas.
- [ ] Implementar pseudonimização robusta de identidade e controle de acesso e retenção com avaliação de impacto de privacidade.
- [ ] Endurecer upload (zip bomb, MIME, malware scan, limites, timeouts de worker) e log redaction.
- [ ] MFA, gestão de contas, RBAC efetivo para estagiária x psicóloga e recuperação segura de acesso.
- [ ] Completar revisão da profissional: aprovação rastreável por usuário, timestamp e bloqueio da versão editada.

## P1 — funcional
- [ ] Implementar visualização lado a lado: original, dados extraídos, texto proposto e histórico.
- [ ] Mostrar avisos de dados ausentes e inconsistências entre documentos.
- [ ] Extrair RAVLT, WISC-IV, BPA, FDT, DIVA e demais testes com origem por tabela/célula; nunca calcular normas sem fonte licenciada.
- [ ] Prompts editáveis por seção com versões e testes controlados (sem dados reais).
- [ ] Validar respostas da API OpenAI com esquema JSON estrito e limite de saída; lidar com erro, timeout e retry sem duplicar geração.
- [ ] Finalizar exportação DOCX fiel ao modelo e PDF, com comparação visual automatizada.
- [ ] Implementar painel de consumo/custos estimados da IA e orçamento por usuário.
- [ ] Completude configurável de seções por grupo etário e modelo de laudo.
- [ ] Editor rico com estilos e impressão.

## P2 — operação
- [ ] Backup e restauração testados, criptografia at-rest no MySQL, rotação de segredos e ciclo de retenção.
- [ ] Histórico de auditoria imutável, monitoramento e alertas.
- [ ] Deploy HTTPS com proxy, domínios e CI/CD, teste e2e e manual clínico.
- [ ] Biblioteca de textos fixos/base conceitual e referências validadas.
- [ ] Administração dos modelos infantis/adultos e atualização controlada.

## Critérios de aceite do fluxo principal
1. Dado usuário autenticado e avaliação nova, não gerar nada sem os dois DOCX.
2. Quando ambos anexados, leitura retorna 1 anamnese e 7 marcadores de interpretação no modelo de referência.
3. Geração fornece texto sugestivo para revisão sem substituir as tabelas.
4. Edição produz nova versão e audit log.
5. Apenas profissional com papel permitido aprova e exporta, mantendo original idêntico.
6. Sem chave API, nenhum dado é transmitido externamente; com chave, a autorização é explícita.
