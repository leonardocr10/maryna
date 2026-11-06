// Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownTable, readableSource} from '../src/manual.mjs';

test('tables become Markdown tables with a header row', () => {
  assert.equal(markdownTable([['Teste', 'Pontos'], ['A | B', ' 10 '], ['C']]),
    '| Teste | Pontos |\n| --- | --- |\n| A \\| B | 10 |\n| C |  |');
  assert.equal(markdownTable([[''], []]), '');
});

test('section data reads as text: paragraphs, tables, age; no JSON and no field marker', () => {
  const out = readableSource({
    trecho_da_secao: [
      {type: 'p', text: 'Base conceitual fictícia.'}, {type: 'p', text: ''},
      {type: 'table', rows: [['Categoria', 'Pontos'], ['Retenção', '5']]},
      {type: 'table', rows: [['Interpretação e observações clínicas:']]},
    ],
    idade_em_anos: '30 anos',
  });
  assert.equal(out, '### Trecho desta seção no arquivo base\n\nBase conceitual fictícia.\n\n| Categoria | Pontos |\n| --- | --- |\n| Retenção | 5 |\n\nIdade: 30 anos');
  assert.doesNotMatch(out, /[{}"]|"type"/);
});

test('lists and named texts get titles', () => {
  const out = readableSource({anotacoes_anamnese: ['Nota um.', '', 'Nota dois.'], textos_das_secoes: {'Memória': 'Texto fictício.'}});
  assert.equal(out, '### Anotações da anamnese\n\nNota um.\n\nNota dois.\n\n### Textos das seções\n\n#### Memória\n\nTexto fictício.');
});
