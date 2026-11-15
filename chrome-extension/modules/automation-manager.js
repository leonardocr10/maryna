// Orchestrates one run: strictly sequential, one section and one task at a time.
// A batch (several evaluations chosen in the list) is the same run done for one evaluation after another, in the same
// NeuroLaudos IA tab: the tab is taken to the next evaluation only when the previous one ended, the section list, the
// commands and the ChatGPT conversation are replaced, and every message to the page carries the evaluation id, so a
// task of one patient is never prepared, sent or confirmed while another evaluation is open. The draft itself is saved
// by the NeuroLaudos IA server on the evaluation of its task code, whatever the tab shows.
// Everything outside (tabs, content scripts, notifications) comes in through `env`, so the flow is tested in Node.
//
// Success criterion of a section: the NeuroLaudos IA page shows the task as "Rascunho recebido" (or waiting for her
// confirmation). A ChatGPT answer alone is never success. The message is never sent twice on its own: `sentAt` is
// written before the click, and after it only the real status is checked.
import {RUN, LIMITS, PLUGIN_NAME, CHATGPT_URL, FINAL_ITEM, BATCH_MAX, EVAL_ID_RE} from './constants.js';
import {buildQueue, nextIndex, batchQueue, evalSummary, conclusionUnfinished, CONCLUSION_KEY} from './task-queue.js';
import {checkCommand, isTaskCode, reusable, outcome} from './task-validator.js';
import {AutoError, describe, NEEDS_PERSON} from './error-handler.js';
import {isActive} from './state-manager.js';

/** Errors that stop the whole run whatever the error policy says (the next section would fail the same way). */
const GLOBAL = ['nl_not_logged', 'nl_not_review', 'nl_readonly', 'nl_mcp_off', 'nl_changed', 'nl_tab_closed', 'cg_not_logged', 'cg_load', 'cg_plugin_missing', 'cg_rate_limit', 'cg_composer', 'nl_selector', 'connection'];

/**
 * env: {
 *   state: StateManager, settings(): Promise<settings>,
 *   send(tabId, msg, waitMs?) -> content script answer (throws on a closed tab),
 *   tabExists(tabId), activate(tabId), openChat(tabId|null, url, {background, nearTabId}) -> tabId,
 *   notify(title, message), sleep(ms), now()
 * }
 */
export class AutomationManager {
  constructor(env) { this.env = env; this.looping = false; this.commands = new Map(); this.images = new Map(); }

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
    // Every run starts clean: no command, task or conversation of an earlier run (another patient) is used again.
    this.commands.clear(); this.images.clear(); this.lastDiag = null;
    const oldChat = cur?.chatTabId && (await this.env.tabExists(cur.chatTabId)) ? cur.chatTabId : null;   // the same ChatGPT tab, on a NEW conversation
    await state.create({evaluationId: scan.evaluationId, nlTabId, nlOrigin, mode, policy, items, chatTabId: oldChat});
    this.kick();
    return state.load();
  }

  /**
   * Batch: several evaluations, one after another (never in parallel). Each one is opened in this tab on "Conferir
   * seções", read and run like a single run; then the next. Always a new ChatGPT conversation per section.
   */
  async startBatch({nlTabId, nlOrigin, mode, policy, ids}) {
    const {state} = this.env;
    const list = checkBatchIds(ids);
    const cur = await state.load();
    if (isActive(cur)) throw new AutoError('busy');
    this.commands.clear(); this.images.clear(); this.lastDiag = null;
    const oldChat = cur?.chatTabId && (await this.env.tabExists(cur.chatTabId)) ? cur.chatTabId : null;
    await state.create({evaluationId: null, nlTabId, nlOrigin, mode, policy: {...policy, sameChat: false}, items: [], chatTabId: oldChat, batch: {index: -1, list: list.map(id => ({id, status: 'pending'}))}});
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
    if (action === 'skip_eval' && s.batch) {
      // The rest of this evaluation is left as it is; the batch goes on with the next one.
      const at = new Date(this.env.now()).toISOString();
      await state.update(cur => {
        const bi = cur.batch.index;
        if (bi < 0) return undefined;
        for (const x of cur.items) if (!FINAL_ITEM.includes(x.status) && x.status !== 'error' && x.status !== 'expired') Object.assign(x, {status: 'skipped', reason: 'Avaliação pulada por você', error: null});
        cur.batch.list[bi] = {...cur.batch.list[bi], status: 'skipped', summary: evalSummary(cur.items), finishedAt: at};
        return cur;
      });
      if (it) this.forget(s, it);
    } else if (it && !FINAL_ITEM.includes(it.status)) {
      if (action === 'skip') await state.setItem(idx, {status: 'skipped', reason: 'Pulada por você', error: null});
      else if (action === 'retry') {
        // Explicit retry by the person: a new conversation and, if the task is no longer open, a new task.
        await state.setItem(idx, {status: 'pending', step: 'navigate', error: null, sentAt: null, attempts: 0, pluginManual: false, authNotified: false, chatDone: false, noSaveRetries: 0});
        await state.setRun({chatPluginOk: false});   // a retry starts a new conversation
        this.forget(s, it);
      } else await state.setItem(idx, {status: it.status === 'error' || it.status === 'expired' ? 'pending' : it.status, error: null, ...(action === 'plugin_done' ? {pluginManual: true} : {})});
    }
    await state.setRun({status: RUN.running, pause: null, ...(nlTabId ? {nlTabId} : {})});
    await state.log(action === 'skip_eval' ? 'Avaliação pulada; o lote segue para a próxima.' : action === 'skip' ? 'Seção pulada.' : action === 'retry' ? 'Tentando a seção de novo.' : 'Execução retomada.');
    this.kick();
    return state.load();
  }

  /**
   * A stopped or finished run goes on from where it stopped: only the sections without a draft (error, expired, not
   * reached, skipped by the person) run again; the ones already received are kept. New task and new conversation.
   */
  async continueRun(nlTabId = null) {
    const {state} = this.env;
    const s = await state.load();
    if (!s || !(s.status === RUN.stopped || s.status === RUN.done)) return s;
    const curSkipped = s.batch && s.batch.list[s.batch.index]?.status === 'skipped';
    const again = curSkipped ? [] : s.items.map((it, i) => (!FINAL_ITEM.includes(it.status) || (it.status === 'skipped' && it.reason === 'Pulada por você')) ? i : -1).filter(i => i >= 0);
    // Batch: evaluations that did not open run again; the ones not reached yet are still in the queue.
    const evals = s.batch ? s.batch.list.map((e, i) => e.status === 'error' ? i : -1).filter(i => i >= 0) : [];
    const queued = s.batch ? s.batch.list.filter(e => e.status === 'pending').length : 0;
    if (!again.length && !evals.length && !queued) return s;
    for (const i of again) await state.setItem(i, {status: 'pending', step: 'navigate', error: null, reason: null, sentAt: null, attempts: 0, chatDone: false, noSaveRetries: 0, pluginManual: false, authNotified: false});
    this.commands.clear(); this.images.clear(); this.lastDiag = null;
    if (s.batch) await state.update(cur => {
      for (const i of evals) cur.batch.list[i] = {...cur.batch.list[i], status: 'pending', error: null};
      const bi = cur.batch.index;
      if (again.length && bi >= 0 && cur.batch.list[bi].status === 'done') cur.batch.list[bi] = {...cur.batch.list[bi], status: 'running', finishedAt: null};
      return cur;
    });
    await state.setRun({status: RUN.running, pause: null, finishedAt: null, chatPluginOk: false, current: -1, ...(nlTabId ? {nlTabId} : {})});
    await state.log(`Continuando de onde parou: ${again.length} ${again.length === 1 ? 'seção' : 'seções'} sem rascunho${s.batch ? ` e ${evals.length + queued} ${evals.length + queued === 1 ? 'avaliação' : 'avaliações'} do lote` : ''}; as recebidas ficam como estão.`);
    this.kick();
    return state.load();
  }

  /** Her decision on a draft that waited for confirmation (made in the panel): the section shows the result. */
  async reviewed(key, action) {
    const {state} = this.env;
    const s = await state.load();
    const idx = s?.items.findIndex(i => i.key === key && i.status === 'needs_review') ?? -1;
    if (idx < 0) return;
    await state.setItem(idx, action === 'apply' ? {status: 'received', reason: 'Rascunho aprovado por você: substituiu o texto'} : {status: 'skipped', reason: 'Rascunho reprovado por você: texto atual mantido', reviewed: true});
    await state.log(`${s.items[idx].name}: ${action === 'apply' ? 'rascunho aprovado; o texto da seção foi substituído' : 'rascunho reprovado; o texto atual ficou'}.`);
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
        if (idx < 0 && s.batch) {
          const r = await this.advanceBatch();
          if (r === 'next') continue;
          if (r === 'interrupted') return;
          await state.finish();
          s = await state.load();
          // Parallel batch: this lane has nothing left; the batch ends with the last lane (one report, one notice).
          if (s.lanes && s.lanes.some(l => l.status === RUN.running || l.status === RUN.paused)) { await state.log('Nada mais na fila para esta aba; as outras seguem.'); return; }
          const t = batchTotals(s);
          await state.log(`Lote concluído: ${t.evals} ${t.evals === 1 ? 'avaliação' : 'avaliações'}; ${t.received} recebidos, ${t.review} para revisão, ${t.errors} com erro${t.failed ? `, ${t.failed} não abertas` : ''}.`);
          this.env.notify('Modo automático: lote concluído', `${t.evals} avaliações, ${t.received} rascunhos recebidos${t.review ? `, ${t.review} para revisão` : ''}${t.errors ? `, ${t.errors} com erro` : ''}${t.failed ? `, ${t.failed} não abertas` : ''}. Revise e aprove no NeuroLaudos IA.`);
          return;
        }
        if (idx < 0) {
          await state.finish();
          const d = s.items.filter(i => i.status === 'received').length, r = s.items.filter(i => i.status === 'needs_review').length, e = s.items.filter(i => i.status === 'error' || i.status === 'expired').length;
          await state.log(`Concluído: ${d} recebidos, ${r} para revisão, ${e} com erro.`);
          this.env.notify('Modo automático concluído', `${d} rascunhos recebidos${r ? `, ${r} para revisão` : ''}${e ? `, ${e} com erro` : ''}. Revise e aprove no NeuroLaudos IA.`);
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

  /**
   * Batch: closes the evaluation that ended (its counters stay) and opens the next one of the queue in the same tab.
   * Returns 'next' (the loop goes on), 'end' (nothing left) or 'interrupted' (paused: the tab needs the person).
   */
  async advanceBatch() {
    const {state, send, now} = this.env;
    let s = await state.load();
    const b = s.batch, at = () => new Date(now()).toISOString();
    if (b.index >= 0 && b.list[b.index].status === 'running') {
      const sum = evalSummary(s.items);
      await state.setBatchEntry(b.index, {status: 'done', summary: sum, finishedAt: at()});
      await state.log(`Avaliação ${b.index + 1} de ${b.list.length} concluída: ${sum.received} recebidos, ${sum.review} para revisão, ${sum.errors} com erro.`);
    }
    // Nothing of the previous evaluation goes on: no command, image, section list or ChatGPT conversation.
    this.commands.clear(); this.images.clear(); this.lastDiag = null;
    // The next evaluation is taken inside the serialised update: two lanes never take the same one.
    let j = -1;
    await state.update(cur => {
      j = cur.batch.list.findIndex(e => e.status === 'pending');
      if (j < 0) return undefined;
      cur.batch.index = j;
      cur.batch.list[j] = {...cur.batch.list[j], status: 'running', startedAt: cur.batch.list[j].startedAt || at(), error: null};
      return {...cur, evaluationId: cur.batch.list[j].id, items: [], current: -1, chatPluginOk: false};
    });
    if (j < 0) return 'end';
    const id = b.list[j].id, label = `Avaliação ${j + 1} de ${b.list.length}`;
    await state.log(`${label}: abrindo na tela Conferir seções.`);
    try {
      s = await this.ensureNlTab(await state.load());
      await this.env.activate(s.nlTabId);
      await this.openEval(s, id);
      const scan = await send(s.nlTabId, {cmd: 'nl.scan'}, LIMITS.contentReady);
      if (!scan?.ok) throw new AutoError(scan?.code || 'nl_not_review', 'open_evaluation', scan?.detail);
      if (scan.evaluationId !== id) throw new AutoError('nl_changed', 'open_evaluation');
      if (scan.readOnly) throw new AutoError('nl_readonly', 'open_evaluation');
      let conclusionReady = false;
      if ((scan.sections || []).some(x => x.key === CONCLUSION_KEY)) {
        const r = await send(s.nlTabId, {cmd: 'nl.getInstruction', key: CONCLUSION_KEY, evaluationId: id}, LIMITS.contentReady).catch(() => null);
        conclusionReady = !!r?.ok && !conclusionUnfinished(r.text);
      }
      const items = batchQueue(scan, {existing: s.policy?.existing, includeDemand: !!s.policy?.includeDemand, only: s.policy?.only || null, conclusionReady, evaluationId: id});
      const n = items.filter(i => i.status === 'pending').length;
      if (!n) {
        await state.update(cur => { cur.batch.list[j] = {...cur.batch.list[j], status: 'empty', summary: evalSummary(items), finishedAt: at()}; return {...cur, items}; });
        await state.log(`${label}: nenhuma seção elegível para gerar; seguindo para a próxima.`);
        return 'next';
      }
      await state.update(cur => cur.evaluationId === id ? {...cur, items} : undefined);
      await state.log(`${label}: ${n} ${n === 1 ? 'seção' : 'seções'} na fila.`);
      return 'next';
    } catch (err) {
      const info = describe(err, 'open_evaluation');
      if (['nl_tab_closed', 'connection', 'nl_not_logged'].includes(info.code)) {
        // The tab itself needs the person: the batch waits on this evaluation (it opens again on Continuar).
        await state.setBatchEntry(j, {status: 'pending'});
        await state.pause({...info, section: label, actions: ['continue', 'skip_eval']});
        this.env.notify('Modo automático pausado', `${label}: ${info.message}`);
        return 'interrupted';
      }
      await state.setBatchEntry(j, {status: 'error', error: info.message, finishedAt: at()});
      await state.log(`${label}: ${info.message} A avaliação fica fora do lote; seguindo para a próxima.`);
      return 'next';
    }
  }

  /**
   * The lane's NeuroLaudos IA tab. A parallel lane without one (first evaluation, or the tab was closed) gets a duplicate
   * of the batch's tab (the sign-in of the tab goes along); a single run never opens tabs on its own.
   */
  async ensureNlTab(s) {
    if (s.nlTabId && await this.env.tabExists(s.nlTabId)) return s;
    if (!s.lanes || !this.env.openNlTab) throw new AutoError('nl_tab_closed');
    const from = s.lanes.map(l => l.nlTabId).find(x => x != null) ?? null;
    const id = await this.env.openNlTab(from);
    if (!id) throw new AutoError('nl_tab_closed');
    await this.env.state.setRun({nlTabId: id});
    await this.env.state.log('Aba do NeuroLaudos IA aberta para esta avaliação (em segundo plano).');
    return {...s, nlTabId: id};
  }

  /** Takes the NeuroLaudos IA tab to an evaluation, on "Conferir seções" (the app does it; the extension only asks). */
  async openEval(s, id) {
    const r = await this.env.send(s.nlTabId, {cmd: 'nl.openEvaluation', evaluationId: id}, LIMITS.openEvaluation + 5000);
    if (!r) throw new AutoError('connection');
    if (r.ok === false) throw new AutoError(r.code || 'nl_eval_open', 'open_evaluation', r.detail);
  }

  /** Runs the steps of one section from where it stopped. Returns true when the section reached a final status. */
  async processItem(idx) {
    const {state} = this.env;
    let s = await state.load();
    let it = s.items[idx];
    const steps = RUN_STEPS;
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
    const settings = await this.env.settings();
    // Batch: ChatGPT's usage limit. When the task is still untouched in NeuroLaudos IA (the plugin never fetched it), the
    // message did not count: after a shared pause, the same task goes again in a new conversation of this lane's own
    // ChatGPT tab. A few times at most; then the lane pauses for the person.
    if (info.code === 'cg_rate_limit' && s.batch && (it.rateRetries || 0) < RATE_RETRIES && it.code && await this.taskUntouched(s, it)) {
      const mins = settings.rateLimitMinutes ?? 10;
      await state.update(cur => ({...cur, cooldownUntil: Math.max(cur.cooldownUntil || 0, this.env.now() + mins * 60000)}));
      await state.setItem(idx, {status: 'pending', step: 'chatgpt_new', sentAt: null, chatDone: false, authNotified: false, error: info, rateRetries: (it.rateRetries || 0) + 1});
      await state.setRun({chatPluginOk: false});
      await state.log(`${it.name}: limite de uso do ChatGPT. Nova tentativa em ${mins} min, nesta mesma aba e com a mesma tarefa ${it.code} (não chegou a ser lida). As outras avaliações também esperam para enviar.`);
      return false;
    }
    // Automatic retry only before anything was sent and for errors that do not need the person.
    if (!it.sentAt && !NEEDS_PERSON.includes(info.code) && !GLOBAL.includes(info.code) && attempts <= (settings.retries ?? 1)) {
      await state.setItem(idx, {attempts, step: 'navigate', error: info});
      await state.log(`${it.name}: nova tentativa automática.`);
      return false;
    }
    if (info.code === 'cg_no_save' && (it.noSaveRetries || 0) < NO_SAVE_RETRIES) {
      await state.setItem(idx, {status: 'pending', step: 'navigate', error: info, sentAt: null, chatDone: false, pluginManual: false, authNotified: false, noSaveRetries: (it.noSaveRetries || 0) + 1});
      await state.setRun({chatPluginOk: false});   // the new try starts a new conversation
      this.forget(s, it);
      await state.log(`${it.name}: o ChatGPT respondeu sem salvar o rascunho; nova tentativa automática em uma conversa nova.`);
      return false;
    }
    const status = info.code === 'nl_expired' ? 'expired' : 'error';
    await state.setItem(idx, {status, error: info, attempts});
    if (s.policy?.onError === 'next' && !GLOBAL.includes(info.code)) { await this.safeClose(s, it); return true; }
    const actions = ['continue', 'retry', 'skip', ...(info.code.startsWith('cg_plugin') ? ['plugin_done'] : []), ...(s.batch ? ['skip_eval'] : [])];
    await state.pause({...info, section: it.name, actions});
    if (s.policy?.background && info.code.startsWith('cg_') && s.chatTabId && info.code !== 'cg_tab_closed') {
      await this.env.activate(s.chatTabId);
      await state.log(`${it.name}: aba do ChatGPT trazida para frente para você ver o problema.`);
    }
    this.env.notify('Modo automático pausado', `${it.name}: ${info.message}`);
    return false;
  }

  // ---------- steps ----------
  async nl(s, msg, wait = LIMITS.contentReady) {
    const {send} = this.env;
    s = await this.ensureNlTab(s);
    let r = await send(s.nlTabId, {...msg, evaluationId: s.evaluationId}, wait);
    // Batch: the extension drives this tab. If it shows another evaluation, it goes back to the run's one (once) and
    // asks again; the page answers only for the evaluation id sent, so nothing is read from another patient.
    if (r?.ok === false && r.code === 'nl_changed' && s.batch && s.evaluationId) {
      await this.env.state.log('A aba do NeuroLaudos IA estava em outra avaliação; voltando para a avaliação do lote. O rascunho é salvo pelo código da tarefa, sempre na avaliação de origem.');
      await this.openEval(s, s.evaluationId);
      r = await send(s.nlTabId, {...msg, evaluationId: s.evaluationId}, wait);
    }
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
    if (it.evaluationId && it.evaluationId !== s.evaluationId) throw new AutoError('nl_changed', 'navigate', 'seção de outra avaliação');
    if (s.batch) await this.openEval(s, s.evaluationId);
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
    // An open task made before this run is never reused: a new code is prepared, so nothing of an earlier run goes along.
    if (reusable(modal, this.env.now())) await state.log(`${it.name}: tarefa ${modal.code} de antes desta execução não é reutilizada; uma nova será preparada.`);
    if (it.code && modal.code === it.code && modal.status === 'expired') { await state.log(`${it.name}: tarefa ${it.code} expirou; uma nova será preparada.`); }
    await state.setItem(idx, {status: 'preparing'});
    const r = await this.nl(s, {cmd: 'nl.prepare', key: it.key, images: !!s.policy?.sendImages, previous: modal.code || null}, LIMITS.prepare + 5000);
    const code = r.modal?.code;
    if (!isTaskCode(code)) throw new AutoError('nl_no_code', 'prepare');
    if (code === modal.code && !reusable(modal, this.env.now()) && modal.status !== 'none') throw new AutoError('nl_no_code', 'prepare', 'o código não mudou');
    if (this.codeTaken(s, idx, code)) throw new AutoError('nl_bad_command', 'prepare', 'código repetido');
    await state.setItem(idx, {code, reused: false});
    await state.update(cur => cur && ({...cur, usedCodes: [...(cur.usedCodes || []), code].slice(-500)}));
    await state.log(`${it.name}: tarefa ${code} preparada.`);
  }

  /** A code already used in this run (any section, any evaluation of the batch) is never taken again. */
  codeTaken(s, idx, code) { return s.items.some((o, i) => i !== idx && o.code === code) || (s.usedCodes || []).includes(code); }
  forget(s, it) { this.commands.delete(mk(s, it)); this.images.delete(mk(s, it)); }

  async stepCommand(s, idx, it) {
    const r = await this.nl(s, {cmd: 'nl.command', key: it.key}, LIMITS.command + 5000);
    const chk = checkCommand(r.command, it.code);
    if (!chk.ok) throw new AutoError(r.command ? 'nl_bad_command' : 'nl_no_command', 'command', chk.reason);
    this.commands.set(mk(s, it), r.command);   // kept in memory only, per evaluation and section
    this.images.set(mk(s, it), s.policy?.sendImages ? r.images || [] : []);
    await this.env.state.setItem(idx, {status: 'waiting_chatgpt'});
  }

  async stepChatNew(s, idx, it) {
    const {state, openChat, activate, send, sleep, now} = this.env;
    let tabId = s.chatTabId && (await this.env.tabExists(s.chatTabId)) ? s.chatTabId : null;
    // Option "mesma conversa": after the first section, the next ones go on in the conversation already open.
    const reuse = !!s.policy?.sameChat && !!s.chatPluginOk && !!tabId;
    const bg = !!s.policy?.background;
    if (reuse) {
      if (!bg) await activate(tabId);
      const r = await send(tabId, {cmd: 'cg.ping'}, 15000).catch(() => null);
      if (r?.ready) return;
      if (r && r.loggedIn === false) throw new AutoError('cg_not_logged', 'chatgpt_new');
    }
    if (s.chatPluginOk) await state.setRun({chatPluginOk: false});
    const isNew = !tabId;
    tabId = await openChat(tabId, CHATGPT_URL, {background: bg, nearTabId: s.nlTabId});
    if (tabId !== s.chatTabId) await state.setRun({chatTabId: tabId});
    if (!bg) await activate(tabId);
    else if (isNew) await state.log('ChatGPT aberto em segundo plano, na aba ao lado. Você pode continuar aqui; a aba só vem para frente se precisar de você.');
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
    const r = await this.inFront(s2, it, () => this.cg(s2, {cmd: 'cg.selectPlugin', name: PLUGIN_NAME, trustManual: !!it.pluginManual}, LIMITS.pluginMenu + LIMITS.pluginChip + 8000));
    if (s2.policy?.sameChat) await this.env.state.setRun({chatPluginOk: true});
    await this.env.state.log(`${it.name}: plugin ${PLUGIN_NAME} ${r.manual ? 'marcado como selecionado por você' : r.how === 'chip' || r.how === 'picker' ? 'escolhido na lista do ChatGPT' : 'mencionado como @' + PLUGIN_NAME}.`);
  }

  async stepInsert(s, idx, it) {
    let command = this.commands.get(mk(s, it));
    if (!command) {   // worker restarted: read the official command again
      const r = await this.nl(s, {cmd: 'nl.command', key: it.key}, LIMITS.command + 5000);
      if (!checkCommand(r.command, it.code).ok) throw new AutoError('nl_bad_command', 'insert');
      command = r.command; this.commands.set(mk(s, it), command);
      this.images.set(mk(s, it), s.policy?.sendImages ? r.images || [] : []);
      if (!s.policy?.background) await this.env.activate(s.chatTabId);
    }
    const images = this.images.get(mk(s, it)) || [];
    await this.inFront(s, it, () => this.cg(s, {cmd: 'cg.insert', text: command, code: it.code, name: PLUGIN_NAME, images}, images.length ? 60000 : 15000));
    if (images.length) await this.env.state.log(`${it.name}: ${images.length} ${images.length === 1 ? 'imagem anexada' : 'imagens anexadas'} à mensagem do ChatGPT.`);
  }

  /**
   * Background mode: some ChatGPT controls only react in a visible tab. When a step that sends nothing fails in the
   * background, it is tried once more with the ChatGPT tab in front (never used for the send itself).
   */
  async inFront(s, it, fn) {
    try { return await fn(); } catch (err) {
      const code = err instanceof AutoError ? err.code : '';
      if (!s.policy?.background || !code.startsWith('cg_') || ['cg_not_logged', 'cg_tab_closed', 'cg_rate_limit'].includes(code)) throw err;
      await this.env.state.log(`${it.name}: o ChatGPT não respondeu em segundo plano; trazendo a aba para frente e tentando de novo.`);
      await this.env.activate(s.chatTabId);
      return fn();
    }
  }

  async stepSend(s, idx, it) {
    if (it.sentAt) return;   // never twice: after a restart the run goes on to waiting and checking
    if (s.batch && (await this.waitSlot(idx)) === 'interrupted') return 'interrupted';
    await this.env.state.setItem(idx, {sentAt: new Date(this.env.now()).toISOString(), status: 'waiting_chatgpt'});
    try {
      await this.cg(s, {cmd: 'cg.send', code: it.code}, LIMITS.sendReady + LIMITS.sendAck + 5000);
    } catch (err) {
      // The page did not show the send, but NeuroLaudos IA may already have the task in use: that is the proof.
      if (!(err instanceof AutoError) || err.code !== 'cg_send' || !(await this.taskMoved(s, it, 30000))) throw err;
      await this.env.state.log(`${it.name}: envio confirmado pelo NeuroLaudos IA (tarefa em uso pelo plugin).`);
    }
    this.forget(s, it);
    await this.env.state.log(`${it.name}: comando com ${it.code} enviado ao ChatGPT.`);
  }

  /**
   * Batch: one shared slot per message to ChatGPT, spaced by batchGapSeconds for the whole account (every lane), taken
   * inside the serialised update (two lanes never share a slot). After a usage limit, nobody sends before the pause
   * ends: a slot that falls inside it is taken again after it.
   */
  async waitSlot(idx) {
    const {state, now, sleep} = this.env;
    const gap = ((await this.env.settings()).batchGapSeconds ?? 20) * 1000;
    for (;;) {
      let slot = 0;
      const cur = await state.update(c => { slot = Math.max(now(), c.nextSendAt || 0, c.cooldownUntil || 0); return {...c, nextSendAt: slot + gap}; });
      if (!cur || cur.status !== RUN.running) return 'interrupted';
      if (slot > now()) await sleep(slot - now());
      const after = await state.load();
      if (!after || after.status !== RUN.running) return 'interrupted';
      if (!(after.cooldownUntil > now())) { await state.setItem(idx, {slotAt: new Date(slot).toISOString()}); return; }
    }
  }

  /** True only when NeuroLaudos IA shows the task still pending (never fetched by the plugin). Any doubt: false. */
  async taskUntouched(s, it) {
    try {
      const r = await this.nl(s, {cmd: 'nl.waitStatus', key: it.key, code: it.code, chunkMs: 1000}, 15000);
      return r?.modal?.code === it.code && r.modal.status === 'pending';
    } catch { return false; }
  }

  /** True when NeuroLaudos IA shows the task taken by the plugin (or, with `received`, only when the draft arrived). */
  async taskMoved(s, it, ms, received = false) {
    const end = this.env.now() + ms;
    do {
      let r;
      try { r = await this.nl(s, {cmd: 'nl.waitStatus', key: it.key, code: it.code, chunkMs: Math.min(5000, ms)}, Math.min(5000, ms) + 10000); } catch { return false; }
      const st = r?.modal?.code === it.code ? r.modal.status : null;
      if (st === 'draft_received' || st === 'reviewed' || st === 'error' || (!received && st === 'processing')) return true;
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
      // Diagnosis in the run log ("Ver detalhes"): what the ChatGPT page looked like, only when it changes. Never text of the conversation.
      const seen = `${r.state}${r.stalled ? ' (sem mudança)' : ''} · ${String(r.diag || '').replace(/ parado-há=\d+s/, '')}`;
      if (seen !== this.lastDiag) { this.lastDiag = seen; await state.log(`${it.name}: ChatGPT ${r.state}${r.stalled ? ' (sem mudança)' : ''}${r.diag ? ' · ' + r.diag : ''}`); }
      if (r.state === 'done') { await state.setItem(idx, {chatDone: true}); return; }
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
    // ChatGPT already finished its answer: the plugin saves during the answer, so the draft is there in seconds.
    const chatDone = !!(await state.load())?.items[idx]?.chatDone;
    const end = now() + Math.min(settings.confirmSeconds || 120, chatDone ? NO_SAVE_SECONDS : Infinity) * 1000;
    while (now() < end) {
      const cur = await state.load();
      if (!cur || cur.status !== RUN.running) return 'interrupted';
      if (it.evaluationId && it.evaluationId !== cur.evaluationId) throw new AutoError('nl_changed', 'confirm', 'seção de outra avaliação');
      const r = await this.nl(cur, {cmd: 'nl.waitStatus', key: it.key, code: it.code, chunkMs: Math.min(LIMITS.chunk, Math.max(1000, end - now()))}, LIMITS.chunk + 10000);
      const o = outcome(r.modal, it.code);
      if (o.kind === 'received') { await state.setItem(idx, {status: 'received'}); await state.log(`${it.name}: rascunho recebido no NeuroLaudos IA.`); return; }
      if (o.kind === 'needs_review') { await state.setItem(idx, {status: 'needs_review', reason: 'A seção já tinha texto: confirme a substituição no NeuroLaudos IA'}); await state.log(`${it.name}: rascunho recebido; revisão necessária (substituição não feita).`); return; }
      if (o.kind === 'expired') throw new AutoError('nl_expired', 'confirm');
      if (o.kind === 'problem') throw new AutoError(PROBLEM_CODE[o.detail] || 'cg_cannot', 'confirm');
      if (o.kind === 'failed') throw new AutoError('nl_task_failed', 'confirm', o.detail);
      if (o.kind === 'other') throw new AutoError('nl_changed', 'confirm', 'outra tarefa aberta na seção');
    }
    throw new AutoError(chatDone ? 'cg_no_save' : 'nl_not_received', 'confirm');
  }

  async stepClose(s, idx, it) {
    await this.safeClose(s, it);
  }
  async safeClose(s, it) { try { await this.nl(s, {cmd: 'nl.closeModal', key: it.key}, 8000); } catch {} }

}

/** Batch ids: 1 to BATCH_MAX different evaluation ids (the app's ids, never names). Returns the list. */
export function checkBatchIds(ids) {
  const list = [...new Set((ids || []).map(String))];
  if (!list.length || list.length > BATCH_MAX || list.length !== (ids || []).length || !list.every(id => EVAL_ID_RE.test(id))) {
    throw Object.assign(new AutoError('nl_selector'), {message: `Escolha de 1 a ${BATCH_MAX} avaliações diferentes.`, hint: 'Marque as avaliações na lista e tente de novo.'});
  }
  return list;
}
const RATE_RETRIES = 3;

/** Key of the in-memory command and images: evaluation and section (section keys repeat across evaluations). */
const mk = (s, it) => `${it.evaluationId || s.evaluationId || ''}|${it.key}`;
/** Counters of a whole batch, from the evaluations that ended and the one that is open. */
export function batchTotals(s) {
  const t = {evals: s.batch?.list.length || 0, received: 0, review: 0, errors: 0, failed: 0};
  for (const e of s.batch?.list || []) {
    if (e.status === 'error') t.failed++;
    const sum = e.summary || (e === s.batch.list[s.batch.index] ? evalSummary(s.items) : null);
    if (sum) { t.received += sum.received; t.review += sum.review; t.errors += sum.errors; }
  }
  return t;
}

/** After ChatGPT finished: how long to wait for the draft, and automatic tries in a new conversation. */
const NO_SAVE_SECONDS = 30, NO_SAVE_RETRIES = 1;
/** Reason given by ChatGPT (informar_problema) -> error shown in the panel. */
const PROBLEM_CODE = {dados_divergentes: 'cg_diverge', dados_insuficientes: 'cg_insufficient', instrucao_conflitante: 'cg_conflict', outro: 'cg_cannot'};
const RUN_STEPS = ['navigate', 'open_modal', 'prepare', 'command', 'chatgpt_new', 'plugin', 'insert', 'send', 'wait_chatgpt', 'confirm', 'close'];
const STEP_FN = {navigate: 'stepNavigate', open_modal: 'stepOpenModal', prepare: 'stepPrepare', command: 'stepCommand', chatgpt_new: 'stepChatNew', plugin: 'stepPlugin', insert: 'stepInsert', send: 'stepSend', wait_chatgpt: 'stepWaitChat', confirm: 'stepConfirm', close: 'stepClose'};
