import test from 'node:test';
import assert from 'node:assert/strict';
import {genderOf, genderProblems, genderRule} from '../src/gender.mjs';

test('genderOf reads the registration field', () => {
  assert.equal(genderOf('Feminino'), 'f');
  assert.equal(genderOf(' masculino '), 'm');
  for (const v of ['Não informar', '', null, undefined]) assert.equal(genderOf(v), null);
});

test('rule names the right wording, including the neutral case', () => {
  assert.match(genderRule('f'), /sempre "a examinada"/);
  assert.match(genderRule('m'), /sempre "o examinado"/);
  assert.match(genderRule(null), /não presuma/);
});

test('flags wording that contradicts the informed sex', () => {
  assert.deepEqual(genderProblems('f', 'O examinado foi encaminhado. Relato do paciente.'), ['O examinado', 'do paciente']);
  assert.deepEqual(genderProblems('m', 'A examinada relatou. Queixa da paciente.'), ['A examinada', 'da paciente']);
});

test('accepts correct wording and does not flag when sex is unknown', () => {
  assert.deepEqual(genderProblems('f', 'A examinada foi encaminhada. Relato da paciente.'), []);
  assert.deepEqual(genderProblems('m', 'O examinado foi encaminhado. Relato do paciente.'), []);
  assert.deepEqual(genderProblems(null, 'O examinado e a examinada.'), []);
});
