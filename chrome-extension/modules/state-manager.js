// Run state kept in chrome.storage.local (survives a closed tab, a restarted worker or browser).
// Holds only ids, codes, steps and statuses: never patient data or clinical text.
import {STORAGE_KEY, RUN} from './constants.js';

const MAX_LOG = 150;

/** storage: {get(key) -> value, set(key, value), remove(key)} (chrome.storage.local adapter or a Map in tests). */
export class StateManager {
  constructor(storage, clock = () => Date.now()) { this.storage = storage; this.clock = clock; this.chain = Promise.resolve(); }

  async load() { return (await this.storage.get(STORAGE_KEY)) || null; }

  /** Serialised read-modify-write: two updates never overwrite each other. */
  update(fn) {
    const run = this.chain.then(async () => {
      const cur = await this.load();
      const next = await fn(cur ? structuredClone(cur) : null);
      if (next === undefined) return cur;
      if (next === null) { await this.storage.remove(STORAGE_KEY); return null; }
      next.updatedAt = new Date(this.clock()).toISOString();
      await this.storage.set(STORAGE_KEY, next);
      return next;
    });
    this.chain = run.catch(() => {});
    return run;
  }

  create({evaluationId, nlTabId, nlOrigin, mode, policy, items}) {
    const now = new Date(this.clock()).toISOString();
    return this.update(() => ({
      runId: 'run-' + this.clock().toString(36) + Math.random().toString(36).slice(2, 7),
      evaluationId, nlTabId, nlOrigin, chatTabId: null, mode, policy, items,
      status: RUN.running, pause: null, current: -1, startedAt: now, finishedAt: null, log: [{t: now, msg: `Execução iniciada (${items.filter(i => i.status !== 'skipped').length} seções).`}],
    }));
  }

  setRun(patch) { return this.update(s => s && {...s, ...patch}); }

  setItem(index, patch) {
    return this.update(s => {
      if (!s || !s.items[index]) return undefined;
      s.items[index] = {...s.items[index], ...patch, updatedAt: new Date(this.clock()).toISOString()};
      return s;
    });
  }

  /** Operational log line (no page text). */
  log(msg) {
    return this.update(s => {
      if (!s) return undefined;
      s.log = [...(s.log || []), {t: new Date(this.clock()).toISOString(), msg: String(msg).slice(0, 240)}].slice(-MAX_LOG);
      return s;
    });
  }

  pause(reason) { return this.update(s => s && (s.status === RUN.running || s.status === RUN.paused) ? {...s, status: RUN.paused, pause: reason || null} : undefined); }
  stop() { return this.update(s => s ? {...s, status: RUN.stopped, pause: null, finishedAt: new Date(this.clock()).toISOString()} : undefined); }
  finish() { return this.update(s => s ? {...s, status: RUN.done, pause: null, finishedAt: new Date(this.clock()).toISOString()} : undefined); }
  clear() { return this.update(() => null); }
}

/** True when a run is active (running or paused) and blocks a new one. */
export const isActive = s => !!s && (s.status === RUN.running || s.status === RUN.paused);

/**
 * After a browser or worker restart: a running run becomes paused, and a section that already had its message sent
 * is put back to the confirmation step, so nothing is sent again without checking the real status first.
 */
export function recoverAfterRestart(s) {
  if (!s || s.status !== RUN.running) return s;
  const items = s.items.map(it => it.sentAt && !['received', 'needs_review', 'skipped', 'simulated', 'error', 'expired'].includes(it.status) ? {...it, step: 'confirm', status: 'confirming'} : it);
  return {...s, items, status: RUN.paused, pause: {code: 'interrupted', message: 'A execução foi interrompida (navegador ou extensão reiniciados).', hint: 'Confira o status e clique em Continuar; nada é reenviado sem conferência.'}};
}
