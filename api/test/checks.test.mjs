import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consistencyChecks, yearsBetween} from '../src/checks.mjs';

const table = rows => ({type: 'table', rows});
const base = (identification, elements = []) => ({identification, elements, markers: []});
const texts = list => list.map(x => x.text);

test('whole years between dates', () => {
  assert.equal(yearsBetween('2015-06-10', '2025-06-09'), 9);
  assert.equal(yearsBetween('2015-06-10', '2025-06-10'), 10);
  assert.equal(yearsBetween('', '2025-06-10'), null);
});

test('nothing to report when everything agrees', () => {
  const b = base({'Nome': 'Fulano Fictício', 'Data de Nascimento': '10/06/2015', 'Idade': '10 anos'}, [table([['Teste', 'Pontos'], ['A', '12']])]);
  assert.deepEqual(consistencyChecks(b, '', {patient_name: 'fulano ficticio', birth_date: '2015-06-10', start_date: '2025-07-01', end_date: '2025-08-01'}), []);
});

test('name, birth date and age that do not match', () => {
  const b = base({'Nome': 'Beltrano Sintético', 'Data de Nascimento': '11/06/2015', 'Idade': '8 anos'});
  const out = texts(consistencyChecks(b, '', {patient_name: 'Fulano Fictício', birth_date: '2015-06-10', end_date: '2025-08-01'}));
  assert.equal(out.length, 3);
  assert.match(out[0], /Nome diferente/);
  assert.match(out[1], /Data de nascimento diferente/);
  assert.match(out[2], /Idade no arquivo base \(8 anos\).*\(10 anos/);
});

test('swapped dates are an error', () => {
  const out = consistencyChecks(base({}), '', {start_date: '2025-09-01', end_date: '2025-08-01'});
  assert.equal(out[0].level, 'danger');
  assert.match(out[0].text, /Datas trocadas/);
});

test('empty result tables and instruments without results', () => {
  const b = base({}, [table([['Subteste', 'Bruto', 'Classificação'], ['Cubos', '', ''], ['Códigos', ' ', '']]), table([['Teste', 'Pontos'], ['B', '7']])]);
  const out = texts(consistencyChecks(b, 'Foi aplicado o RAVLT e o WISC-IV.', {}));
  assert.ok(out.some(t => /1 tabela de resultados está sem valores/.test(t)));
  assert.ok(out.some(t => /cita .*RAVLT.*WAIS-III \/ WISC-IV|cita .*WAIS-III \/ WISC-IV.*RAVLT/.test(t)));
});
