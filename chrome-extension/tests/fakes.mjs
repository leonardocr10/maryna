// Synthetic NeuroLaudos IA and ChatGPT for the flow tests. No real data: section names are the app's fixed titles,
// codes are generated here, nothing is sent anywhere.
import {StateManager} from '../modules/state-manager.js';
import {DEFAULT_SETTINGS} from '../modules/constants.js';
import {AutomationManager} from '../modules/automation-manager.js';
import {Coordinator} from '../modules/lanes.js';

export const NL_TAB = 1, CHAT_TAB = 2;
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let seq = 0;
export function newCode() { let n = 1000003 + (++seq) * 7919, out = ''; for (let i = 0; i < 8; i++) { out += ALPHA[n % 31]; n = Math.floor(n / 31) + i * 13; } return `NL-${out.slice(0, 4)}-${out.slice(4)}`; }

export function section(key, name, kind = 'ai', state = 'pend') { return {key, name, kind, state}; }

/**
 * opts.nl: {sections, tasks: {key: {code,status,mode,expires,needsConfirmation}}, mcp, readOnly, evaluationId, draftOutcome(key): 'received'|'needs_review'|'never'|'error', notEligible: [keys]}
 * opts.cg: {plugin: 'ok'|'missing'|'unverified', authFor: Set(keys) rounds, rateLimit, sendFails, loggedIn, onWait(nl)}
 * opts.evals (batch): {id: {sections, tasks, instruction, readOnly, openFails}}: several synthetic evaluations on one
 *   server. The tab starts on the list (no evaluation open); `nl.openEvaluation` shows one. Tasks live per evaluation,
 *   and the plugin saves a draft by its code on the evaluation the task belongs to, whatever the tab shows.
 */
export function makeEnv(opts = {}) {
  const map = new Map();
  const storage = {get: async k => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async k => { map.delete(k); }};
  let clock = Date.parse('2026-11-08T12:00:00Z');
  const calls = [];
  const notes = [];
  // Virtual time: a wait resolves only when every lane is blocked on its own wait, in time order, so runs that work at
  // the same time see one consistent clock (no lane jumps the clock for the others).
  const timers = [];
  let ticking = false, tseq = 0;
  const tick = () => { ticking = false; if (!timers.length) return; timers.sort((a, b) => a.at - b.at || a.seq - b.seq); const x = timers.shift(); if (x.at > clock) clock = x.at; x.res(); if (timers.length) { ticking = true; setImmediate(tick); } };
  const vsleep = ms => new Promise(res => { timers.push({at: clock + Math.max(0, ms || 0), res, seq: tseq++}); if (!ticking) { ticking = true; setImmediate(tick); } });
  const nl = {evaluationId: 'ev-sint-1', mcp: true, readOnly: false, tasks: {}, notEligible: [], draftOutcome: () => 'received', ...(opts.nl || {})};
  const evals = opts.evals || null;
  if (evals) { nl.evaluationId = null; nl.sections = []; for (const e of Object.values(evals)) e.tasks ||= {}; }
  const saves = [], prepared = [];   // {code, evaluationId, key}: where the server put each draft / prepared each task
  // NeuroLaudos IA tabs: NL_TAB is `nl` itself; a parallel batch duplicates it (openNlTab). Each tab shows one evaluation.
  const tabs = new Map([[NL_TAB, nl]]);
  // ChatGPT tabs, each with its own conversation: the code it sent and the authorization rounds left.
  const chats = new Map(evals ? [] : [[CHAT_TAB, {sent: null, authLeft: 0}]]);
  const show = (id, tab = nl) => { const e = evals[id]; Object.assign(tab, {evaluationId: id, sections: e.sections, tasks: e.tasks, readOnly: !!e.readOnly}); if (tab === nl) openModal = null; };
  const cg = {plugin: 'ok', auth: 0, rateLimit: false, sendFails: false, loggedIn: true, ...(opts.cg || {})};
  let openModal = null, lastSent = null, chipManual = false;

  const view = (key, tab) => { const t = tab.tasks[key]; return t ? {ready: true, mcp: nl.mcp, method: 'mcp', busy: false, code: t.code, mode: t.mode || 'mcp', status: t.status, problem: t.problem || null, expires: t.expires || new Date(clock + 864e5).toISOString(), needsConfirmation: !!t.needsConfirmation, applied: t.status === 'draft_received' && !t.needsConfirmation} : {ready: true, mcp: nl.mcp, method: 'mcp', busy: false, code: null, mode: null, status: 'none', expires: null, needsConfirmation: false, applied: false}; };

  async function nlHandle(msg, tab) {
    if (msg.cmd === 'nl.openEvaluation') {
      const e = evals?.[msg.evaluationId];
      if (!e || e.openFails) return {ok: false, code: 'nl_eval_open'};
      if (tab.evaluationId !== msg.evaluationId) show(msg.evaluationId, tab);
      return {ok: true};
    }
    // The page answers only for the evaluation it shows (content script checkEval)
    if (msg.cmd !== 'nl.scan' && msg.evaluationId && msg.evaluationId !== tab.evaluationId) return {ok: false, code: 'nl_changed'};
    switch (msg.cmd) {
      case 'nl.scan': return tab.evaluationId ? {ok: true, evaluationId: tab.evaluationId, readOnly: tab.readOnly, sections: tab.sections} : {ok: false, code: 'nl_not_review'};
      case 'nl.getInstruction': { const e = evals?.[tab.evaluationId]; return {ok: true, text: e?.instruction ?? 'Integrar os resultados; relatar no final que apresenta características ', editable: true}; }
      case 'nl.openSection': return {ok: true};
      case 'nl.openModal': if (nl.notEligible.includes(msg.key)) return {ok: true, notEligible: true, reason: 'Texto fixo do arquivo'}; if (tab === nl) openModal = msg.key; return {ok: true, modal: view(msg.key, tab)};
      case 'nl.modalInfo': return {ok: true, modal: view(msg.key, tab)};
      case 'nl.prepare': { const code = newCode(); tab.tasks[msg.key] = {code, status: 'pending'}; prepared.push({code, evaluationId: tab.evaluationId, key: msg.key}); return {ok: true, modal: view(msg.key, tab)}; }
      case 'nl.command': { const t = tab.tasks[msg.key]; return {ok: true, command: `@NeuroLaudos IA Utilize o plugin NeuroLaudos IA para buscar a tarefa pendente da seção "${msg.key}" identificada pelo código ${t.code}. Ao concluir, salve como rascunho.`, images: (nl.images || {})[msg.key] || []}; }
      case 'nl.waitStatus': { await vsleep(msg.chunkMs || 1000); return {ok: true, modal: view(msg.key, tab)}; }
      case 'nl.closeModal': if (tab === nl) openModal = null; return {ok: true};
    }
    return {ok: false, code: 'connection'};
  }

  /** The plugin saves the draft on the server once the answer is done (the real success criterion). */
  function saveDraft(code) {
    // Server side: the task is found by its code alone (never by what a tab shows).
    const pools = evals ? Object.entries(evals).map(([id, e]) => [id, e.tasks]) : [[nl.evaluationId, nl.tasks]];
    for (const [evId, tasks] of pools) {
      const key = Object.keys(tasks).find(k => tasks[k].code === code);
      if (!key || tasks[key].status !== 'pending') continue;
      const out = nl.draftOutcome(key, evId);
      if (out === 'received') tasks[key].status = 'draft_received';
      if (out === 'needs_review') Object.assign(tasks[key], {status: 'draft_received', needsConfirmation: true});
      if (out === 'error') tasks[key].status = 'error';
      if (out === 'problem') Object.assign(tasks[key], {status: 'error', problem: 'dados_divergentes'});
      if (out === 'received' || out === 'needs_review') saves.push({code, evaluationId: evId, key, chatTab: chatOf.get(code)});
    }
  }
  const chatOf = new Map();   // code -> ChatGPT tab that sent it (last)
  async function cgHandle(msg, tabId) {
    const c = chats.get(tabId);
    switch (msg.cmd) {
      case 'cg.ping': return {ok: true, ready: cg.loggedIn, loggedIn: cg.loggedIn, composer: true, hasMessages: false, path: cg.projectMissing ? '/' : new URL(c?.url || 'https://chatgpt.com/').pathname};
      case 'cg.selectPlugin':
        if (msg.trustManual) { chipManual = true; return {ok: true, manual: true}; }
        if (cg.plugin === 'missing') return {ok: false, code: 'cg_plugin_missing'};
        if (cg.plugin === 'unverified') return {ok: false, code: 'cg_plugin_select'};
        return {ok: true};
      case 'cg.insert': if (!msg.text.includes(msg.code)) return {ok: false, code: 'cg_insert'}; return msg.images?.length && cg.imagesFail ? {ok: false, code: 'cg_images'} : {ok: true};
      case 'cg.send': {
        if (cg.sendFails) throw new Error('Could not establish connection. Receiving end does not exist.');
        lastSent = msg.code; c.sent = msg.code; c.authLeft = cg.auth; chatOf.set(msg.code, tabId);
        return {ok: true};
      }
      case 'cg.wait': await vsleep(msg.chunkMs || 1000);
        cg.onWait?.(nl, show, {tabId, chat: c, tabs});
        if (typeof cg.rateLimit === 'function' ? cg.rateLimit(tabId, c) : cg.rateLimit) return {ok: true, state: 'rate_limit'};
        if (c.authLeft > 0) { c.authLeft--; return {ok: true, state: 'auth'}; }
        saveDraft(c.sent);
        return {ok: true, state: 'done'};
    }
    return {ok: false, code: 'connection'};
  }

  const activated = [], opened = [];
  let nextTab = 100;
  const settings = {...DEFAULT_SETTINGS, ...(opts.settings || {})};
  const env = {
    state: new StateManager(storage, () => clock),
    settings: async () => settings,
    send: async (tabId, msg) => {
      const tab = tabs.get(tabId);
      const c = {tabId, ...msg, shown: tab ? tab.evaluationId : undefined, at: clock};
      calls.push(c);
      const r = await (tab ? nlHandle(msg, tab) : cgHandle(msg, tabId));
      c.refused = r?.code === 'nl_changed';
      return r;
    },
    tabExists: async id => tabs.has(id) || chats.has(id),
    activate: async id => { activated.push(id); },
    openChat: async (id, url, o = {}) => {
      opened.push({...o, tabId: id, url});
      if (id && chats.has(id)) { Object.assign(chats.get(id), {sent: null, url}); return id; }
      if (!evals) { chats.get(CHAT_TAB).url = url; return CHAT_TAB; }
      const nid = nextTab++; chats.set(nid, {sent: null, authLeft: 0, url}); return nid;
    },
    /** Duplicate of a NeuroLaudos IA tab (shows the same evaluation as the source, like a duplicated tab). */
    openNlTab: async from => { const src = tabs.get(from) || nl; const nid = nextTab++; tabs.set(nid, {evaluationId: src.evaluationId, sections: src.sections, tasks: src.tasks, readOnly: src.readOnly}); return nid; },
    notify: (t, m) => notes.push(t),
    sleep: vsleep,
    now: () => clock,
  };
  const mgr = new AutomationManager(env);
  const coord = new Coordinator(env);
  return {env, mgr, coord, activated, opened, calls, notes, nl, cg, storage, map, evals, saves, prepared, tabs, chats, get clock() { return clock; }, get chipManual() { return chipManual; }, get openModal() { return openModal; }, get lastSent() { return lastSent; }};
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
