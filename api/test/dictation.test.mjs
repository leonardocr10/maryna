// Synthetic values only (AGENTS.md rule 7): no real keys, no patient data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {dictationConfig, clientSecretRequest, cleanKeywords, safetyId, dictationError, DICTATION_DEFAULT_MODEL} from '../src/dictation.mjs';
import {DICTATION_PROMPT, DICTATION_KEYWORDS} from '../src/prompts.mjs';

const ON = {OPENAI_API_KEY: 'sk-test-synthetic', AI_ENABLED: 'true', ALLOW_EXTERNAL_AI: 'true', DICTATION_ENABLED: 'true'};

test('dictation stays off unless every privacy gate is on', () => {
  assert.equal(dictationConfig({}).enabled, false);
  assert.equal(dictationConfig({...ON, DICTATION_ENABLED: 'false'}).enabled, false);
  assert.equal(dictationConfig({...ON, ALLOW_EXTERNAL_AI: 'false'}).enabled, false);
  assert.equal(dictationConfig({...ON, OPENAI_API_KEY: ''}).enabled, false);
  assert.match(dictationConfig({...ON, DICTATION_ENABLED: ''}).blockers[0], /DICTATION_ENABLED/);
  const c = dictationConfig(ON);
  assert.equal(c.enabled, true);
  assert.equal(c.model, DICTATION_DEFAULT_MODEL);
  assert.equal(c.delay, 'low');
});

test('limits and options are clamped; invalid model names are refused', () => {
  const c = dictationConfig({...ON, DICTATION_MAX_SECONDS: '5', DICTATION_DAILY_LIMIT: 'abc', DICTATION_DELAY: 'fast'});
  assert.equal(c.maxSeconds, 30);
  assert.equal(c.dailyLimit, 80);
  assert.equal(c.delay, 'low');
  assert.equal(dictationConfig({...ON, DICTATION_MAX_SECONDS: '99999'}).maxSeconds, 3600);
  assert.equal(dictationConfig({...ON, DICTATION_MODEL: 'x; rm -rf'}).enabled, false);
});

test('session request is transcription-only, pt, without server VAD and with a short-lived secret', () => {
  const body = clientSecretRequest(dictationConfig({...ON, DICTATION_KEYWORDS: 'Neupsilin, TDE-II'}));
  assert.equal(body.session.type, 'transcription');
  assert.ok(body.expires_after.seconds <= 120);
  const input = body.session.audio.input;
  assert.equal(input.turn_detection, null);
  assert.deepEqual(input.transcription.languages, ['pt']);
  assert.equal(input.transcription.model, 'gpt-live-transcribe');
  assert.equal(input.transcription.prompt, DICTATION_PROMPT);
  assert.ok(input.transcription.keywords.includes('Neupsilin'));
  assert.ok(input.transcription.keywords.includes('WISC-V'));
  // The standard key is never part of what is sent as session configuration.
  assert.doesNotMatch(JSON.stringify(body), /sk-test-synthetic/);
  // Nothing that asks the model to rewrite or answer: it only transcribes.
  assert.match(DICTATION_PROMPT, /exatamente o que foi dito/);
  assert.equal(body.session.instructions, undefined);
});

test('keywords are single-line, without < >, deduplicated and bounded', () => {
  assert.deepEqual(cleanKeywords(['a<b>', 'x\ny', 'TDAH', 'TDAH', ' ']), ['a b', 'x y', 'TDAH']);
  assert.ok(cleanKeywords(Array.from({length: 300}, (_, i) => 'k' + i)).length <= 100);
  for (const k of cleanKeywords(DICTATION_KEYWORDS)) assert.doesNotMatch(k, /[<>\r\n]/);
});

test('safety identifier is stable and does not reveal the user id', () => {
  assert.equal(safetyId('user-1'), safetyId('user-1'));
  assert.notEqual(safetyId('user-1'), safetyId('user-2'));
  assert.doesNotMatch(safetyId('user-1'), /user-1/);
});

test('OpenAI failures become messages without echoing request content', () => {
  assert.match(dictationError(401, {}), /chave/);
  assert.match(dictationError(404, {}), /modelo/);
  assert.match(dictationError(429, {error: {message: 'You exceeded your current quota'}}), /crédito/);
  assert.match(dictationError(503, {}), /indisponível/);
  assert.doesNotMatch(dictationError(400, {error: {message: 'secret detail'}}), /secret detail/);
});
