# Backlog executável — sequência sugerida ao Codex

## P0 — segurança / consistência
- [x] Criar fixtures DOCX com dados 100% sintéticos: tabelas, sete marcadores, anamnese e cabeçalho.
- [x] Testes automatizados Python worker: exatamente oito pontos, não alterar tabelas nem escores, layout mantido.
- [x] Sanitizar/extrair somente seções necessárias do DOCX para envio à IA: evite envio irrestrito de todas as tabelas.
- [ ] Pseudonimização, papéis, consentimento por avaliação e prazo de guarda feitos; falta avaliação de impacto de privacidade (RIPD).
- [ ] Endurecer upload: zip bomb e validação DOCX feitos; faltam malware scan e log redaction.
- [ ] Gestão de contas, papéis e MFA (TOTP) feitos; falta recuperação por e-mail com serviço de envio.
- [x] Completar revisão da profissional: aprovação rastreável por usuário, timestamp e bloqueio da versão editada.

## P1 — funcional
- [x] Implementar visualização lado a lado: original, dados extraídos, texto proposto e histórico.
- [x] Mostrar avisos de dados ausentes e inconsistências entre documentos (pendências, conferência do arquivo base e conferência final antes de aprovar).
- [ ] Extrair RAVLT, WISC-IV, BPA, FDT, DIVA e demais testes com origem por tabela/célula; nunca calcular normas sem fonte licenciada.
- [ ] Prompts editáveis por seção com versões e testes controlados (sem dados reais).
- [ ] Validar respostas da API OpenAI com esquema JSON estrito e limite de saída; lidar com erro, timeout e retry sem duplicar geração.
- [ ] Finalizar exportação DOCX fiel ao modelo e PDF, com comparação visual automatizada.
- [x] Implementar painel de consumo/custos estimados da IA e orçamento por usuário.
- [ ] Completude configurável de seções por grupo etário e modelo de laudo.
- [ ] Editor rico com estilos e impressão.

## P2 — operação
- [ ] Backup criptografado diário, cópia com senha, restauração testada e prazo de guarda feitos; faltam criptografia do arquivo do banco e rotação de segredos.
- [ ] Tela de auditoria feita; faltam registro imutável (encadeado), monitoramento e alertas.
- [ ] Deploy HTTPS com proxy, domínios e CI/CD, teste e2e e manual clínico.
- [ ] Biblioteca de textos fixos: textos-padrão da clínica feitos; faltam base conceitual e referências validadas.
- [ ] Administração dos modelos infantis/adultos e atualização controlada.

## Critérios de aceite do fluxo principal
1. Dado usuário autenticado e avaliação nova, não gerar nada sem os dois DOCX.
2. Quando ambos anexados, leitura retorna 1 anamnese e 7 marcadores de interpretação no modelo de referência.
3. Geração fornece texto sugestivo para revisão sem substituir as tabelas.
4. Edição produz nova versão e audit log.
5. Apenas profissional com papel permitido aprova e exporta, mantendo original idêntico.
6. Sem chave API, nenhum dado é transmitido externamente; com chave, a autorização é explícita.
