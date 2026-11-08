// Pure checks on task codes, commands and statuses (no chrome.* here: runs in Node tests too).
import {NL_OPEN} from './constants.js';

/** NL-XXXX-XXXX with the server's alphabet (no 0/O, 1/I/L). */
export const CODE_RE = /\bNL-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}\b/;

export function isTaskCode(code) { return typeof code === 'string' && new RegExp(`^${CODE_RE.source}$`).test(code.trim()); }

/** The code inside a text (command), or null. */
export function codeIn(text) { const m = String(text || '').match(CODE_RE); return m ? m[0] : null; }

/** The official command must exist, mention the plugin and carry exactly this task's code. */
export function checkCommand(command, code) {
  const t = String(command || '').trim();
  if (!t) return {ok: false, reason: 'Comando vazio.'};
  if (!isTaskCode(code)) return {ok: false, reason: 'Código da tarefa inválido.'};
  const codes = t.match(new RegExp(CODE_RE.source, 'g')) || [];
  if (!codes.includes(code)) return {ok: false, reason: `O comando não contém o código ${code}.`};
  if (codes.some(c => c !== code)) return {ok: false, reason: 'O comando contém outro código de tarefa.'};
  if (!/neurolaudos/i.test(t)) return {ok: false, reason: 'O comando não menciona o plugin NeuroLaudos IA.'};
  if (t.length > 4000) return {ok: false, reason: 'Comando maior que o esperado.'};
  return {ok: true};
}

export function isExpired(expiresAt, now = Date.now()) { const t = Date.parse(expiresAt || ''); return Number.isFinite(t) && t <= now; }

/** A task the extension may reuse instead of preparing a new one. */
export function reusable(task, now = Date.now()) {
  return !!task && task.mode === 'mcp' && NL_OPEN.includes(task.status) && isTaskCode(task.code) && !isExpired(task.expires, now);
}

/**
 * Outcome of the NeuroLaudos IA status for the task the run is following.
 * received: draft saved in the section; needs_review: draft waits for her confirmation (text already there);
 * waiting: still open; failed/expired: the task ended without a draft; other: a different task is shown.
 */
export function outcome(modal, code) {
  if (!modal) return {kind: 'unknown'};
  if (code && modal.code && modal.code !== code) return {kind: 'other', detail: modal.code};
  const s = modal.status;
  if (s === 'draft_received' && modal.needsConfirmation) return {kind: 'needs_review'};
  if (s === 'draft_received' || s === 'reviewed') return {kind: 'received'};
  if (NL_OPEN.includes(s)) return {kind: 'waiting'};
  if (s === 'expired') return {kind: 'expired'};
  if (s === 'error' || s === 'discarded') return {kind: 'failed', detail: s};
  // No task shown: the code we followed is gone (should not happen after a send).
  if (s === 'none' && code) return {kind: 'unknown'};
  return {kind: 'unknown'};
}

/** Text normalisation used to compare names seen in a page (accents and case ignored). */
export function norm(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
