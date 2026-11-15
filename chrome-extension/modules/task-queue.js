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
    done: items.filter(i => i.status === 'received').length,
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

/** The default Conclusão instruction ends open ("...apresenta características "): she completes it before a run. */
export const conclusionUnfinished = t => /caracter[ií]sticas\s*\.?\s*$/i.test(String(t || '').trim()) || !String(t || '').trim();
export const DEMAND_KEY = 'demanda', CONCLUSION_KEY = 'conclusao', RECOMMENDATIONS_KEY = 'recomendacoes';
export const isDemand = s => s.key === DEMAND_KEY || /descri[cç][aã]o da demanda/i.test(s.name || '');

/**
 * Queue of one evaluation of a batch (nobody chooses sections per evaluation there):
 * - Descrição da demanda only when `includeDemand` (off by default, like the single run);
 * - Conclusão only when its instruction was completed (`conclusionReady`): an open instruction is never sent;
 * - Recomendações come from the Conclusão text: skipped when the Conclusão is skipped and has no text yet.
 * Every item carries the evaluation id it belongs to.
 */
export function batchQueue(scan, {existing = 'draft', includeDemand = false, conclusionReady = false, evaluationId} = {}) {
  const {items} = buildQueue(scan, {existing});
  const concl = items.find(i => i.key === CONCLUSION_KEY);
  let conclSkipped = false;
  for (const it of items) {
    it.evaluationId = evaluationId;
    if (it.status !== 'pending') continue;
    if (!includeDemand && isDemand(it)) Object.assign(it, {status: 'skipped', reason: 'Descrição da demanda: fora do lote (opção desligada)'});
    else if (it.key === CONCLUSION_KEY && !conclusionReady) { Object.assign(it, {status: 'skipped', reason: 'Instrução da Conclusão incompleta: complete-a na seção e gere depois'}); conclSkipped = true; }
    else if (it.key === RECOMMENDATIONS_KEY && conclSkipped && concl?.state === 'pend') Object.assign(it, {status: 'skipped', reason: 'Depende do texto da Conclusão, que ainda não existe'});
  }
  return items;
}

/** Counters of one evaluation of a batch, kept after it ends (the items of the next evaluation replace its own). */
export function evalSummary(items) {
  const n = k => items.filter(i => i.status === k).length;
  return {received: n('received'), review: n('needs_review'), errors: n('error') + n('expired'), queued: items.filter(i => i.status !== 'skipped' || i.reason === 'Pulada por você').length};
}
