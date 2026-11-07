// Synthetic reference cases for the AI validation suite (AGENTS.md rule 7: no real patient, no real report).
// Each case is one interpretation section with its own tables, as the server sends it, plus what the text must and must
// not contain. Add cases written by the psychologist here (always fictitious data).
const table = rows => ({type: 'table', rows});
const caption = text => ({type: 'p', text});

export const CASES = [
  {
    id: 'wechsler-adulta', section: 'inteligencia', sex: 'Feminino', age: '34 anos',
    source: [table([['WAIS-III', 'SOMA DOS ESCORES T', 'QI', 'PERCENTIL', 'CLASSIFICAÇÃO'], ['Compreensão verbal', '24', '90', '25', 'Média'], ['Organização perceptual', '38', '115', '84', 'Média Superior'], ['Memória operacional', '22', '84', '14', 'Média Inferior'], ['Velocidade de processamento', '12', '79', '8', 'Limítrofe'], ['QIT', '112', '101', '53', 'Média']]), caption('Tabela 1. Resultados dos índices avaliados.')],
    mustMention: ['organização perceptual', 'velocidade de processamento', 'compreensão verbal'],
    mustNotMention: ['TDAH', 'deficiência intelectual', 'transtorno'],
  },
  {
    id: 'bpa-crianca', section: 'atencao', sex: 'Masculino', age: '9 anos',
    source: [table([['BPA-2', 'Pontos', 'Percentil', 'Classificação'], ['Atenção concentrada', '61', '20', 'Média inferior'], ['Atenção dividida', '18', '5', 'Inferior'], ['Atenção alternada', '70', '45', 'Média'], ['Atenção geral', '149', '15', 'Média inferior']]), caption('Tabela 4. Bateria Psicológica para Avaliação da Atenção.')],
    mustMention: ['atenção dividida', 'atenção alternada'],
    mustNotMention: ['TDAH', 'déficit de atenção', 'diagnóstico'],
  },
  {
    id: 'ravlt-adolescente', section: 'memoria', sex: 'Feminino', age: '15 anos',
    source: [table([['RAVLT', 'A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'A6', 'A7', 'Reconhecimento'], ['Escore', '6', '8', '10', '11', '12', '5', '9', '8', '13']]), caption('Tabela 6. Teste de Aprendizagem Auditivo-Verbal de Rey.')],
    mustMention: ['aprendizagem', 'evocação'],
    mustNotMention: ['Alzheimer', 'demência', 'transtorno'],
  },
];
