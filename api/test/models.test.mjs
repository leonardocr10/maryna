// Synthetic inspect results only: no real document or patient data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {modelReport, modelInput, isFilled} from '../src/models.mjs';

const ALL = ['demanda', 'anamnesis', 'inteligencia', 'percepcao', 'memoria', 'atencao', 'funcoes_executivas', 'comportamento', 'conclusao', 'recomendacoes'];
const inspected = (keys, extra = {}) => ({
  markers: keys.map((key, index) => ({key, index, label: key, existing_paragraphs: 0, existing_text: ''})),
  title_ranges: {}, titled_domains: [], elements: [{type: 'table', rows: []}, {type: 'p', text: 'x'}],
  identification: {'Nome': '', 'Data de nascimento': '___/___/____'}, ...extra,
});

test('blank placeholders are not patient data', () => {
  for (const v of ['', '   ', '____', '___/___/____', '{{paciente_nome}}', '[nome]', '...']) assert.equal(isFilled(v), false, v);
  for (const v of ['Fulano de Tal', '12 anos', '01/02/2015']) assert.equal(isFilled(v), true, v);
});

test('complete model', () => {
  const r = modelReport(inspected(ALL), 'infantil');
  assert.equal(r.status, 'complete');
  assert.equal(r.ready, r.total);
  assert.equal(r.blank, true);
  assert.equal(r.tables, 1);
  assert.deepEqual(r.identification, [{label: 'Nome', filled: false}, {label: 'Data de nascimento', filled: false}]);
  assert.equal(r.sections.find(s => s.key === 'personalidade').state, 'optional');
});

test('missing sections and title without field', () => {
  const r = modelReport(inspected(ALL.filter(k => k !== 'memoria' && k !== 'atencao'), {title_ranges: {atencao: [3, 5]}, titled_domains: ['atencao']}), 'infantil');
  assert.equal(r.status, 'incomplete');
  assert.equal(r.sections.find(s => s.key === 'memoria').state, 'missing');
  assert.equal(r.sections.find(s => s.key === 'atencao').state, 'auto');
  assert.match(r.warnings[0].text, /Memória e aprendizagem/);
});

test('percepção is only required for children', () => {
  const keys = ALL.filter(k => k !== 'percepcao');
  assert.equal(modelReport(inspected(keys), 'adulto').status, 'complete');
  assert.equal(modelReport(inspected(keys), 'infantil').status, 'incomplete');
});

test('filled identification blocks the model and never returns the value', () => {
  const r = modelReport(inspected(ALL, {identification: {'Nome': 'Paciente Sintético'}}), 'adulto');
  assert.equal(r.blank, false);
  assert.equal(r.status, 'incomplete');
  assert.doesNotMatch(JSON.stringify(r), /Sintético/);
});

test('old text, order and duplicates are flagged', () => {
  const ins = inspected(['anamnesis', 'demanda', ...ALL.slice(2), 'memoria']);
  ins.markers[2].existing_paragraphs = 2;
  const r = modelReport(ins, 'infantil');
  assert.equal(r.status, 'attention');
  const text = r.warnings.map(w => w.text).join(' ');
  assert.match(text, /fora da ordem/);
  assert.match(text, /repetido: Memória/);
  assert.match(text, /texto antigo .*Habilidades intelectuais/);
});

test('metadata input is normalised', () => {
  const v = modelInput({name: '  Laudo   adulto ', audience: 'x', tags: '["TDAH"," TDAH ","a"]', active: 'false'});
  assert.deepEqual(v, {name: 'Laudo adulto', description: '', audience: 'geral', tags: ['TDAH'], active: false});
});

import {structureOf, compareToModel} from '../src/models.mjs';

test('structure lists fields, title-only sections and tables', () => {
  const s = structureOf({markers: [{key: 'memoria'}, {key: 'atencao'}], title_ranges: {memoria: [1, 2], inteligencia: [3, 4]}}, k => ({memoria: 2, inteligencia: 1}[k] || 0));
  assert.deepEqual(s, {fields: ['memoria', 'atencao'], titled: ['inteligencia'], tables: {inteligencia: 1, memoria: 2}});
});

test('comparison flags missing sections, missing fields and fewer tables', () => {
  const model = {fields: ['memoria', 'atencao', 'inteligencia'], titled: [], tables: {memoria: 2, atencao: 1}};
  const base = {fields: ['memoria'], titled: ['inteligencia', 'comportamento'], tables: {memoria: 1}};
  const r = compareToModel(model, base);
  assert.equal(r.ok, false);
  const t = r.items.map(i => i.level + ': ' + i.text).join('\n');
  assert.match(t, /danger: Processos atencionais: existe no modelo e falta/);
  assert.match(t, /warn: Habilidades intelectuais: o modelo tem o campo/);
  assert.match(t, /warn: Memória e aprendizagem: o modelo tem 2 tabelas e o arquivo tem 1/);
  assert.match(t, /info: Comportamento: está no arquivo, mas não no modelo/);
  assert.equal(compareToModel(model, model).ok, true);
  assert.equal(compareToModel(model, model).items.length, 0);
});

test('tables are counted only in result sections', () => {
  const s = structureOf({markers: [{key: 'anamnesis'}, {key: 'memoria'}], title_ranges: {}}, () => 4);
  assert.deepEqual(s.tables, {memoria: 4});
});
