// Unit tests of the framework-free dictation logic (Node runs the .ts file with type stripping).
// Synthetic sentences only (AGENTS.md rule 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import {TranscriptAssembler, TurnDetector, fitInsertion, rms, dictationMessage, dictationFailure, clock} from '../src/app/dictation/dictation-text.ts';

test('deltas are provisional and the completed transcript replaces them without duplication', () => {
  const a = new TranscriptAssembler();
  a.committed('item_1', null);
  a.delta('item_1', 'A atenção ');
  a.delta('item_1', 'sustentada');
  assert.equal(a.preview(), 'A atenção sustentada');
  assert.deepEqual(a.completed('item_1', 'A atenção sustentada foi preservada.'), ['A atenção sustentada foi preservada.']);
  assert.equal(a.preview(), '');
  // A repeated completion (retransmission) or late delta for the same item is ignored.
  assert.deepEqual(a.completed('item_1', 'A atenção sustentada foi preservada.'), []);
  a.delta('item_1', 'extra');
  assert.equal(a.preview(), '');
  assert.equal(a.pending(), 0);
});

test('confirmed text is released in speaking order even when completions arrive out of order', () => {
  const a = new TranscriptAssembler();
  a.committed('i1', null); a.committed('i2', 'i1'); a.committed('i3', 'i2');
  assert.deepEqual(a.completed('i2', 'segunda frase.'), []);
  assert.deepEqual(a.completed('i3', 'terceira frase.'), []);
  assert.deepEqual(a.completed('i1', 'Primeira frase.'), ['Primeira frase.', 'segunda frase.', 'terceira frase.']);
});

test('items first seen by a delta keep their order; previous_item_id places late commits', () => {
  const a = new TranscriptAssembler();
  a.delta('i1', 'um');
  a.committed('i3', 'i1');
  a.committed('i2', 'i1');
  assert.deepEqual(a.completed('i1', 'Um.'), ['Um.']);
  assert.deepEqual(a.completed('i3', 'Três.'), []);
  assert.deepEqual(a.completed('i2', 'Dois.'), ['Dois.', 'Três.']);
});

test('a failed turn is not inserted; its partial text and pending text are kept as unconfirmed', () => {
  const a = new TranscriptAssembler();
  a.committed('i1'); a.delta('i1', 'memória operacional');
  a.committed('i2', 'i1'); a.delta('i2', 'velocidade de');
  assert.deepEqual(a.failed('i1'), []);
  assert.equal(a.hasUnconfirmed(), true);
  assert.equal(a.takeUnconfirmed(), 'memória operacional velocidade de');
  assert.equal(a.pending(), 0);
  assert.equal(a.takeUnconfirmed(), '');
  assert.deepEqual(a.completed('i2', 'tarde demais'), [], 'items dropped after a connection loss never come back');
});

test('empty transcripts are dropped but do not block the next turns', () => {
  const a = new TranscriptAssembler();
  a.committed('i1'); a.committed('i2', 'i1');
  assert.deepEqual(a.completed('i2', 'Depois.'), []);
  assert.deepEqual(a.completed('i1', '   '), ['Depois.']);
});

test('insertion keeps existing text and adds only spacing and sentence capitalisation', () => {
  assert.equal(fitInsertion('', '', 'a paciente compareceu.'), 'A paciente compareceu.');
  assert.equal(fitInsertion('Texto digitado.', '', 'nova frase.'), ' Nova frase.');
  assert.equal(fitInsertion('A paciente', '', 'compareceu às sessões'), ' compareceu às sessões');
  assert.equal(fitInsertion('A paciente ', 'às sessões.', 'compareceu'), 'compareceu ');
  assert.equal(fitInsertion('Resultado', ', depois', 'preservado'), ' preservado');
  assert.equal(fitInsertion('Linha 1\n', '', 'segunda linha'), 'Segunda linha');
  assert.equal(fitInsertion('(', ')', 'TDAH'), 'TDAH');
  assert.equal(fitInsertion('Fim', '', '. Outra'), '. Outra');
  assert.equal(fitInsertion('x', 'y', '   '), '');
  assert.equal(fitInsertion('', '', 'WISC-V  aplicado'), 'WISC-V aplicado');
});

test('turn detector commits after a pause following speech, never on silence alone', () => {
  const d = new TurnDetector(700, 20000);
  let t = 0, commits = 0;
  for (; t < 2000; t += 50) if (d.feed(0.001, t)) commits++;
  assert.equal(commits, 0, 'silence only');
  for (; t < 3000; t += 50) if (d.feed(0.2, t)) commits++;
  assert.equal(d.hasSpeech(), true);
  for (; t < 3600; t += 50) if (d.feed(0.001, t)) commits++;
  assert.equal(commits, 0, 'pause shorter than 700 ms');
  for (; t < 4500; t += 50) if (d.feed(0.001, t)) commits++;
  assert.equal(commits, 1);
  assert.equal(d.hasSpeech(), false);
});

test('turn detector closes very long turns so confirmed text keeps flowing', () => {
  const d = new TurnDetector(700, 5000);
  let commits = 0;
  for (let t = 0; t <= 11000; t += 50) if (d.feed(0.3, t)) commits++;
  assert.equal(commits, 2);
});

test('rms and clock helpers', () => {
  assert.equal(rms([]), 0);
  assert.equal(rms([0.5, -0.5]), 0.5);
  assert.equal(clock(0), '0:00');
  assert.equal(clock(905), '15:05');
});

test('every failure has a message in Portuguese', () => {
  assert.match(dictationMessage({name: 'NotAllowedError'}), /negado/);
  assert.match(dictationMessage({name: 'NotFoundError'}), /Nenhum microfone/);
  assert.match(dictationMessage({name: 'NotReadableError'}), /em uso/);
  assert.match(dictationMessage(dictationFailure('connection')), /conexão.*caiu/);
  assert.match(dictationMessage(dictationFailure('insecure')), /HTTPS/);
  assert.match(dictationMessage(dictationFailure('server', 'Limite diário atingido')), /Limite diário/);
  assert.match(dictationMessage(new Error('x')), /Falha no ditado/);
});
