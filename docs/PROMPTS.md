# Prompts base — editáveis no painel

## Anamnese
O texto vigente fica em `api/src/prompts.mjs` (`ANAMNESIS` e `ANAMNESIS_SYSTEM`); um texto salvo no painel substitui o padrão.
Redação narrativa por tópicos dinâmicos (só os que têm informação), parágrafos desenvolvidos, sem expressões de transcrição ("a anotação registra", "consta o registro"), sem listas e com fidelidade total ao relato (nada inventado, termo ambíguo preservado). Parâmetros: raciocínio `low`, verbosidade `high`, limite de 6.000 tokens de saída (`GENERATION.sections.anamnesis`).
Comparação com a versão anterior: `npm run comparar:anamnese` em `api/` (simulação, sem custo) ou `npm run comparar:anamnese -- --pagar` (3 chamadas pagas: A anterior, B revisado low, C revisado medium). Relatório em `api/validacao/`.

## Interpretação e observações clínicas
Redija um único parágrafo técnico, objetivo, discursivo e contextualizado; não colocar classificação no parágrafo. Use somente os resultados documentados da seção relevante e observações clínicas reais. Diferenciar habilidades preservadas, vulnerabilidades relativas e possíveis repercussões apenas quando suportadas. Não inventar tabelas ou achados. Se não houver observação direta, não alegar que ela ocorreu.

## Preferências de estilo
Texto em terceira pessoa, sem classificação explícita no corpo narrativo, sem afirmação diagnóstica automática, sem recomendações sem evidência. O texto será apresentado como RASCUNHO para validação da psicóloga.
