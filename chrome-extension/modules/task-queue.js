// Builds the ordered queue of sections from what the NeuroLaudos IA page publishes (pure, tested in Node).
import {KIND, FINAL_ITEM} from './constants.js';

/**
 * scan.sections: [{key, name, kind: 'ai'|'fixed'|'hand'|'missing', state: 'pend'|'gen'|'ap'|'file'}] in document order.
 * options.existing: 'skip' | 'draft'; options.selected: keys chosen by the psychologist (all eligible when absent).
 * Returns {items, summary}. Ignored sections stay in the list (status 'skipped' with the reason) so the report is complete.
 */
export function buildQueue(scan, options = {}) {
  const existing = options.existing === 'draft' ? 'draft' : 'skip';
  const chosen = Array.isArray(options.selected) ? new Set(options.selected) : null;
  const seen = new Set();
  const items = [];
  for (const s of scan?.sections || []) {
    if (!s || !s.key || seen.has(s.key)) continue;   // never the same section twice
    seen.add(s.key);
    const base = {key: s.key, name: s.name || s.key, kind: s.kind || 'unknown', state: s.state || 'pend', status: 'pending', step: null, code: null, error: null, attempts: 0, sentAt: null, updatedAt: null};
    const why = skipReason(s, existing, chosen);
    items.push(why ? {...base, status: 'skipped', reason: why} : base);
  }
  return {items, summary: summarize(items, scan)};
}

export function skipReason(s, existing, chosen) {
  if (s.kind === 'fixed') return KIND.fixed;
  if (s.kind === 'hand') return KIND.hand;
  if (s.kind === 'missing') return KIND.missing;
  if (s.kind !== 'ai') return 'Tipo de seção não identificado com segurança';
  if (s.state === 'ap' || s.state === 'file') return 'Já aprovada';
  if (s.state === 'gen' && existing === 'skip') return 'Já tem texto (política: não substituir)';
  if (chosen && !chosen.has(s.key)) return 'Não selecionada';
  return null;
}

/** Counters for the panel (always computed from the items, never stored separately). */
export function summarize(items, scan) {
  const sections = scan?.sections || items;
  const c = k => items.filter(i => i.status === k).length;
  const work = items.filter(i => i.status !== 'skipped' || i.done);
  return {
    total: sections.length,
    eligible: sections.filter(s => s.kind === 'ai').length,
    fixed: sections.filter(s => s.kind === 'fixed').length,
    withText: sections.filter(s => s.kind === 'ai' && s.state === 'gen').length,
    queued: work.length,
    done: items.filter(i => i.status === 'received' || i.status === 'simulated').length,
    review: c('needs_review'),
    errors: items.filter(i => i.status === 'error' || i.status === 'expired').length,
    pending: work.filter(i => !FINAL_ITEM.includes(i.status) && i.status !== 'error' && i.status !== 'expired').length,
  };
}

/** Index of the next item to work on (the first not finished, not skipped, not failed), or -1. */
export function nextIndex(items, from = 0) {
  for (let i = Math.max(0, from); i < items.length; i++) {
    const it = items[i];
    if (it.status === 'skipped' || FINAL_ITEM.includes(it.status) || it.status === 'error' || it.status === 'expired') continue;
    return i;
  }
  return -1;
}

/** Progress shown in the bar: finished items over items to work on. */
export function progress(items) {
  const work = items.filter(i => i.status !== 'skipped');
  const done = work.filter(i => FINAL_ITEM.includes(i.status) || i.status === 'error' || i.status === 'expired').length;
  return {done, total: work.length, pct: work.length ? Math.round(done * 100 / work.length) : 0};
}
