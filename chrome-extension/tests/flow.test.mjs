// Full runs against synthetic pages: the cases required in the specification (section 18).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv, start, section, STANDARD, newCode, NL_TAB} from './fakes.mjs';
import {recoverAfterRestart} from '../modules/state-manager.js';

const cmds = (t, c) => t.calls.filter(x => x.cmd === c);
const finish = async t => { await t.mgr.task; return t.env.state.load(); };

test('several sections: each prepared once, sent once, confirmed in NeuroLaudos IA, in order', async () => {
  const t = makeEnv({nl: {sections: STANDARD()}});
  await start(t);
  const s = await finish(t);
  assert.equal(s.status, 'done');
  const got = s.items.filter(i => i.status === 'received').map(i => i.key);
  assert.deepEqual(got, ['habilidades_intelectuais', 'percepcao', 'conclusao']);
  assert.equal(cmds(t, 'nl.prepare').length, 3);
  assert.deepEqual(cmds(t, 'cg.send').map(c => c.code), got.map(k => t.nl.tasks[k].code));
  assert.equal(new Set(s.items.filter(i => i.code).map(i => i.code)).size, 3, 'no duplicated codes');
  // Fixed text, approved and hand-written sections were never opened
  for (const k of ['fixo_fontes', 'anamnese', 'hipotese', 'memoria']) assert.ok(!t.calls.some(c => c.key === k), k);
  assert.ok(!t.calls.some(c => /approve/i.test(c.cmd)), 'never approves');
});

test('only one eligible section', async () => {
  const t = makeEnv({nl: {sections: [section('fixo_a', 'Procedimentos', 'fixed', 'file'), section('percepcao', 'Percepção')]}});
  await start(t);
  const s = await finish(t);
  assert.equal(s.items[1].status, 'received');
  assert.equal(cmds(t, 'cg.send').length, 1);
});

test('existing open task is reused (no new code)', async () => {
  const code = newCode();
  const t = makeEnv({nl: {sections: [section('percepcao', 'Percepção')], tasks: {percepcao: {code, status: 'pending'}}}});
  await start(t);
  const s = await finish(t);
  assert.equal(cmds(t, 'nl.prepare').length, 0);
  assert.equal(s.items[0].code, code);
  assert.equal(s.items[0].reused, true);
  assert.equal(s.items[0].status, 'received');
});

test('expired task is never reused: a new one is prepared', async () => {
  const old = newCode();
  const t = makeEnv({nl: {sections: [section('percepcao', 'Percepção')], tasks: {percepcao: {code: old, status: 'pending', expires: '2026-11-01T00:00:00Z'}}}});
  await start(t);
  const s = await finish(t);
  assert.equal(cmds(t, 'nl.prepare').length, 1);
  assert.notEqual(s.items[0].code, old);
  assert.equal(s.items[0].status, 'received');
});

test('section that needs confirmation of replacement: "Revisão necessária", nothing replaced', async () => {
  const t = makeEnv({nl: {sections: [section('memoria', 'Memória e aprendizagem', 'ai', 'gen')], draftOutcome: () => 'needs_review'}});
  await start(t, {policy: {existing: 'draft', onError: 'pause'}});
  const s = await finish(t);
  assert.equal(s.items[0].status, 'needs_review');
  assert.ok(!t.calls.some(c => /apply|replace/.test(c.cmd)));
});

test('a received draft already waiting for her confirmation is not prepared again', async () => {
  const t = makeEnv({nl: {sections: [section('memoria', 'Memória', 'ai', 'gen')], tasks: {memoria: {code: newCode(), status: 'draft_received', needsConfirmation: true}}}});
  await start(t, {policy: {existing: 'draft', onError: 'pause'}});
  const s = await finish(t);
  assert.equal(s.items[0].status, 'needs_review');
  assert.equal(cmds(t, 'nl.prepare').length, 0);
  assert.equal(cmds(t, 'cg.send').length, 0);
});

test('plugin not selected: pauses; "Já selecionei o plugin" continues without sending twice', async () => {
  const t = makeEnv({nl: {sections: [section('percepcao', 'Percepção')]}, cg: {plugin: 'unverified'}});
  await start(t);
  let s = await finish(t);
  assert.equal(s.status, 'paused');
  assert.equal(s.pause.code, 'cg_plugin_select');
  assert.ok(s.pause.actions.includes('plugin_done'));
  assert.equal(cmds(t, 'cg.send').length, 0, 'nothing sent without the plugin');
  await t.mgr.resume('plugin_done');
  s = await finish(t);
  assert.equal(s.status, 'done');
  assert.ok(t.chipManual);
  assert.equal(cmds(t, 'cg.send').length, 1);
  assert.equal(cmds(t, 'nl.prepare').length, 1, 'same task kept');
});

test('plugin missing in the picker pauses the run (global)', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A'), section('b', 'B')]}, cg: {plugin: 'missing'}});
  await start(t, {policy: {existing: 'skip', onError: 'next'}});
  const s = await finish(t);
  assert.equal(s.status, 'paused');
  assert.equal(s.pause.code, 'cg_plugin_missing');
});

test('human authorization: waits, notifies once, never clicks, then confirms', async () => {
  const t = makeEnv({nl: {sections: [section('percepcao', 'Percepção')]}, cg: {auth: 3}});
  await start(t);
  const s = await finish(t);
  assert.equal(s.items[0].status, 'received');
  assert.equal(t.notes.filter(n => /Autorização/.test(n)).length, 1);
  assert.ok(!t.calls.some(c => /authorize|allow|confirm/i.test(c.cmd)));
});

test('ChatGPT communication failure: paused with the step, no automatic resend', async () => {
  const t = makeEnv({nl: {sections: [section('percepcao', 'Percepção')]}, cg: {sendFails: true}});
  await start(t);
  const s = await finish(t);
  assert.equal(s.status, 'paused');
  assert.equal(s.items[0].status, 'error');
  assert.equal(s.items[0].error.step, 'send');
  assert.ok(s.items[0].sentAt, 'marked before the click');
});

test('rate limit pauses the run', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A')]}, cg: {rateLimit: true}});
  await start(t);
  const s = await finish(t);
  assert.equal(s.pause.code, 'cg_rate_limit');
});

test('draft never arrives: "Rascunho não recebido" after the limit', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A')], draftOutcome: () => 'never'}});
  await start(t);
  const s = await finish(t);
  assert.equal(s.pause.code, 'nl_not_received');
  assert.equal(s.items[0].status, 'error');
});

test('error policy "next": records the error and goes on', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A'), section('b', 'B')], draftOutcome: k => k === 'a' ? 'error' : 'received'}});
  await start(t, {policy: {existing: 'skip', onError: 'next'}});
  const s = await finish(t);
  assert.equal(s.status, 'done');
  assert.equal(s.items[0].status, 'error');
  assert.equal(s.items[1].status, 'received');
});

test('pause and continue: no new task and no second send', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A'), section('b', 'B')]}});
  await start(t);
  await t.mgr.pause();
  await t.mgr.task;
  let s = await t.env.state.load();
  assert.equal(s.status, 'paused');
  const sentBefore = cmds(t, 'cg.send').length;
  await t.mgr.resume('continue');
  s = await finish(t);
  assert.equal(s.status, 'done');
  assert.equal(cmds(t, 'cg.send').length, 2);
  assert.ok(sentBefore <= 1);
  assert.equal(cmds(t, 'nl.prepare').length, 2);
});

test('browser closed and reopened after sending: status is checked, message not sent again', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A')]}, cg: {auth: 1000}, settings: {chatgptMinutes: 3}});
  // Simulate the crash while waiting for the authorization (after the send): stop the loop, leave the state "running".
  t.env.notify = title => { if (/Autoriza/.test(title)) t.mgr.pause(); };
  await start(t);
  await t.mgr.task;
  assert.equal(cmds(t, 'cg.send').length, 1);
  await t.env.state.setRun({status: 'running'});
  await t.env.state.update(s => recoverAfterRestart(s));
  let s = await t.env.state.load();
  assert.equal(s.status, 'paused');
  assert.equal(s.items[0].step, 'confirm');
  // Meanwhile the person authorised in ChatGPT and the draft was saved.
  t.nl.tasks.a.status = 'draft_received';
  const sends = cmds(t, 'cg.send').length;
  await t.mgr.resume('continue');
  s = await finish(t);
  assert.equal(s.items[0].status, 'received');
  assert.equal(cmds(t, 'cg.send').length, sends, 'not sent again');
});

test('evaluation changed during the run: pauses', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A'), section('b', 'B')]}});
  await start(t);
  t.nl.evaluationId = 'ev-other';
  const s = await finish(t);
  assert.equal(s.status, 'paused');
  assert.equal(s.pause.code, 'nl_changed');
});

test('only one run at a time', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A')]}, cg: {plugin: 'unverified'}});
  await start(t);
  await t.mgr.task;
  await assert.rejects(() => start(t), /Já existe uma execução/);
});

test('assisted mode: pauses after each section', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A'), section('b', 'B')]}});
  await start(t, {mode: 'assisted'});
  let s = await finish(t);
  assert.equal(s.status, 'paused');
  assert.equal(s.pause.code, 'assisted');
  assert.equal(s.items[0].status, 'received');
  assert.equal(s.items[1].status, 'pending');
  await t.mgr.resume('continue');
  s = await finish(t);
  assert.equal(s.status, 'done');
});

test('simulation: checks selectors, prepares nothing, sends nothing', async () => {
  const t = makeEnv({nl: {sections: STANDARD()}});
  await start(t, {mode: 'simulation'});
  const s = await finish(t);
  assert.equal(s.status, 'done');
  assert.equal(cmds(t, 'nl.prepare').length, 0);
  assert.equal(cmds(t, 'cg.send').length, 0);
  assert.equal(cmds(t, 'cg.insert').length, 0);
  assert.equal(cmds(t, 'cg.probe').length, 1);
  assert.ok(s.items.filter(i => i.status === 'simulated').length === 3);
});

test('section checked again on the page (fixed text found when opening) is skipped', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A'), section('b', 'B')], notEligible: ['a']}});
  await start(t);
  const s = await finish(t);
  assert.equal(s.items[0].status, 'skipped');
  assert.equal(s.items[1].status, 'received');
});

test('plugin MCP switched off in NeuroLaudos IA pauses with a clear message', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A')], mcp: false}});
  await start(t);
  const s = await finish(t);
  assert.equal(s.pause.code, 'nl_mcp_off');
});

test('not logged in ChatGPT', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A')]}, cg: {loggedIn: false}});
  await start(t);
  const s = await finish(t);
  assert.equal(s.pause.code, 'cg_not_logged');
});

test('read-only evaluation cannot start', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A')], readOnly: true}});
  await assert.rejects(() => start(t), /somente leitura/);
  assert.equal(await t.env.state.load(), null);
  void NL_TAB;
});

test('one conversation for every section: "@NeuroLaudos IA" and a new chat only for the first', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A'), section('b', 'B'), section('c', 'C')]}});
  await start(t, {policy: {existing: 'skip', onError: 'pause', sameChat: true}});
  const s = await finish(t);
  assert.equal(s.status, 'done');
  assert.equal(cmds(t, 'cg.selectPlugin').length, 1);
  assert.equal(cmds(t, 'cg.send').length, 3);
});

test('default: a new conversation and the mention for each section', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A'), section('b', 'B')]}});
  await start(t);
  await finish(t);
  assert.equal(cmds(t, 'cg.selectPlugin').length, 2);
});

test('send not seen on the page but the task is in use in NeuroLaudos IA: counts as sent, goes on', async () => {
  const t = makeEnv({nl: {sections: [section('a', 'A'), section('b', 'B')]}});
  const orig = t.env.send;
  t.env.send = async (tabId, msg) => {
    if (msg.cmd === 'cg.send') { await orig(tabId, msg); const k = Object.keys(t.nl.tasks).find(x => t.nl.tasks[x].code === msg.code); t.nl.tasks[k].status = 'processing'; return {ok: false, code: 'cg_send'}; }
    if (msg.cmd === 'cg.wait') { const r = await orig(tabId, msg); for (const k of Object.keys(t.nl.tasks)) if (t.nl.tasks[k].status === 'processing') t.nl.tasks[k].status = 'draft_received'; return r; }
    return orig(tabId, msg);
  };
  await start(t);
  const s = await finish(t);
  assert.equal(s.status, 'done');
  assert.deepEqual(s.items.map(i => i.status), ['received', 'received']);
});
