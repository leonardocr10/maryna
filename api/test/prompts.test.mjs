// Synthetic data only (AGENTS.md rule 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import {instrumentGuides, depthRule, generationParams, isReasoningModel, promptFor, WORD_LIMITS, SYSTEM_INSTRUCTIONS} from '../src/prompts.mjs';

test('Wechsler scales get their own guide and the longer depth', () => {
  const g = instrumentGuides('[{"type":"table","rows":[["WAIS-III","QI"],["Compreensão verbal","90"]]}]');
  assert.deepEqual(g.ids, ['wechsler']);
  assert.equal(g.multi, true);
  assert.match(g.text, /ESTRUTURA NARRATIVA PARA WAIS-III/);
  assert.match(depthRule('inteligencia', g.multi), /280 a 400 palavras/);
  assert.equal(g.examples.length, 1);
  assert.match(g.examples[0], /^Os resultados obtidos no WAIS-III/);
});

test('other instruments are recognised by name, without false matches', () => {
  assert.deepEqual(instrumentGuides('Teste dos Cinco Dígitos - leitura, contagem, escolha').ids, ['fdt']);
  assert.deepEqual(instrumentGuides('RAVLT A1 A2 A3').ids, ['ravlt']);
  assert.deepEqual(instrumentGuides('Tabela Resultados DIVA-5.').ids, ['diva']);
  assert.deepEqual(instrumentGuides('BATERIA FATORIAL DA PERSONALIDADE').ids, ['bfp']);
  assert.deepEqual(instrumentGuides('Relato de ansiedade e depressão na anamnese').ids, []);
  assert.equal(instrumentGuides('').text, '');
});

test('interpretation prompt asks for one long paragraph without numbers, categories or diagnosis', () => {
  const p = promptFor('inteligencia');
  assert.match(p, /único parágrafo extenso/);
  assert.match(p, /nenhum algarismo/);
  assert.match(p, /não afirme significância estatística/);
  assert.match(p, /não estabeleça diagnósticos/);
  assert.doesNotMatch(p, /até \d+ palavras/);
  assert.match(SYSTEM_INSTRUCTIONS, /não uma auditoria psicométrica/);
  assert.equal(WORD_LIMITS.inteligencia, 400);
});

test('reasoning settings only for models that accept them', () => {
  assert.equal(isReasoningModel('gpt-6.1-terra'), true);
  assert.equal(isReasoningModel('gpt-4.1'), false);
  assert.deepEqual(generationParams('gpt-6.1-terra').reasoning, {effort: 'medium'});
  assert.equal(generationParams('gpt-6.1-terra').text.verbosity, 'high');
  assert.equal(generationParams('gpt-4.1').reasoning, undefined);
  assert.equal(generationParams('gpt-4.1').text.verbosity, undefined);
});

test('every section follows the same writing standard, with reference length instead of a cap', () => {
  for (const key of ['demanda', 'conclusao', 'recomendacoes']) {
    const p = promptFor(key);
    assert.match(p, /PADRÃO DE REDAÇÃO/, key);
    assert.doesNotMatch(p, /até \d+ palavras/, key);
    assert.match(depthRule(key, false), /Extensão de referência/, key);
  }
  // the anamnesis has its own writing standard (narrative by topic) and a length that follows the notes
  assert.match(promptFor('anamnesis'), /REDAÇÃO:/);
  assert.doesNotMatch(promptFor('anamnesis'), /até \d+ palavras/);
  assert.match(depthRule('anamnesis', false), /proporcional/);
  assert.match(promptFor('anamnesis'), /"## Título do tópico"/);
  assert.match(promptFor('recomendacoes'), /"Psicoterapia: \.\.\."/);
});

test('a clinic guide replaces the default guide of that instrument only', async () => {
  const {instrumentGuides} = await import('../src/prompts.mjs');
  const text = JSON.stringify([{type: 'table', rows: [['Stroop', 'RAVLT']]}]);
  const out = instrumentGuides(text, {stroop: 'GUIA DA CLÍNICA SINTÉTICO'});
  assert.match(out.text, /GUIA DA CLÍNICA SINTÉTICO/);
  assert.match(out.text, /RAVLT/);
});
