// Batch in parallel (several evaluations at the same time, one lane each) against synthetic pages.
// Every evaluation, section and code is made up. The section keys repeat in every evaluation on purpose: a mix-up
// between patients would show as a code, a page action or a draft on the wrong evaluation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv, section, NL_TAB} from './fakes.mjs';
import {recoverLanes, aggregate} from '../modules/lanes.js';

const READY = 'Integrar atenção e memória; relatar no final que apresenta características de desenvolvimento típico (texto sintético).';
const secs = () => [section('fixo_fontes', 'Fontes fundamentais de informações', 'fixed', 'file'), section('atencao', 'Atenção'), section('memoria', 'Memória e aprendizagem'), section('hipotese', 'Hipótese diagnóstica', 'hand'), section('conclusao', 'Conclusão')];
const ids = n => Array.from({length: n}, (_, i) => `ev-par-${String(i + 1).padStart(5, '0')}`);
const evals = (n, extra = {}) => Object.fromEntries(ids(n).map(id => [id, {sections: secs(), instruction: READY, ...(extra[id] || {})}]));
const PER_EVAL = 3;   // atenção, memória, conclusão
const run = (t, n, parallel, o = {}) => t.coord.startBatch({nlTabId: NL_TAB, nlOrigin: 'http://localhost:9091', mode: 'auto', policy: {existing: 'draft', onError: 'pause', sendImages: false}, ids: ids(n), parallel, ...o});
const idle = async t => { await t.coord.idle(); return t.env.state.load(); };
const cmds = (t, c) => t.calls.filter(x => x.cmd === c);
const owner = (t, code) => t.prepared.find(p => p.code === code)?.evaluationId;

/** Page actions ran only on the evaluation they were meant for; one aimed at another patient was refused. */
function assertPageIsolation(t) {
  for (const c of t.calls.filter(x => t.tabs.has(x.tabId) && x.key)) assert.ok(c.refused ? c.shown !== c.evaluationId : c.shown === c.evaluationId, `${c.cmd} ${c.key} on tab ${c.tabId}`);
}
/** Each draft the server saved went to the evaluation and section where its code was prepared. */
function assertDraftsAtOrigin(t) {
  for (const sv of t.saves) assert.ok(t.prepared.some(p => p.code === sv.code && p.evaluationId === sv.evaluationId && p.key === sv.key), `draft ${sv.code}`);
}
/** In every ChatGPT tab, what was inserted and what was sent is the same code, one task per conversation. */
function assertChatIsolation(t) {
  for (const tab of t.chats.keys()) {
    const seq = t.calls.filter(c => c.tabId === tab && (c.cmd === 'cg.insert' || c.cmd === 'cg.send'));
    for (let i = 0; i < seq.length; i += 2) {
      assert.equal(seq[i].cmd, 'cg.insert'); assert.equal(seq[i + 1]?.cmd, 'cg.send');
      assert.equal(seq[i].code, seq[i + 1].code);
      assert.ok(seq[i].text.includes(seq[i].code), 'the command carries its own code');
    }
  }
}
/** Largest number of evaluations with work going on at the same moment (first prepare .. last send). */
function overlap(t) {
  const span = {};
  for (const c of t.calls.filter(x => x.cmd === 'nl.prepare' || x.cmd === 'cg.send')) {
    const ev = c.cmd === 'nl.prepare' ? c.evaluationId : owner(t, c.code);
    span[ev] ||= [c.at, c.at]; span[ev][1] = c.at;
  }
  const v = Object.values(span);
  return Math.max(...v.map(([a]) => v.filter(([x, y]) => x <= a && a <= y).length));
}

test('parallel: 6 evaluations, 3 at a time, each lane with its own tabs; every draft on its own evaluation', async () => {
  const t = makeEnv({evals: evals(6)});
  await run(t, 6, 3);
  const s = await idle(t);
  assert.equal(s.status, 'done');
  assert.equal(s.lanes.length, 3);
  assert.deepEqual(s.batch.list.map(e => e.status), Array(6).fill('done'));
  assert.ok(s.batch.list.every(e => e.summary.received === PER_EVAL));
  // three NeuroLaudos IA tabs (the batch's own and two duplicates) and three ChatGPT tabs, one per lane
  assert.equal(new Set(s.lanes.map(l => l.nlTabId)).size, 3);
  assert.equal(new Set(s.lanes.map(l => l.chatTabId)).size, 3);
  assert.ok(overlap(t) >= 2, 'evaluations really ran at the same time');
  const sends = cmds(t, 'cg.send');
  assert.equal(sends.length, 6 * PER_EVAL);
  assert.equal(new Set(sends.map(c => c.code)).size, sends.length, 'never the same code twice');
  // every evaluation was taken by one lane only: its tasks were all prepared in one NeuroLaudos IA tab
  for (const id of ids(6)) assert.equal(new Set(cmds(t, 'nl.prepare').filter(c => c.evaluationId === id).map(c => c.tabId)).size, 1, id);
  assert.equal(t.saves.length, 6 * PER_EVAL);
  assertDraftsAtOrigin(t);
  assertPageIsolation(t);
  assertChatIsolation(t);
  assert.ok(!t.calls.some(c => c.refused), 'no tab ever showed another patient');
  assert.ok(!t.calls.some(c => c.key === 'hipotese'), 'never the diagnosis');
  assert.equal(t.notes.filter(n => /lote concluído/.test(n)).length, 1, 'one notice at the end');
});

test('parallel: 10 at the same time — the most allowed — still isolated', async () => {
  const t = makeEnv({evals: evals(10)});
  await run(t, 10, 10);
  const s = await idle(t);
  assert.equal(s.status, 'done');
  assert.equal(s.lanes.length, 10);
  assert.ok(overlap(t) >= 5);
  assert.equal(t.saves.length, 10 * PER_EVAL);
  assertDraftsAtOrigin(t); assertPageIsolation(t); assertChatIsolation(t);
});

test('parallel: messages to ChatGPT are spaced for the whole account, whatever the lane', async () => {
  const t = makeEnv({evals: evals(4), settings: {batchGapSeconds: 30}});
  await run(t, 4, 4);
  await idle(t);
  const at = cmds(t, 'cg.send').map(c => c.at).sort((a, b) => a - b);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 30000, `gap ${i}`);
});

test('parallel: a lane tab moved to another patient while ChatGPT wrote; the lane goes back, the draft stays at its origin', async () => {
  let moved = null;
  const t = makeEnv({evals: evals(4), cg: {onWait: (nl, show, ctx) => {
    if (moved) return;
    const dup = [...ctx.tabs.entries()].find(([id, tab]) => id !== NL_TAB && tab.evaluationId);
    if (!dup) return;
    const other = ids(4).find(x => x !== dup[1].evaluationId);
    moved = {tab: dup[0], from: dup[1].evaluationId, to: other};
    show(other, dup[1]);
  }}});
  await run(t, 4, 2);
  const s = await idle(t);
  assert.ok(moved);
  assert.equal(s.status, 'done');
  assert.ok(t.calls.some(c => c.refused && c.tabId === moved.tab && c.evaluationId === moved.from && c.shown === moved.to), 'the page refused to answer for another patient');
  assert.ok(s.log.some(l => /voltando para a avaliação do lote/.test(l.msg)));
  assert.equal(t.saves.length, 4 * PER_EVAL);
  assertDraftsAtOrigin(t); assertPageIsolation(t); assertChatIsolation(t);
});

test('parallel: ChatGPT usage limit — every lane waits, the same task goes again in the same ChatGPT tab', async () => {
  let hit = null;
  const t = makeEnv({evals: evals(3), settings: {rateLimitMinutes: 10}, cg: {rateLimit: (tab, c) => { if (hit) return false; hit = {tab, code: c.sent}; return true; }}});
  await run(t, 3, 3);
  const s = await idle(t);
  assert.equal(s.status, 'done');
  const again = cmds(t, 'cg.send').filter(c => c.code === hit.code);
  assert.equal(again.length, 2, 'sent again once, never more');
  assert.ok(again.every(c => c.tabId === hit.tab), 'in the same lane ChatGPT tab');
  assert.ok(again[1].at - again[0].at >= 10 * 60000, 'after the shared pause');
  const limitAt = again[0].at;
  const during = cmds(t, 'cg.send').filter(c => c.at > limitAt + 60000 && c.at < limitAt + 9 * 60000);
  assert.equal(during.length, 0, 'no lane sends during the pause');
  assert.equal(t.saves.length, 3 * PER_EVAL);
  assert.equal(t.saves.filter(x => x.code === hit.code).length, 1, 'one draft for that task');
  assertDraftsAtOrigin(t); assertPageIsolation(t); assertChatIsolation(t);
});

test('parallel: a problem in one evaluation pauses only its lane; "Pular avaliação" there, the others finish', async () => {
  const bad = ids(3)[1];
  const t = makeEnv({evals: evals(3), nl: {draftOutcome: (key, ev) => ev === bad && key === 'atencao' ? 'problem' : 'received'}});
  await run(t, 3, 3);
  let s = await idle(t);
  assert.equal(s.status, 'paused');
  const lane = s.lanes.findIndex(l => l.status === 'paused');
  assert.equal(s.lanes[lane].evaluationId, bad);
  assert.ok(s.lanes.filter((l, i) => i !== lane).every(l => l.status === 'done'), 'the other lanes went on');
  assert.ok(s.lanes[lane].pause.actions.includes('skip_eval'));
  await t.coord.resume('skip_eval', null, lane);
  s = await idle(t);
  assert.equal(s.status, 'done');
  assert.equal(s.batch.list.find(e => e.id === bad).status, 'skipped');
  assert.ok(!t.saves.some(x => x.evaluationId === bad));
  assertDraftsAtOrigin(t); assertPageIsolation(t);
});

test('parallel: pause all, continue all; stop then "continuar de onde parou" finishes the queue', async () => {
  let paused = false;
  const t = makeEnv({evals: evals(5), cg: {onWait: () => { if (!paused) { paused = true; t.coord.pause(); } }}});
  await run(t, 5, 2);
  let s = await idle(t);
  assert.equal(s.status, 'paused');
  assert.ok(s.lanes.every(l => l.status === 'paused'));
  await t.coord.resume();
  await t.coord.stop();
  s = await idle(t);
  assert.equal(s.status, 'stopped');
  await t.coord.continueRun();
  s = await idle(t);
  assert.equal(s.status, 'done');
  assert.deepEqual(s.batch.list.map(e => e.status), Array(5).fill('done'));
  assert.equal(new Set(cmds(t, 'cg.send').map(c => c.code)).size, cmds(t, 'cg.send').length, 'nothing sent twice');
  assertDraftsAtOrigin(t); assertPageIsolation(t); assertChatIsolation(t);
});

test('parallel: more lanes than evaluations is capped; 1 runs one after another (no lanes)', async () => {
  let t = makeEnv({evals: evals(2)});
  await run(t, 2, 10);
  let s = await idle(t);
  assert.equal(s.lanes.length, 2);
  t = makeEnv({evals: evals(2)});
  await run(t, 2, 1);
  s = await idle(t);
  assert.equal(s.lanes, undefined);
  assert.equal(s.status, 'done');
  await assert.rejects(run(t, 11, 3, {ids: ids(11)}), /1 a 10/);
});

test('parallel: browser restart pauses every running lane; a sent section goes back to checking, never resent', async () => {
  const s0 = {status: 'running', lanes: [
    {status: 'running', items: [{key: 'atencao', status: 'processing', sentAt: '2026-11-08T12:00:00Z', step: 'wait_chatgpt'}]},
    {status: 'done', items: []},
  ]};
  const s = recoverLanes(s0);
  assert.equal(s.lanes[0].status, 'paused');
  assert.equal(s.lanes[0].items[0].step, 'confirm');
  assert.equal(s.lanes[1].status, 'done');
  assert.equal(s.status, 'paused');
  assert.equal(aggregate([{status: 'done'}, {status: 'stopped'}]), 'stopped');
});
