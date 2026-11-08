// Devolutiva schedule spreadsheet parsing. Synthetic rows only (no real patients).
import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaFromCsv, agendaStatus, dateInText, parseCsv, readiness, agendaLinks} from '../src/agenda.mjs';

const CSV = '﻿PACIENTE;IDADE;SUSPEITA DIAGNOSTICA;TESTE A SER APLICADO;INICIO;PRONTOS?;DEVOLUTIVA\r\n' +
  'Paciente Teste Um;6;;finalizado dia 13/05/2026;;;OK DIA 09/06/2026\r\n' +
  'PACIENTE TESTE DOIS ;42;"FALTA FORMULARIOS; sessão familiar";FINALIZADO DIA 18/05/2026;CONVENIO X;pronto;\r\n' +
  ';;;;;;\r\n' +
  'Paciente Três;;volta em agosto;;;;retorna so em agosto\r\n' +
  'Paciente Quatro;30;;FINALIZADO DIA 31/02/2026;;;DEVOLUTIVA DIA 11/11/2026\r\n';

test('parseCsv keeps quoted separators and strips the BOM', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows[0][0], 'PACIENTE');
  assert.equal(rows[2][2], 'FALTA FORMULARIOS; sessão familiar');
});

test('agendaFromCsv maps columns, skips blank lines and keeps texts as typed', () => {
  const rows = agendaFromCsv(CSV);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], {patient_name: 'Paciente Teste Um', age_text: '6', notes: '', tests_text: 'finalizado dia 13/05/2026',
    tests_done_date: '2026-05-13', start_text: '', readiness: 'Não', delivery_text: 'OK DIA 09/06/2026', delivery_date: '2026-06-09'});
  assert.equal(rows[1].patient_name, 'PACIENTE TESTE DOIS');
  assert.equal(rows[1].start_text, 'CONVENIO X');
  assert.equal(rows[1].readiness, 'Sim', 'any text in PRONTOS? means Sim');
  assert.equal(rows[1].notes, 'Prontos: pronto · FALTA FORMULARIOS; sessão familiar', 'the old text moves to the notes');
  assert.equal(rows[1].delivery_date, null);
  assert.equal(rows[2].delivery_text, 'retorna so em agosto');
  assert.equal(rows[3].tests_done_date, null, 'impossible date is not stored');
  assert.equal(rows[3].delivery_date, '2026-11-11');
});

test('agendaFromCsv refuses a file without the patient column', () => {
  assert.throws(() => agendaFromCsv('NOME;IDADE\nX;1'), /PACIENTE/);
});

test('dateInText and agendaStatus', () => {
  assert.equal(dateInText('OK  DIA 3/7/26'), '2026-07-03');
  assert.equal(dateInText('sem data'), null);
  assert.equal(agendaStatus(null, '2026-11-08'), 'pendente');
  assert.equal(agendaStatus('2026-11-08', '2026-11-08'), 'feita');
  assert.equal(agendaStatus('2026-11-11', '2026-11-08'), 'agendada');
});

test('readiness is a Sim/Não choice', () => {
  assert.deepEqual(readiness(''), {value: 'Não', moved: ''});
  assert.deepEqual(readiness('não'), {value: 'Não', moved: ''});
  assert.deepEqual(readiness(' Sim '), {value: 'Sim', moved: ''});
  assert.deepEqual(readiness('OK DIA 09/06/2026'), {value: 'Sim', moved: 'OK DIA 09/06/2026'});
});

test('agendaLinks pairs sheet rows with evaluations by patient name, one each, newest first', () => {
  const sheet = [{id: 'r1', patient_name: 'Paciente Três ', position: 1}, {id: 'r2', patient_name: 'PACIENTE TRES', position: 5},
    {id: 'r3', patient_name: 'Outra Pessoa', position: 2}];
  const evals = [{id: 'old', name: 'paciente  três', created_at: '2026-01-01'}, {id: 'new', name: 'Paciente Tres', created_at: '2026-06-01'}];
  assert.deepEqual(agendaLinks(sheet, evals), [{row: 'r2', evaluation: 'new'}, {row: 'r1', evaluation: 'old'}]);
  assert.deepEqual(agendaLinks(sheet, []), []);
});
