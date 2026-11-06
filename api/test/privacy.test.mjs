// Synthetic data only (AGENTS.md rule 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import {detectTerms, buildMap, redact, restore, dateVariants, leftoverPlaceholders} from '../src/privacy.mjs';

const input = {
  patientName: 'Joana Pereira da Costa',
  birthDate: '2015-03-07',
  baseLines: ['Autora: Fulana Exemplo de Tal', 'CRP: 00/12345', 'Telefone: 11 98765-4321', 'Local de realização da avaliação: Clínica Fictícia', 'Nome: Joana Pereira da Costa', 'Data de Nascimento: 07/03/2015'],
  anamnesisLines: ['PSI MARTA QUE FAZ SESSAO COM ELA.', 'PEDIATRA DR CARLOS.', 'Estuda de manhã. colégio Arco-íris.', 'Mãe relata que Joana dorme mal.', 'Contato: mae.ficticia@example.com'],
};

test('detects patient, family of name parts, dates and cued names', () => {
  const terms = detectTerms(input);
  const values = terms.map(t => t.value);
  for (const v of ['Joana Pereira da Costa', 'Joana', 'Pereira', 'Costa', '07/03/2015', '7 de março de 2015', 'Fulana Exemplo de Tal', 'Clínica Fictícia', '11 98765-4321', '00/12345', 'Marta', 'Carlos', 'Arco-íris', 'mae.ficticia@example.com']) assert.ok(values.includes(v), v);
  assert.ok(!values.includes('Que'));
});

test('redact hides every identifying value and restore brings them back', () => {
  const map = buildMap(detectTerms(input));
  const source = {notes: input.anamnesisLines, base: input.baseLines, nested: [{t: 'JOANA nasceu em 7 de março de 2015.'}]};
  const sent = JSON.stringify(redact(source, map));
  for (const v of ['Joana', 'Pereira', 'Marta', 'Carlos', 'Arco-íris', '98765-4321', '2015', 'example.com', 'Fulana']) assert.ok(!sent.includes(v), `${v} leaked: ${sent}`);
  assert.match(sent, /\[PRIMEIRO_NOME\] dorme mal/);
  const answer = '[PRIMEIRO_NOME] ([PACIENTE]), nascida em [DATA_NASCIMENTO], acompanhada por [PESSOA_2].';
  assert.equal(restore(answer, map), 'Joana (Joana Pereira da Costa), nascida em 07/03/2015, acompanhada por Marta.');
});

test('does not touch words that merely contain a name', () => {
  const map = buildMap([{value: 'Ana', kind: 'first_name'}]);
  assert.equal(redact('Ana analisou a banana.', map), '[PRIMEIRO_NOME] analisou a banana.');
});

test('accentless variants are hidden too', () => {
  const map = buildMap([{value: 'Clínica Fictícia', kind: 'place'}]);
  assert.equal(redact('na Clinica Ficticia', map), 'na [LOCAL_1]');
});

test('ignored and extra terms', () => {
  const map = buildMap([{value: 'Carlos', kind: 'person'}], {extra: ['Tia Beth'], ignored: ['carlos']});
  assert.equal(redact('Carlos e Tia Beth', map), 'Carlos e [DADO_1]');
  assert.equal(restore('[DADO_1]', map), 'Tia Beth');
});

test('helpers', () => {
  assert.deepEqual(dateVariants('07/03/2015').slice(0, 2), ['07/03/2015', '7/3/2015']);
  assert.deepEqual(leftoverPlaceholders('ok [PESSOA_9] e [ESCORE]'), ['[PESSOA_9]', '[ESCORE]']);
});

test('lower-case surname at the end of a cued name is masked too (synthetic names)', () => {
  const terms = detectTerms({anamnesisLines: ['Dra. Fictícia sobrenometeste', 'Dra. Ana disse que melhorou', 'Psiquiatra Beto']}).map(t => t.value);
  assert.ok(terms.includes('Fictícia sobrenometeste'));
  assert.ok(terms.includes('Ana'));
  assert.ok(!terms.some(t => /disse/.test(t)));
  assert.ok(terms.includes('Beto'));
  const map = buildMap(detectTerms({anamnesisLines: ['Dra. Fictícia sobrenometeste']}));
  assert.doesNotMatch(redact('Atendida pela Dra. Fictícia sobrenometeste.', map), /sobrenometeste/);
});
