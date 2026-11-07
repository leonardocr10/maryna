import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changedPercent, qualityBySection} from '../src/quality.mjs';

test('change percentage between the AI text and the approved one', () => {
  const ai = 'A paciente apresentou atenção preservada nas tarefas propostas durante a avaliação.';
  assert.equal(changedPercent(ai, ai), 0);
  assert.equal(changedPercent(ai, 'Texto completamente diferente escrito pela psicóloga.'), 100);
  const small = changedPercent(ai, 'A paciente apresentou atenção preservada nas tarefas propostas ao longo da avaliação.');
  assert.ok(small > 0 && small < 50, String(small));
  assert.equal(changedPercent('', ''), 0);
});

test('per section summary, most changed first, sections without AI text ignored', () => {
  const rows = [
    {section_key: 'memoria', ai_text: 'um dois três quatro', content: 'um dois três quatro'},
    {section_key: 'memoria', ai_text: 'um dois três quatro', content: 'outro texto inteiro novo'},
    {section_key: 'atencao', ai_text: 'cinco seis sete oito', content: 'nove dez onze doze'},
    {section_key: 'conclusao', ai_text: null, content: 'escrita à mão'},
  ];
  const out = qualityBySection(rows);
  assert.deepEqual(out.map(r => r.section_key), ['atencao', 'memoria']);
  assert.deepEqual(out[1], {section_key: 'memoria', texts: 2, avg_changed: 50, max_changed: 100, unchanged: 1});
});
