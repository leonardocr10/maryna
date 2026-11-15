// Batch in parallel: up to BATCH_MAX evaluations at the same time, each in its own lane.
// A lane is one NeuroLaudos IA tab (a duplicate of the tab where the batch started, so the sign-in goes along) plus
// one ChatGPT tab with its own conversations. Each lane runs the same AutomationManager as a single run, with a
// LaneState that shows it only its own part of the shared run (its evaluation, tabs, sections and status) plus the
// shared batch queue. The queue is taken one evaluation at a time inside the serialised state update, so two lanes
// never get the same evaluation. Messages to ChatGPT are spaced by a shared slot (and a shared pause after a usage
// limit), because the limits are per account, not per tab.
import {AutomationManager, checkBatchIds} from './automation-manager.js';
import {RUN, BATCH_MAX} from './constants.js';
import {AutoError} from './error-handler.js';
import {isActive} from './state-manager.js';

/** Fields that belong to one lane (everything else in the run is shared). */
export const LANE_KEYS = ['evaluationId', 'nlTabId', 'chatTabId', 'chatPluginOk', 'items', 'current', 'status', 'pause', 'finishedAt'];
/** Shared fields a lane may change. */
const SHARED = ['usedCodes', 'nextSendAt', 'cooldownUntil'];
const LIVE = [RUN.running, RUN.paused];
const MAX_LOG = 400;

/** Whole-run status from the lanes: running while one runs, then paused, stopped, done. */
export function aggregate(lanes) {
  if (lanes.some(l => l.status === RUN.running)) return RUN.running;
  if (lanes.some(l => l.status === RUN.paused)) return RUN.paused;
  if (lanes.some(l => l.status === RUN.stopped)) return RUN.stopped;
  return RUN.done;
}

/** What lane `i` sees: the run with its own fields on top and the batch index of its evaluation. */
export function laneView(g, i) {
  const L = g?.lanes?.[i];
  if (!L) return null;
  return {...g, ...L, batch: {...g.batch, index: L.batchIndex ?? -1}, lane: i};
}

function merge(g, n, i, iso) {
  const L = {};
  for (const k of LANE_KEYS) if (k in n) L[k] = n[k];
  L.batchIndex = n.batch?.index ?? g.lanes[i].batchIndex;
  const lanes = g.lanes.map((x, j) => j === i ? {...x, ...L} : x);
  const out = {...g, lanes, batch: {...g.batch, list: n.batch?.list || g.batch.list}};
  for (const k of SHARED) if (k in n) out[k] = n[k];
  out.status = aggregate(lanes);
  out.pause = null;
  out.finishedAt = LIVE.includes(out.status) ? null : (g.finishedAt || iso);
  return out;
}

/** StateManager interface for one lane, on top of the shared StateManager (same serialised chain). */
export class LaneState {
  constructor(root, i, clock = () => Date.now()) { this.root = root; this.i = i; this.clock = clock; }
  iso() { return new Date(this.clock()).toISOString(); }
  async load() { return laneView(await this.root.load(), this.i); }
  update(fn) {
    return this.root.update(async g => {
      const v = laneView(g, this.i);
      if (!v) return undefined;
      const n = await fn(v);
      if (n === undefined || n === null) return undefined;
      return merge(g, n, this.i, this.iso());
    }).then(g => laneView(g, this.i));
  }
  setRun(patch) { return this.update(s => ({...s, ...patch})); }
  setItem(index, patch) { return this.update(s => { if (!s.items[index]) return undefined; s.items[index] = {...s.items[index], ...patch, updatedAt: this.iso()}; return s; }); }
  setBatchEntry(index, patch) { return this.update(s => { if (!s.batch.list[index]) return undefined; s.batch.list[index] = {...s.batch.list[index], ...patch}; return s; }); }
  log(msg) {
    return this.root.update(g => {
      if (!g?.lanes) return undefined;
      const L = g.lanes[this.i];
      const tag = L.batchIndex >= 0 ? `[Avaliação ${L.batchIndex + 1}] ` : `[Aba ${this.i + 1}] `;
      g.log = [...(g.log || []), {t: this.iso(), msg: (tag + String(msg)).slice(0, 240), lane: this.i}].slice(-MAX_LOG);
      return g;
    });
  }
  pause(reason) { return this.update(s => LIVE.includes(s.status) ? {...s, status: RUN.paused, pause: reason || null} : undefined); }
  stop() { return this.update(s => ({...s, status: RUN.stopped, pause: null, finishedAt: this.iso()})); }
  finish() { return this.update(s => ({...s, status: RUN.done, pause: null, finishedAt: this.iso()})); }
}

/** After a browser or worker restart: every running lane is paused; a sent section goes back to checking. */
export function recoverLanes(s) {
  if (!s?.lanes) return s;
  const lanes = s.lanes.map(l => l.status !== RUN.running ? l : {
    ...l, status: RUN.paused,
    items: l.items.map(it => it.sentAt && !['received', 'needs_review', 'skipped', 'error', 'expired'].includes(it.status) ? {...it, step: 'confirm', status: 'confirming'} : it),
    pause: {code: 'interrupted', message: 'A execução foi interrompida (navegador ou extensão reiniciados).', hint: 'Confira o status e clique em Continuar; nada é reenviado sem conferência.'},
  });
  return {...s, lanes, status: aggregate(lanes)};
}

/**
 * Owns the single run (one evaluation, or a batch one after another) and the parallel batch (lanes).
 * env: the AutomationManager env plus openNlTab(fromTabId) -> tabId (duplicate of the NeuroLaudos IA tab, signed in).
 */
export class Coordinator {
  constructor(env) { this.env = env; this.single = new AutomationManager(env); this.mgrs = []; }

  lane(i) { return this.mgrs[i] ||= new AutomationManager(this.laneEnv(i)); }
  laneEnv(i) {
    const base = this.env;
    return {
      ...base,
      state: new LaneState(base.state, i, base.now),
      // Lanes never pull the NeuroLaudos IA tabs forward (they work in the background, and ten tabs would fight for
      // the focus). A ChatGPT tab still comes forward when the person is needed (authorization, a problem).
      activate: async id => { const s = await base.state.load(); if (s?.lanes?.some(l => l.nlTabId === id)) return; return base.activate(id); },
    };
  }

  async load() { return this.env.state.load(); }
  start(o) { return this.single.start(o); }

  async startBatch({parallel = 1, ...o}) {
    const {state, now} = this.env;
    const list = checkBatchIds(o.ids);
    const n = Math.max(1, Math.min(BATCH_MAX, Math.floor(+parallel) || 1, list.length));
    if (n <= 1) return this.single.startBatch(o);
    const cur = await state.load();
    if (isActive(cur)) throw new AutoError('busy');
    this.mgrs = [];
    const t = new Date(now()).toISOString();
    await state.update(() => ({
      runId: 'run-' + now().toString(36) + Math.random().toString(36).slice(2, 7),
      evaluationId: null, nlTabId: o.nlTabId, nlOrigin: o.nlOrigin, chatTabId: null, chatPluginOk: false, mode: o.mode,
      policy: {...o.policy, sameChat: false, background: true}, items: [], current: -1, usedCodes: [], parallel: n,
      batch: {index: -1, list: list.map(id => ({id, status: 'pending'}))},
      lanes: Array.from({length: n}, (_, i) => ({evaluationId: null, nlTabId: i === 0 ? o.nlTabId : null, chatTabId: null, chatPluginOk: false, items: [], current: -1, status: RUN.running, pause: null, batchIndex: -1, finishedAt: null})),
      status: RUN.running, pause: null, startedAt: t, finishedAt: null,
      log: [{t, msg: `Lote iniciado: ${list.length} avaliações, até ${n} ao mesmo tempo (uma aba do NeuroLaudos IA e uma do ChatGPT para cada).`}],
    }));
    this.kick();
    return state.load();
  }

  /** Starts every lane that should run (and the single run otherwise). */
  kick() {
    this.task = this.env.state.load().then(s => {
      if (!s?.lanes) return this.single.kick();
      return Promise.all(s.lanes.map((l, i) => l.status === RUN.running ? this.lane(i).kick() : null));
    });
    return this.task;
  }
  /** Resolves when no loop works any more (tests). */
  async idle() {
    for (;;) {
      await this.task;
      await Promise.all([this.single.task, ...this.mgrs.map(m => m?.task)].filter(Boolean));
      if (!this.single.looping && this.mgrs.every(m => !m?.looping)) return;
    }
  }

  async pause() {
    const s = await this.load();
    if (!s?.lanes) return this.single.pause();
    for (let i = 0; i < s.lanes.length; i++) if (s.lanes[i].status === RUN.running) await this.lane(i).pause();
  }
  async stop() {
    const s = await this.load();
    if (!s?.lanes) return this.single.stop();
    for (let i = 0; i < s.lanes.length; i++) if (LIVE.includes(s.lanes[i].status)) await this.lane(i).stop();
  }
  /** `lane` given: that lane's paused section (continue, retry, skip...). Without it: every paused lane continues. */
  async resume(action = 'continue', nlTabId = null, lane = null) {
    const s = await this.load();
    if (!s?.lanes) return this.single.resume(action, nlTabId);
    const targets = lane != null && s.lanes[lane] ? [lane] : s.lanes.map((l, i) => l.status === RUN.paused ? i : -1).filter(i => i >= 0);
    for (const i of targets) await this.lane(i).resume(lane != null ? action : 'continue');
    return this.load();
  }
  /**
   * "Refazer o que faltou": puts back in the queue the evaluations of the batch that ended with sections still missing
   * (error, expired, not reached) or that did not open. `index` picks one evaluation, null all of them. Sections that
   * already have a draft are kept and never sent again (advanceBatch carries them over).
   */
  async redoMissing(index = null) {
    const {state, now} = this.env;
    const s = await state.load();
    if (!s?.batch || isActive(s)) return s;
    const redo = (e, i) => (index == null || index === i) && (e.status === 'error' || ((e.status === 'done' || e.status === 'empty') && e.summary?.missing > 0));
    const targets = s.batch.list.map((e, i) => redo(e, i) ? i : -1).filter(i => i >= 0);
    if (!targets.length) return s;
    await state.update(cur => {
      for (const i of targets) cur.batch.list[i] = {...cur.batch.list[i], status: 'pending', error: null, finishedAt: null};
      Object.assign(cur, {status: RUN.running, pause: null, finishedAt: null, current: -1, chatPluginOk: false, items: [], evaluationId: null});
      if (cur.lanes) cur.lanes = cur.lanes.map(l => ({...l, status: RUN.running, pause: null, finishedAt: null, current: -1, items: [], evaluationId: null, chatPluginOk: false, batchIndex: -1}));
      return cur;
    });
    await state.log(`Refazer o que faltou: ${targets.length} ${targets.length === 1 ? 'avaliação volta' : 'avaliações voltam'} para a fila; as seções que já têm rascunho ficam como estão.`);
    if (!s.lanes) this.single.commands.clear();
    this.kick();
    return state.load();
  }
  async continueRun(nlTabId = null) {
    const s = await this.load();
    if (!s?.lanes) return this.single.continueRun(nlTabId);
    for (let i = 0; i < s.lanes.length; i++) await this.lane(i).continueRun();
    return this.load();
  }
  async reviewed(key, action, tabId = null) {
    const s = await this.load();
    if (!s?.lanes) return this.single.reviewed(key, action);
    const i = s.lanes.findIndex(l => l.nlTabId === tabId);
    if (i >= 0) return this.lane(i).reviewed(key, action);
  }
  /** A tab of a lane was closed: its NeuroLaudos IA tab pauses the lane; its ChatGPT tab is opened again when needed. */
  async tabClosed(id) {
    const s = await this.load();
    if (!isActive(s)) return;
    if (!s.lanes) {
      if (id === s.nlTabId) await this.env.state.pause({code: 'nl_tab_closed', message: 'A aba do NeuroLaudos IA foi fechada.', hint: 'Abra a avaliação de novo e clique em Continuar no painel.', actions: ['continue', 'skip']});
      if (id === s.chatTabId) await this.env.state.setRun({chatTabId: null, chatPluginOk: false});
      return;
    }
    for (let i = 0; i < s.lanes.length; i++) {
      const L = s.lanes[i], st = new LaneState(this.env.state, i, this.env.now);
      if (id === L.nlTabId) { await st.setRun({nlTabId: null}); await st.pause({code: 'nl_tab_closed', message: 'A aba do NeuroLaudos IA desta avaliação foi fechada.', hint: 'Clique em Continuar: a extensão abre outra aba e volta à avaliação.', actions: ['continue', 'skip_eval']}); }
      if (id === L.chatTabId) await st.setRun({chatTabId: null, chatPluginOk: false});
    }
  }
}
