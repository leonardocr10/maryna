// Synthetic NeuroLaudos IA and ChatGPT for the flow tests. No real data: section names are the app's fixed titles,
// codes are generated here, nothing is sent anywhere.
import {StateManager} from '../modules/state-manager.js';
import {DEFAULT_SETTINGS} from '../modules/constants.js';
import {AutomationManager} from '../modules/automation-manager.js';

export const NL_TAB = 1, CHAT_TAB = 2;
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let seq = 0;
export function newCode() { let n = 1000003 + (++seq) * 7919, out = ''; for (let i = 0; i < 8; i++) { out += ALPHA[n % 31]; n = Math.floor(n / 31) + i * 13; } return `NL-${out.slice(0, 4)}-${out.slice(4)}`; }

export function section(key, name, kind = 'ai', state = 'pend') { return {key, name, kind, state}; }

/**
 * opts.nl: {sections, tasks: {key: {code,status,mode,expires,needsConfirmation}}, mcp, readOnly, evaluationId, draftOutcome(key): 'received'|'needs_review'|'never'|'error', notEligible: [keys]}
 * opts.cg: {plugin: 'ok'|'missing'|'unverified', authFor: Set(keys) rounds, rateLimit, sendFails, loggedIn}
 */
export function makeEnv(opts = {}) {
  const map = new Map();
  const storage = {get: async k => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async k => { map.delete(k); }};
  let clock = Date.parse('2026-11-08T12:00:00Z');
  const calls = [];
  const notes = [];
  const nl = {evaluationId: 'ev-sint-1', mcp: true, readOnly: false, tasks: {}, notEligible: [], draftOutcome: () => 'received', ...(opts.nl || {})};
  const cg = {plugin: 'ok', auth: 0, rateLimit: false, sendFails: false, loggedIn: true, ...(opts.cg || {})};
  let openModal = null, lastSent = null, chipManual = false, authLeft = 0;

  const view = key => { const t = nl.tasks[key]; return t ? {ready: true, mcp: nl.mcp, method: 'mcp', busy: false, code: t.code, mode: t.mode || 'mcp', status: t.status, expires: t.expires || new Date(clock + 864e5).toISOString(), needsConfirmation: !!t.needsConfirmation, applied: t.status === 'draft_received' && !t.needsConfirmation} : {ready: true, mcp: nl.mcp, method: 'mcp', busy: false, code: null, mode: null, status: 'none', expires: null, needsConfirmation: false, applied: false}; };

  function nlHandle(msg) {
    if (msg.cmd !== 'nl.scan' && msg.evaluationId && msg.evaluationId !== nl.evaluationId) return {ok: false, code: 'nl_changed'};
    switch (msg.cmd) {
      case 'nl.scan': return {ok: true, evaluationId: nl.evaluationId, readOnly: nl.readOnly, sections: nl.sections};
      case 'nl.openSection': return {ok: true};
      case 'nl.openModal': if (nl.notEligible.includes(msg.key)) return {ok: true, notEligible: true, reason: 'Texto fixo do arquivo'}; openModal = msg.key; return {ok: true, modal: view(msg.key)};
      case 'nl.modalInfo': return {ok: true, modal: view(msg.key)};
      case 'nl.prepare': { const code = newCode(); nl.tasks[msg.key] = {code, status: 'pending'}; return {ok: true, modal: view(msg.key)}; }
      case 'nl.command': { const t = nl.tasks[msg.key]; return {ok: true, command: `@NeuroLaudos IA Utilize o plugin NeuroLaudos IA para buscar a tarefa pendente da seção "${msg.key}" identificada pelo código ${t.code}. Ao concluir, salve como rascunho.`}; }
      case 'nl.waitStatus': { clock += msg.chunkMs || 1000; return {ok: true, modal: view(msg.key)}; }
      case 'nl.closeModal': openModal = null; return {ok: true};
    }
    return {ok: false, code: 'connection'};
  }

  /** The plugin saves the draft on the server once the answer is done (the real success criterion). */
  function saveDraft() {
    const key = Object.keys(nl.tasks).find(k => nl.tasks[k].code === lastSent);
    if (!key || nl.tasks[key].status !== 'pending') return;
    const out = nl.draftOutcome(key);
    if (out === 'received') nl.tasks[key].status = 'draft_received';
    if (out === 'needs_review') Object.assign(nl.tasks[key], {status: 'draft_received', needsConfirmation: true});
    if (out === 'error') nl.tasks[key].status = 'error';
  }
  function cgHandle(msg) {
    switch (msg.cmd) {
      case 'cg.ping': return {ok: true, ready: cg.loggedIn, loggedIn: cg.loggedIn, composer: true, hasMessages: false};
      case 'cg.selectPlugin':
        if (msg.trustManual) { chipManual = true; return {ok: true, manual: true}; }
        if (cg.plugin === 'missing') return {ok: false, code: 'cg_plugin_missing'};
        if (cg.plugin === 'unverified') return {ok: false, code: 'cg_plugin_select'};
        return {ok: true};
      case 'cg.insert': return msg.text.includes(msg.code) ? {ok: true} : {ok: false, code: 'cg_insert'};
      case 'cg.send': {
        if (cg.sendFails) throw new Error('Could not establish connection. Receiving end does not exist.');
        lastSent = msg.code; authLeft = cg.auth;
        return {ok: true};
      }
      case 'cg.wait': clock += msg.chunkMs || 1000;
        if (cg.rateLimit) return {ok: true, state: 'rate_limit'};
        if (authLeft > 0) { authLeft--; return {ok: true, state: 'auth'}; }
        saveDraft();
        return {ok: true, state: 'done'};
    }
    return {ok: false, code: 'connection'};
  }

  const activated = [], opened = [];
  const settings = {...DEFAULT_SETTINGS, ...(opts.settings || {})};
  const env = {
    state: new StateManager(storage, () => clock),
    settings: async () => settings,
    send: async (tabId, msg) => { calls.push({tabId, ...msg}); return tabId === NL_TAB ? nlHandle(msg) : cgHandle(msg); },
    tabExists: async id => id === NL_TAB || id === CHAT_TAB,
    activate: async id => { activated.push(id); },
    openChat: async (id, url, o = {}) => { opened.push(o); return CHAT_TAB; },
    notify: (t, m) => notes.push(t),
    sleep: async ms => { clock += ms; },
    now: () => clock,
  };
  const mgr = new AutomationManager(env);
  return {env, mgr, activated, opened, calls, notes, nl, cg, storage, map, get chipManual() { return chipManual; }, get openModal() { return openModal; }, get lastSent() { return lastSent; }};
}

export const STANDARD = () => [
  section('anamnese', 'Anamnese', 'ai', 'ap'),
  section('fixo_fontes', 'Fontes fundamentais de informações', 'fixed', 'file'),
  section('habilidades_intelectuais', 'Habilidades intelectuais'),
  section('percepcao', 'Percepção'),
  section('memoria', 'Memória e aprendizagem', 'ai', 'gen'),
  section('hipotese', 'Hipótese diagnóstica', 'hand'),
  section('conclusao', 'Conclusão'),
];
export const start = (t, extra = {}) => t.mgr.start({nlTabId: NL_TAB, nlOrigin: 'http://localhost:9091', mode: 'auto', policy: {existing: 'skip', onError: 'pause', sendImages: false}, ...extra});
