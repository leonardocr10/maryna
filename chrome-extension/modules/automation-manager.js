// Orchestrates one run: strictly sequential, one section and one task at a time.
// Everything outside (tabs, content scripts, notifications) comes in through `env`, so the flow is tested in Node.
//
// Success criterion of a section: the NeuroLaudos IA page shows the task as "Rascunho recebido" (or waiting for her
// confirmation). A ChatGPT answer alone is never success. The message is never sent twice on its own: `sentAt` is
// written before the click, and after it only the real status is checked.
import {RUN, LIMITS, PLUGIN_NAME, CHATGPT_URL, FINAL_ITEM} from './constants.js';
import {buildQueue, nextIndex} from './task-queue.js';
import {checkCommand, isTaskCode, reusable, outcome} from './task-validator.js';
import {AutoError, describe, NEEDS_PERSON} from './error-handler.js';
import {isActive} from './state-manager.js';

/** Errors that stop the whole run whatever the error policy says (the next section would fail the same way). */
const GLOBAL = ['nl_not_logged', 'nl_not_review', 'nl_readonly', 'nl_mcp_off', 'nl_changed', 'nl_tab_closed', 'cg_not_logged', 'cg_load', 'cg_plugin_missing', 'cg_rate_limit', 'cg_composer', 'nl_selector', 'connection'];

/**
 * env: {
 *   state: StateManager, settings(): Promise<settings>,
 *   send(tabId, msg, waitMs?) -> content script answer (throws on a closed tab),
 *   tabExists(tabId), activate(tabId), openChat(tabId|null, url) -> tabId,
 *   notify(title, message), sleep(ms), now()
 * }
 */
export class AutomationManager {
  constructor(env) { this.env = env; this.looping = false; this.commands = new Map(); this.probed = false; }

  // ---------- controls ----------
  async start({nlTabId, nlOrigin, mode, policy, selected}) {
    const {state, send} = this.env;
    const cur = await state.load();
    if (isActive(cur)) throw new AutoError('busy');
    const scan = await send(nlTabId, {cmd: 'nl.scan'}, LIMITS.contentReady);
    if (!scan?.ok) throw new AutoError(scan?.code || 'nl_not_review', 'navigate', scan?.detail);
    if (scan.readOnly) throw new AutoError('nl_readonly');
    const {items} = buildQueue(scan, {existing: policy.existing, selected});
    if (!items.some(i => i.status !== 'skipped')) throw Object.assign(new AutoError('nl_selector'), {message: 'Nenhuma seção elegível para gerar com as opções escolhidas.', hint: 'Mude a seleção ou a política de seções com texto.'});
    this.probed = false; this.commands.clear();
    await state.create({evaluationId: scan.evaluationId, nlTabId, nlOrigin, mode, policy, items});
    this.kick();
    return state.load();
  }

  async pause() { await this.env.state.pause({code: 'user', message: 'Pausado por você.', hint: 'A seção em andamento continua de onde parou ao clicar em Continuar.'}); }

  /** action: continue | retry | skip | plugin_done */
  async resume(action = 'continue', nlTabId = null) {
    const {state} = this.env;
    const s = await state.load();
    if (!s || !(s.status === RUN.paused || s.status === RUN.running)) return s;
    const idx = s.current;
    const it = s.items[idx];
    if (it && !FINAL_ITEM.includes(it.status)) {
      if (action === 'skip') await state.setItem(idx, {status: 'skipped', reason: 'Pulada por você', error: null});
      else if (action === 'retry') {
        // Explicit retry by the person: a new conversation and, if the task is no longer open, a new task.
        await state.setItem(idx, {status: 'pending', step: 'navigate', error: null, sentAt: null, attempts: 0, pluginManual: false, authNotified: false});
        await state.setRun({chatPluginOk: false});   // a retry starts a new conversation
        this.commands.delete(it.key);
      } else await state.setItem(idx, {status: it.status === 'error' || it.status === 'expired' ? 'pending' : it.status, error: null, ...(action === 'plugin_done' ? {pluginManual: true} : {})});
    }
    await state.setRun({status: RUN.running, pause: null, ...(nlTabId ? {nlTabId} : {})});
    await state.log(action === 'skip' ? 'Seção pulada.' : action === 'retry' ? 'Tentando a seção de novo.' : 'Execução retomada.');
    this.kick();
    return state.load();
  }

  async stop() { await this.env.state.stop(); await this.env.state.log('Execução parada. Os rascunhos já recebidos ficam no NeuroLaudos IA.'); }

  /** Starts the loop when it is not running; returns its promise (awaited in tests). */
  kick() { if (!this.looping) this.task = this.loop().catch(() => {}); return this.task; }

  // ---------- loop ----------
  async loop() {
    const {state} = this.env;
    this.looping = true;
    try {
      for (;;) {
        let s = await state.load();
        if (!s || s.status !== RUN.running) return;
        const idx = nextIndex(s.items, 0);
        if (idx < 0) {
          await state.finish();
          const d = s.items.filter(i => i.status === 'received').length, r = s.items.filter(i => i.status === 'needs_review').length, e = s.items.filter(i => i.status === 'error' || i.status === 'expired').length;
          await state.log(s.mode === 'simulation' ? 'Simulação concluída.' : `Concluído: ${d} recebidos, ${r} para revisão, ${e} com erro.`);
          this.env.notify('Modo automático concluído', s.mode === 'simulation' ? 'Simulação concluída. Veja o relatório no painel.' : `${d} rascunhos recebidos${r ? `, ${r} para revisão` : ''}${e ? `, ${e} com erro` : ''}. Revise e aprove no NeuroLaudos IA.`);
          return;
        }
        if (s.current !== idx) await state.setRun({current: idx});
        const finished = await this.processItem(idx);
        s = await state.load();
        if (!s || s.status !== RUN.running) return;
        // Assisted mode: one section, then the psychologist checks it and clicks Continuar.
        if (finished && s.mode === 'assisted' && nextIndex(s.items, 0) >= 0) {
          await state.pause({code: 'assisted', message: 'Seção concluída. Confira o resultado no NeuroLaudos IA.', hint: 'Clique em Continuar para a próxima seção.'});
          return;
        }
      }
    } finally { this.looping = false; }
  }

  /** Runs the steps of one section from where it stopped. Returns true when the section reached a final status. */
  async processItem(idx) {
    const {state} = this.env;
    let s = await state.load();
    let it = s.items[idx];
    const steps = s.mode === 'simulation' ? SIM_STEPS : RUN_STEPS;
    if (FINAL_ITEM.includes(it.status)) return true;
    if (!it.startedAt) await state.setItem(idx, {startedAt: new Date(this.env.now()).toISOString()});
    let step = it.step && steps.includes(it.step) ? it.step : steps[0];
    try {
      for (;;) {
        s = await state.load();
        if (!s || s.status !== RUN.running) return false;
        it = s.items[idx];
        await state.setItem(idx, {step});
        const res = await this[STEP_FN[step]](s, idx, it);
        if (res === 'interrupted') return false;          // paused or stopped during a wait
        if (res === 'final') return true;                  // the step decided the section's final status
        const at = steps.indexOf(step);
        if (at === steps.length - 1) return true;
        step = steps[at + 1];
      }
    } catch (err) {
      return this.fail(idx, err, step);
    }
  }

  async fail(idx, err, step) {
    const {state} = this.env;
    const info = describe(err, step);
    const s = await state.load();
    if (!s) return false;
    const it = s.items[idx];
    const attempts = (it.attempts || 0) + 1;
    await state.log(`${it.name}: ${info.message}${info.stepLabel ? ` (etapa: ${info.stepLabel})` : ''}`);
    if (s.mode === 'simulation') {
      await state.setItem(idx, {status: 'error', error: info, attempts});
      if (GLOBAL.includes(info.code)) await state.pause({...info, actions: ['continue', 'retry', 'skip']});
      return true;
    }
    const settings = await this.env.settings();
    // Automatic retry only before anything was sent and for errors that do not need the person.
    if (!it.sentAt && !NEEDS_PERSON.includes(info.code) && !GLOBAL.includes(info.code) && attempts <= (settings.retries ?? 1)) {
      await state.setItem(idx, {attempts, step: 'navigate', error: info});
      await state.log(`${it.name}: nova tentativa automática.`);
      return false;
    }
    const status = info.code === 'nl_expired' ? 'expired' : 'error';
    await state.setItem(idx, {status, error: info, attempts});
    if (s.policy?.onError === 'next' && !GLOBAL.includes(info.code)) { await this.safeClose(s, it); return true; }
    const actions = ['continue', 'retry', 'skip', ...(info.code.startsWith('cg_plugin') ? ['plugin_done'] : [])];
    await state.pause({...info, section: it.name, actions});
    this.env.notify('Modo automático pausado', `${it.name}: ${info.message}`);
    return false;
  }

  // ---------- steps ----------
  async nl(s, msg, wait = LIMITS.contentReady) {
    const {send, tabExists} = this.env;
    if (!(await tabExists(s.nlTabId))) throw new AutoError('nl_tab_closed');
    const r = await send(s.nlTabId, {...msg, evaluationId: s.evaluationId}, wait);
    if (!r) throw new AutoError('connection');
    if (r.ok === false) throw new AutoError(r.code || 'nl_selector', null, r.detail);
    return r;
  }
  async cg(s, msg, wait = LIMITS.contentReady) {
    const {send, tabExists} = this.env;
    if (!s.chatTabId || !(await tabExists(s.chatTabId))) throw new AutoError('cg_tab_closed');
    const r = await send(s.chatTabId, msg, wait);
    if (!r) throw new AutoError('connection');
    if (r.ok === false) throw new AutoError(r.code || 'cg_composer', null, r.detail);
    return r;
  }

  async stepNavigate(s, idx, it) {
    await this.env.activate(s.nlTabId);
    await this.nl(s, {cmd: 'nl.openSection', key: it.key}, LIMITS.navigate + 5000);
  }

  async stepOpenModal(s, idx, it) {
    const m = await this.nl(s, {cmd: 'nl.openModal', key: it.key}, LIMITS.modal + 5000);
    // Checked again on the page: the AI never writes this section (fixed text, diagnosis, no data).
    if (m.notEligible) { await this.env.state.setItem(idx, {status: 'skipped', reason: m.reason || 'Seção sem geração por ChatGPT'}); return 'final'; }
    if (m.modal.mcp !== true) throw new AutoError('nl_mcp_off', 'open_modal');
  }

  async stepPrepare(s, idx, it) {
    const {state} = this.env;
    const {modal} = await this.nl(s, {cmd: 'nl.modalInfo', key: it.key});
    // A draft from an earlier task waits for her confirmation: nothing new is prepared.
    if (modal.status === 'draft_received' && modal.needsConfirmation) {
      await state.setItem(idx, {status: 'needs_review', code: modal.code, reason: 'Já havia um rascunho do ChatGPT aguardando sua confirmação'});
      await this.safeClose(s, it);
      return 'final';
    }
    if (it.code && modal.code === it.code && reusable(modal, this.env.now())) return;           // our task, still open
    if (reusable(modal, this.env.now())) {                                                      // an open task made before: reused, no new code
      if (this.codeTaken(s, idx, modal.code)) throw new AutoError('nl_bad_command', 'prepare', 'código repetido');
      await state.setItem(idx, {code: modal.code, status: 'preparing', reused: true});
      await state.log(`${it.name}: tarefa ${modal.code} já existente reutilizada.`);
      return;
    }
    if (it.code && modal.code === it.code && modal.status === 'expired') { await state.log(`${it.name}: tarefa ${it.code} expirou; uma nova será preparada.`); }
    await state.setItem(idx, {status: 'preparing'});
    const r = await this.nl(s, {cmd: 'nl.prepare', key: it.key, images: !!s.policy?.sendImages, previous: modal.code || null}, LIMITS.prepare + 5000);
    const code = r.modal?.code;
    if (!isTaskCode(code)) throw new AutoError('nl_no_code', 'prepare');
    if (code === modal.code && !reusable(modal, this.env.now()) && modal.status !== 'none') throw new AutoError('nl_no_code', 'prepare', 'o código não mudou');
    if (this.codeTaken(s, idx, code)) throw new AutoError('nl_bad_command', 'prepare', 'código repetido');
    await state.setItem(idx, {code, reused: false});
    await state.log(`${it.name}: tarefa ${code} preparada.`);
  }

  codeTaken(s, idx, code) { return s.items.some((o, i) => i !== idx && o.code === code); }

  async stepCommand(s, idx, it) {
    const r = await this.nl(s, {cmd: 'nl.command', key: it.key}, LIMITS.command + 5000);
    const chk = checkCommand(r.command, it.code);
    if (!chk.ok) throw new AutoError(r.command ? 'nl_bad_command' : 'nl_no_command', 'command', chk.reason);
    this.commands.set(it.key, r.command);   // kept in memory only
    await this.env.state.setItem(idx, {status: 'waiting_chatgpt'});
  }

  async stepChatNew(s, idx, it) {
    const {state, openChat, activate, send, sleep, now} = this.env;
    let tabId = s.chatTabId && (await this.env.tabExists(s.chatTabId)) ? s.chatTabId : null;
    // Option "mesma conversa": after the first section, the next ones go on in the conversation already open.
    const reuse = !!s.policy?.sameChat && !!s.chatPluginOk && !!tabId;
    if (reuse) {
      await activate(tabId);
      const r = await send(tabId, {cmd: 'cg.ping'}, 15000).catch(() => null);
      if (r?.ready) return;
      if (r && r.loggedIn === false) throw new AutoError('cg_not_logged', 'chatgpt_new');
    }
    if (s.chatPluginOk) await state.setRun({chatPluginOk: false});
    tabId = await openChat(tabId, CHATGPT_URL);
    if (tabId !== s.chatTabId) await state.setRun({chatTabId: tabId});
    await activate(tabId);
    const end = now() + LIMITS.chatgptLoad;
    let last = null;
    while (now() < end) {
      try { last = await send(tabId, {cmd: 'cg.ping', fresh: true}, 5000); } catch { last = null; }
      if (last?.ready) break;
      if (last && last.loggedIn === false) throw new AutoError('cg_not_logged', 'chatgpt_new');
      await sleep(700);
    }
    if (!last?.ready) throw new AutoError(last ? 'cg_composer' : 'cg_load', 'chatgpt_new');
    if (last.hasMessages) throw new AutoError('cg_load', 'chatgpt_new', 'a conversa não está vazia');
  }

  async stepPlugin(s, idx, it) {
    const s2 = await this.env.state.load();
    if (s2.policy?.sameChat && s2.chatPluginOk) return;   // "@NeuroLaudos IA" only in the conversation's first message
    const r = await this.cg(s2, {cmd: 'cg.selectPlugin', name: PLUGIN_NAME, trustManual: !!it.pluginManual}, LIMITS.pluginMenu + LIMITS.pluginChip + 8000);
    if (s2.policy?.sameChat) await this.env.state.setRun({chatPluginOk: true});
    await this.env.state.log(`${it.name}: plugin ${PLUGIN_NAME} ${r.manual ? 'marcado como selecionado por você' : r.how === 'chip' || r.how === 'picker' ? 'escolhido na lista do ChatGPT' : 'mencionado como @' + PLUGIN_NAME}.`);
  }

  async stepInsert(s, idx, it) {
    let command = this.commands.get(it.key);
    if (!command) {   // worker restarted: read the official command again
      const r = await this.nl(s, {cmd: 'nl.command', key: it.key}, LIMITS.command + 5000);
      if (!checkCommand(r.command, it.code).ok) throw new AutoError('nl_bad_command', 'insert');
      command = r.command; this.commands.set(it.key, command);
      await this.env.activate(s.chatTabId);
    }
    await this.cg(s, {cmd: 'cg.insert', text: command, code: it.code, name: PLUGIN_NAME}, 15000);
  }

  async stepSend(s, idx, it) {
    if (it.sentAt) return;   // never twice: after a restart the run goes on to waiting and checking
    await this.env.state.setItem(idx, {sentAt: new Date(this.env.now()).toISOString(), status: 'waiting_chatgpt'});
    try {
      await this.cg(s, {cmd: 'cg.send', code: it.code}, LIMITS.sendReady + LIMITS.sendAck + 5000);
    } catch (err) {
      // The page did not show the send, but NeuroLaudos IA may already have the task in use: that is the proof.
      if (!(err instanceof AutoError) || err.code !== 'cg_send' || !(await this.taskMoved(s, it, 30000))) throw err;
      await this.env.state.log(`${it.name}: envio confirmado pelo NeuroLaudos IA (tarefa em uso pelo plugin).`);
    }
    this.commands.delete(it.key);
    await this.env.state.log(`${it.name}: comando com ${it.code} enviado ao ChatGPT.`);
  }

  /** True when NeuroLaudos IA shows the task taken by the plugin (or, with `received`, only when the draft arrived). */
  async taskMoved(s, it, ms, received = false) {
    const end = this.env.now() + ms;
    do {
      let r;
      try { r = await this.nl(s, {cmd: 'nl.waitStatus', key: it.key, code: it.code, chunkMs: Math.min(5000, ms)}, Math.min(5000, ms) + 10000); } catch { return false; }
      const st = r?.modal?.code === it.code ? r.modal.status : null;
      if (st === 'draft_received' || st === 'reviewed' || (!received && st === 'processing')) return true;
    } while (this.env.now() < end);
    return false;
  }

  async stepWaitChat(s, idx, it) {
    const {state, now, notify, activate} = this.env;
    const settings = await this.env.settings();
    const end = now() + (settings.chatgptMinutes || 15) * 60000;
    let notified = !!it.authNotified;
    while (now() < end) {
      const cur = await state.load();
      if (!cur || cur.status !== RUN.running) return 'interrupted';
      const r = await this.cg(cur, {cmd: 'cg.wait', chunkMs: LIMITS.chunk}, LIMITS.chunk + 10000);
      if (r.state === 'done') return;
      // The draft may arrive before ChatGPT's page looks finished: NeuroLaudos IA decides.
      if (await this.taskMoved(cur, it, 1000, true)) return;
      if (r.state === 'rate_limit') throw new AutoError('cg_rate_limit', 'wait_chatgpt');
      if (r.state === 'error') throw new AutoError('cg_error', 'wait_chatgpt', r.detail);
      if (r.state === 'auth') {
        if (cur.items[idx].status !== 'waiting_auth') await state.setItem(idx, {status: 'waiting_auth'});
        if (!notified) {
          notified = true;
          await state.setItem(idx, {authNotified: true});
          await activate(cur.chatTabId);
          await state.log(`${it.name}: o ChatGPT pede sua autorização. Confira e confirme na aba do ChatGPT.`);
          notify('Autorização necessária no ChatGPT', `${it.name}: confira o pedido do plugin NeuroLaudos IA e confirme no ChatGPT. A extensão não autoriza por você.`);
        }
        continue;
      }
      if (cur.items[idx].status !== 'processing' && r.state === 'streaming') await state.setItem(idx, {status: 'processing'});
    }
    throw new AutoError('cg_incomplete', 'wait_chatgpt');
  }

  async stepConfirm(s, idx, it) {
    const {state, now, activate} = this.env;
    const settings = await this.env.settings();
    await state.setItem(idx, {status: 'confirming'});
    await activate(s.nlTabId);
    const end = now() + (settings.confirmSeconds || 120) * 1000;
    while (now() < end) {
      const cur = await state.load();
      if (!cur || cur.status !== RUN.running) return 'interrupted';
      const r = await this.nl(cur, {cmd: 'nl.waitStatus', key: it.key, code: it.code, chunkMs: Math.min(LIMITS.chunk, Math.max(1000, end - now()))}, LIMITS.chunk + 10000);
      const o = outcome(r.modal, it.code);
      if (o.kind === 'received') { await state.setItem(idx, {status: 'received'}); await state.log(`${it.name}: rascunho recebido no NeuroLaudos IA.`); return; }
      if (o.kind === 'needs_review') { await state.setItem(idx, {status: 'needs_review', reason: 'A seção já tinha texto: confirme a substituição no NeuroLaudos IA'}); await state.log(`${it.name}: rascunho recebido; revisão necessária (substituição não feita).`); return; }
      if (o.kind === 'expired') throw new AutoError('nl_expired', 'confirm');
      if (o.kind === 'failed') throw new AutoError('nl_task_failed', 'confirm', o.detail);
      if (o.kind === 'other') throw new AutoError('nl_changed', 'confirm', 'outra tarefa aberta na seção');
    }
    throw new AutoError('nl_not_received', 'confirm');
  }

  async stepClose(s, idx, it) {
    await this.safeClose(s, it);
    const cur = await this.env.state.load();
    if (cur.mode === 'simulation' && !FINAL_ITEM.includes(cur.items[idx].status)) await this.env.state.setItem(idx, {status: 'simulated'});
  }
  async safeClose(s, it) { try { await this.nl(s, {cmd: 'nl.closeModal', key: it.key}, 8000); } catch {} }

  // ---------- simulation: checks only, nothing prepared, sent or saved ----------
  async stepSimCheck(s, idx, it) {
    const r = await this.nl(s, {cmd: 'nl.simCheck', key: it.key});
    const checks = [...(r.checks || [])];
    if (!this.probed) {
      this.probed = true;
      try {
        await this.stepChatNew(await this.env.state.load(), idx, it);
        const cur = await this.env.state.load();
        const p = await this.cg(cur, {cmd: 'cg.probe', name: PLUGIN_NAME}, LIMITS.pluginMenu + LIMITS.pluginChip + 8000);
        checks.push(...(p.checks || []));
      } catch (err) { const d = describe(err, 'chatgpt_new'); checks.push({name: 'ChatGPT', ok: false, detail: d.message}); }
      await this.env.activate(s.nlTabId);
    }
    const bad = checks.filter(c => !c.ok);
    await this.env.state.setItem(idx, {checks, status: bad.length ? 'error' : 'simulated', error: bad.length ? {code: 'nl_selector', message: `${bad.length} verificação(ões) falharam`, hint: 'Veja os detalhes da seção.'} : null});
    await this.safeClose(s, it);
    return 'final';
  }
}

const RUN_STEPS = ['navigate', 'open_modal', 'prepare', 'command', 'chatgpt_new', 'plugin', 'insert', 'send', 'wait_chatgpt', 'confirm', 'close'];
const SIM_STEPS = ['navigate', 'open_modal', 'sim_check'];
const STEP_FN = {navigate: 'stepNavigate', open_modal: 'stepOpenModal', prepare: 'stepPrepare', command: 'stepCommand', chatgpt_new: 'stepChatNew', plugin: 'stepPlugin', insert: 'stepInsert', send: 'stepSend', wait_chatgpt: 'stepWaitChat', confirm: 'stepConfirm', close: 'stepClose', sim_check: 'stepSimCheck'};
