// Anamnesis prompt and comparison helpers, with simulated answers only (no API call).
import test from 'node:test';
import assert from 'node:assert/strict';
import {promptFor, systemFor, ANAMNESIS_SYSTEM, SYSTEM_INSTRUCTIONS, generationParams, depthRule, manualRoleFor} from '../src/prompts.mjs';
import {metalanguageTerms} from '../src/wording.mjs';
import {configs, request, score} from '../scripts/anamnesis-compare-lib.mjs';
import {ANAMNESIS_CASES} from '../scripts/anamnesis-cases.mjs';

test('anamnesis has its own system prompt, without the interpretation rules', () => {
  assert.equal(systemFor('anamnesis'), ANAMNESIS_SYSTEM);
  assert.equal(systemFor('memoria'), SYSTEM_INSTRUCTIONS);
  assert.doesNotMatch(ANAMNESIS_SYSTEM, /termine com uma síntese|quais capacidades/);
  assert.match(ANAMNESIS_SYSTEM, /JSON/);
  assert.doesNotMatch(manualRoleFor('anamnesis'), /JSON/, 'manual ChatGPT mode answers in plain text');
});

test('anamnesis task forbids transcription wording and keeps the fidelity rules', () => {
  const p = promptFor('anamnesis');
  for (const t of ['a anotação registra', 'consta o registro', 'fraturou o cox', '## Título do tópico', 'não transforme hipótese em fato']) assert.ok(p.includes(t), t);
  assert.match(depthRule('anamnesis'), /proporcional/);
});

test('anamnesis uses low reasoning and high verbosity; other sections keep their settings', () => {
  const a = generationParams('gpt-6.1-terra', 'anamnesis'), m = generationParams('gpt-6.1-terra', 'memoria');
  assert.deepEqual([a.reasoning.effort, a.text.verbosity, a.max_output_tokens], ['low', 'high', 6000]);
  assert.deepEqual([m.reasoning.effort, m.max_output_tokens], ['medium', 16000]);
  assert.equal(generationParams('gpt-4.1', 'anamnesis').reasoning, undefined, 'non-reasoning models get no reasoning field');
});

test('metalanguage detector finds transcription phrases, not normal prose', () => {
  assert.deepEqual(metalanguageTerms('A anotação registra que sai cedo. Consta o registro de febre.'), ['a anotação', 'consta o registro']);
  assert.deepEqual(metalanguageTerms('Costuma acordar por volta das 6h e é conduzida à escola pela mãe.'), []);
});

test('comparison builds A, B and C with the same notes; D only when asked', () => {
  const c = ANAMNESIS_CASES[0];
  const list = configs('gpt-6.1-terra');
  assert.deepEqual(list.map(x => x.id), ['A', 'B', 'C']);
  assert.equal(configs('gpt-6.1-terra', 'gpt-6.1-sol').length, 4);
  const [a, b, cc] = list.map(cfg => request(cfg, c));
  assert.ok(a.input[0].content.includes('anotacoes_anamnese') && b.input[0].content.includes('relato_da_entrevista'));
  assert.deepEqual([b.reasoning.effort, cc.reasoning.effort], ['low', 'medium']);
  assert.equal(b.store, false);
});

test('score flags invented facts and metalanguage in a simulated answer', () => {
  const c = ANAMNESIS_CASES[0];
  const bad = score(c, '## Rotina\n\nA examinada acorda às 6h. A anotação registra Sai às 11h25. Tem TDAH e fratura do cóccix.');
  assert.deepEqual(bad.invented, ['TDAH', 'cóccix']);
  assert.ok(bad.metalanguage.length);
  const good = score(c, '## Rotina e Atividades Diárias\n\n[PRIMEIRO_NOME] costuma acordar por volta das 6h para se preparar para a escola, apresentando lentidão durante a organização pessoal. Geralmente, não realiza o café da manhã e é conduzida à instituição de ensino pela mãe, permanecendo em aula até aproximadamente 11h25.');
  assert.deepEqual(good.invented, []);
  assert.deepEqual(good.metalanguage, []);
  assert.equal(good.topics, 1);
});
