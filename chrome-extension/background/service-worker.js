// Service worker: owns the run (AutomationManager), the tabs and the messages between the pages.
import {STORAGE_KEY, SETTINGS_KEY, DEFAULT_SETTINGS, DEFAULT_NL_ORIGINS, RUN, CHATGPT_URL, MODES, EVAL_ID_RE} from '../modules/constants.js';
import {StateManager, recoverAfterRestart, isActive} from '../modules/state-manager.js';
import {Coordinator, recoverLanes} from '../modules/lanes.js';
import {describe} from '../modules/error-handler.js';
import {progress} from '../modules/task-queue.js';

const NL_SCRIPTS = ['content/selectors.js', 'content/dom-observer.js', 'content/neurolaudos.js'];
const NL_CSS = ['content/neurolaudos.css'];

// ---------- storage ----------
const storage = {
  get: async k => (await chrome.storage.local.get(k))[k],
  set: (k, v) => chrome.storage.local.set({[k]: v}),
  remove: k => chrome.storage.local.remove(k),
};
const state = new StateManager(storage);
async function settings() { return {...DEFAULT_SETTINGS, ...((await storage.get(SETTINGS_KEY)) || {})}; }

// ---------- tabs ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isConnErr = e => /Could not establish connection|Receiving end does not exist|message port closed|back\/forward cache/i.test(String(e?.message || e));

async function tabExists(id) { if (!id) return false; try { await chrome.tabs.get(id); return true; } catch { return false; } }

/** Message to a content script; retries while the page (re)loads, up to `waitMs`. */
async function send(tabId, msg, waitMs = 20000) {
  const end = Date.now() + waitMs;
  let lastErr;
  while (Date.now() < end) {
    if (!(await tabExists(tabId))) throw new Error('No tab with id ' + tabId);
    try {
      const left = Math.max(1000, end - Date.now());
      return await Promise.race([
        chrome.tabs.sendMessage(tabId, msg, {frameId: 0}),
        sleep(left).then(() => { throw new Error('timeout'); }),
      ]);
    } catch (e) {
      lastErr = e;
      if (String(e?.message) === 'timeout') break;
      if (!isConnErr(e)) throw e;
      await sleep(500);
    }
  }
  throw lastErr || new Error('timeout');
}

async function activate(tabId) {
  try { const t = await chrome.tabs.update(tabId, {active: true}); await chrome.windows.update(t.windowId, {focused: true}); } catch {}
}

/** Waits for a navigation of `tabId` to finish loading. */
function waitLoaded(tabId, ms = 45000) {
  return new Promise(resolve => {
    let seenLoading = false;
    const done = v => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(v); };
    const on = (id, info) => { if (id !== tabId) return; if (info.status === 'loading') seenLoading = true; if (info.status === 'complete' && seenLoading) done(true); };
    const timer = setTimeout(() => done(false), ms);
    chrome.tabs.onUpdated.addListener(on);
    setTimeout(() => { if (!seenLoading) chrome.tabs.get(tabId).then(t => { if (t.status === 'complete') { seenLoading = true; } }).catch(() => done(false)); }, 4000);
  });
}

/** The dedicated ChatGPT tab, on a new conversation. In the background it opens next to NeuroLaudos IA without taking the focus. */
async function openChat(tabId, url = CHATGPT_URL, {background = false, nearTabId = null} = {}) {
  if (tabId) {
    const loaded = waitLoaded(tabId);
    await chrome.tabs.update(tabId, background ? {url, autoDiscardable: false} : {url, active: true});
    await loaded;
    return tabId;
  }
  let place = {};
  if (nearTabId) { try { const n = await chrome.tabs.get(nearTabId); place = {windowId: n.windowId, index: n.index + 1, openerTabId: nearTabId}; } catch {} }
  const t = await chrome.tabs.create({url, active: !background, ...place});
  if (background) chrome.tabs.update(t.id, {autoDiscardable: false}).catch(() => {});   // memory saver must not freeze it mid-answer
  await waitLoaded(t.id);
  return t.id;
}

function notify(title, message) {
  try { chrome.notifications.create('nlauto-' + Date.now(), {type: 'basic', iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'), title, message, priority: 2}); } catch {}
}

/**
 * Parallel batch: a NeuroLaudos IA tab for one more lane. A duplicate of the batch's tab keeps its sign-in (the app keeps
 * the session per tab); it opens in the background, next to it, and the person's tab stays in front.
 */
async function openNlTab(fromTabId) {
  if (!fromTabId || !(await tabExists(fromTabId))) return null;
  let front = null;
  try { [front] = await chrome.tabs.query({active: true, lastFocusedWindow: true}); } catch {}
  const t = await chrome.tabs.duplicate(fromTabId);
  if (!t?.id) return null;
  chrome.tabs.update(t.id, {autoDiscardable: false}).catch(() => {});   // memory saver must not freeze it mid-run
  if (front?.id) chrome.tabs.update(front.id, {active: true}).catch(() => {});
  await waitLoaded(t.id);
  try { await send(t.id, {cmd: 'nl.scan'}, 20000); } catch {}   // content script ready (answer ignored)
  return t.id;
}

const manager = new Coordinator({state, settings, send, tabExists, activate, openChat, openNlTab, notify, sleep, now: () => Date.now()});

// ---------- NeuroLaudos IA addresses added by the person (https://...) ----------
async function registerOrigins() {
  const {extraOrigins = []} = await settings();
  const granted = [];
  for (const o of extraOrigins) if (await chrome.permissions.contains({origins: [o + '/*']})) granted.push(o);
  try { await chrome.scripting.unregisterContentScripts({ids: ['nl-extra']}); } catch {}
  if (granted.length) await chrome.scripting.registerContentScripts([{id: 'nl-extra', matches: granted.map(o => o + '/*'), js: NL_SCRIPTS, css: NL_CSS, runAt: 'document_idle'}]);
  return granted;
}

/** After install or update: the content script goes into NeuroLaudos IA tabs that are already open. */
async function injectOpenTabs() {
  const {extraOrigins = []} = await settings();
  const patterns = [...DEFAULT_NL_ORIGINS, ...extraOrigins].map(o => o + '/*');
  let tabs = [];
  try { tabs = await chrome.tabs.query({url: patterns}); } catch {}
  for (const t of tabs) {
    try { await chrome.scripting.insertCSS({target: {tabId: t.id}, files: NL_CSS}); await chrome.scripting.executeScript({target: {tabId: t.id}, files: NL_SCRIPTS}); } catch {}
  }
}

/** A NeuroLaudos IA address the person allowed (popup "Ativar neste site" or the address list): saved, registered and
 *  the content script goes into its open tabs right away (no reinstall, a reload is enough). */
async function enableOrigin(origin) {
  if (!/^https?:\/\/[^/]+$/.test(origin || '') || origin === 'https://chatgpt.com' || DEFAULT_NL_ORIGINS.includes(origin)) return false;
  if (!(await chrome.permissions.contains({origins: [origin + '/*']}))) return false;
  const cfg = await settings();
  if (!(cfg.extraOrigins || []).includes(origin)) await storage.set(SETTINGS_KEY, {...((await storage.get(SETTINGS_KEY)) || {}), extraOrigins: [...(cfg.extraOrigins || []), origin]});
  await registerOrigins();
  let tabs = [];
  try { tabs = await chrome.tabs.query({url: origin + '/*'}); } catch {}
  for (const t of tabs) { try { await chrome.scripting.insertCSS({target: {tabId: t.id}, files: NL_CSS}); await chrome.scripting.executeScript({target: {tabId: t.id}, files: NL_SCRIPTS}); } catch {} }
  return true;
}
// The popup can close while Chrome shows the permission prompt: the grant is handled here, whoever asked for it.
chrome.permissions.onAdded.addListener(async p => { for (const o of p.origins || []) { try { await enableOrigin(new URL(o.replace('/*', '/')).origin); } catch {} } });

// ---------- badge ----------
async function badge(s) {
  try {
    if (!s || !isActive(s)) { await chrome.action.setBadgeText({text: s?.status === RUN.done ? '✓' : ''}); return; }
    const p = progress(s.items);
    const ended = s.batch ? s.batch.list.filter(e => !['pending', 'running'].includes(e.status)).length : 0;
    if (s.lanes) { await chrome.action.setBadgeBackgroundColor({color: s.status === RUN.paused ? '#b7791f' : '#1f7a55'}); await chrome.action.setBadgeText({text: `${ended}/${s.batch.list.length}`}); return; }
    await chrome.action.setBadgeBackgroundColor({color: s.status === RUN.paused ? '#b7791f' : '#1f7a55'});
    await chrome.action.setBadgeText({text: s.status === RUN.paused ? '||' : s.batch ? `${Math.max(1, s.batch.index + 1)}/${s.batch.list.length}` : `${p.done}/${p.total}`});
  } catch {}
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[STORAGE_KEY]) badge(ch[STORAGE_KEY].newValue); });

// ---------- lifecycle ----------
chrome.runtime.onInstalled.addListener(async () => { await registerOrigins(); await injectOpenTabs(); badge(await state.load()); });
chrome.runtime.onStartup.addListener(async () => {
  await registerOrigins();
  // Browser restarted: a running run is paused and nothing already sent is sent again without checking.
  const s = await state.load();
  if (s && s.status === RUN.running) await state.update(cur => cur.lanes ? recoverLanes(cur) : recoverAfterRestart(cur));
  badge(await state.load());
});
// Worker restarted by Chrome while running (not a browser restart): continue from the saved step.
chrome.alarms.create('nlauto-keepalive', {periodInMinutes: 0.5});
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== 'nlauto-keepalive') return;
  const s = await state.load();
  if (s?.status === RUN.running) manager.kick();
});
// Content scripts keep a port open while a run is active (keeps the worker awake during long waits).
chrome.runtime.onConnect.addListener(port => { if (port.name === 'nlauto-keepalive') port.onMessage.addListener(() => {}); });

chrome.tabs.onRemoved.addListener(id => { manager.tabClosed(id); });

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(reply, err => reply({ok: false, error: describe(err)}));
  return true;
});

const CHAT_ALLOWED = ['hello', 'run.pause', 'run.resume', 'run.focus'];
/** Who may ask what: NeuroLaudos IA pages (and the panel inside them), the popup, and the ChatGPT status bar (limited). */
async function allowed(msg, sender) {
  if (sender.id !== chrome.runtime.id) return false;
  const ext = chrome.runtime.getURL('');
  const tabOrigin = (() => { try { return new URL(sender.tab?.url || '').origin; } catch { return null; } })();
  const nlOrigins = [...DEFAULT_NL_ORIGINS, ...((await settings()).extraOrigins || [])];
  if (sender.url?.startsWith(ext + 'popup/')) return true;
  if (sender.url?.startsWith(ext + 'ui/panel.html')) return !!tabOrigin && nlOrigins.includes(tabOrigin) && (msg.tabId == null || msg.tabId === sender.tab.id);
  if (tabOrigin === 'https://chatgpt.com') return CHAT_ALLOWED.includes(msg?.type);
  return !!tabOrigin && nlOrigins.includes(tabOrigin) && msg?.tabId == null;
}

async function handle(msg, sender) {
  if (!(await allowed(msg, sender))) return {ok: false, error: {message: 'Origem não autorizada.'}};
  switch (msg?.type) {
    case 'hello': return {ok: true, tabId: sender.tab?.id ?? null};
    case 'run.get': return {ok: true, run: await state.load(), settings: await settings()};
    case 'scan': {
      const tabId = msg.tabId ?? sender.tab?.id;
      return await send(tabId, {cmd: 'nl.scan'}, 15000);
    }
    case 'instruction.get': case 'instruction.set': {
      const tabId = msg.tabId ?? sender.tab?.id;
      return await send(tabId, msg.type === 'instruction.get' ? {cmd: 'nl.getInstruction', key: msg.key, evaluationId: msg.evaluationId} : {cmd: 'nl.setInstruction', key: msg.key, text: String(msg.text || '').slice(0, 6000), evaluationId: msg.evaluationId}, 20000);
    }
    case 'run.start': {
      const tabId = msg.tabId ?? sender.tab?.id;
      const origin = msg.origin || (sender.tab?.url ? new URL(sender.tab.url).origin : null);
      const cfg = await settings();
      const policy = {existing: msg.existing || cfg.existing, onError: msg.onError || cfg.onError, sendImages: msg.sendImages ?? cfg.sendImages, sameChat: !!(msg.sameChat ?? cfg.sameChat), background: !!(msg.background ?? cfg.chatBackground)};
      return {ok: true, run: await manager.start({nlTabId: tabId, nlOrigin: origin, mode: MODES[msg.mode] ? msg.mode : MODES[cfg.defaultMode] ? cfg.defaultMode : 'auto', policy, selected: msg.selected})};
    }
    case 'batch.start': {
      // Several evaluations from the list, one after another in this tab (ids only; never names).
      const tabId = msg.tabId ?? sender.tab?.id;
      const origin = sender.tab?.url ? new URL(sender.tab.url).origin : null;
      const cfg = await settings();
      const policy = {existing: msg.existing === 'skip' ? 'skip' : 'draft', onError: msg.onError === 'next' ? 'next' : 'pause', sendImages: !!(msg.sendImages ?? cfg.sendImages), sameChat: false, background: !!(msg.background ?? cfg.chatBackground), includeDemand: !!msg.includeDemand, only: Array.isArray(msg.only) ? msg.only.slice(0, 80).map(x => String(x).slice(0, 120)) : null};
      const parallel = Math.max(1, Math.min(10, Math.floor(+(msg.parallel ?? cfg.batchParallel)) || 1));
      // Each evaluation's own Conclusão instruction (edited on the batch screen) is saved in that evaluation only,
      // opened and confirmed one by one, before anything starts.
      for (const it of Array.isArray(msg.instructions) ? msg.instructions.slice(0, 10) : []) {
        const id = String(it?.id || ''), text = String(it?.text || '').slice(0, 6000);
        const fail = why => ({ok: false, error: {message: `A instrução da Conclusão não foi salva (${why}).`, hint: 'Nada foi iniciado. Confira a conexão com o NeuroLaudos IA e tente de novo.'}});
        if (!EVAL_ID_RE.test(id) || !(msg.ids || []).includes(id)) return fail('avaliação inválida');
        const o = await send(tabId, {cmd: 'nl.openEvaluation', evaluationId: id}, 35000).catch(() => null);
        if (!o?.ok) return fail('a avaliação não abriu');
        const w = await send(tabId, {cmd: 'nl.setInstruction', key: 'conclusao', text, evaluationId: id}, 20000).catch(() => null);
        if (!w?.ok) return fail('o NeuroLaudos IA não confirmou');
      }
      return {ok: true, run: await manager.startBatch({nlTabId: tabId, nlOrigin: origin, mode: MODES[msg.mode] ? msg.mode : 'auto', policy, ids: Array.isArray(msg.ids) ? msg.ids : [], parallel})};
    }
    case 'batch.peek': {
      // Reads each evaluation of the batch, one at a time in this tab: the section names of the first one (the choice
      // then applies to all) and, per evaluation, its own Conclusão instruction. Every answer is tied to its id.
      const tabId = msg.tabId ?? sender.tab?.id;
      const ids = Array.isArray(msg.ids) ? msg.ids.map(String).slice(0, 10) : [];
      if (!ids.length || !ids.every(x => EVAL_ID_RE.test(x))) return {ok: false};
      const out = {ok: true, sections: null, concl: {}};
      for (const id of ids) {
        try {
          const o = await send(tabId, {cmd: 'nl.openEvaluation', evaluationId: id}, 35000);
          const r = o?.ok ? await send(tabId, {cmd: 'nl.scan'}, 20000) : null;
          if (!r?.ok || r.evaluationId !== id) { out.concl[id] = {has: false}; if (!out.sections && id === ids[0]) out.sections = null; continue; }
          if (!out.sections) { const seen = new Set(); out.sections = (r.sections || []).filter(x => x.kind === 'ai' && x.name && !seen.has(x.name) && seen.add(x.name)).map(x => ({name: x.name})); }
          const c = (r.sections || []).find(x => x.key === 'conclusao' && x.kind === 'ai' && x.state !== 'ap' && x.state !== 'file');
          const g = c && !r.readOnly ? await send(tabId, {cmd: 'nl.getInstruction', key: 'conclusao', evaluationId: id}, 20000).catch(() => null) : null;
          out.concl[id] = g?.ok ? {has: true, text: g.text, editable: !!g.editable} : {has: false};
        } catch { out.concl[id] = {has: false}; }
      }
      if (!out.sections) return {ok: false};
      return out;
    }
    case 'run.pause': await manager.pause(); return {ok: true, run: await state.load()};
    case 'review.get': {
      const tabId = msg.tabId ?? sender.tab?.id;
      return await send(tabId, {cmd: 'nl.reviewGet', key: msg.key}, 20000);
    }
    case 'review.act': {
      const tabId = msg.tabId ?? sender.tab?.id;
      const r = await send(tabId, {cmd: 'nl.reviewAct', key: msg.key, taskId: msg.taskId, action: msg.action}, 25000);
      if (r?.ok) await manager.reviewed(msg.key, msg.action, tabId);
      return r;
    }
    case 'run.redo': return {ok: true, run: await manager.redoMissing(Number.isInteger(msg.index) ? msg.index : null)};
    case 'run.continue': return {ok: true, run: await manager.continueRun(msg.tabId ?? null)};
    case 'run.resume': return {ok: true, run: await manager.resume(msg.action || 'continue', msg.tabId ?? null, Number.isInteger(msg.lane) ? msg.lane : null)};
    case 'run.stop': await manager.stop(); return {ok: true, run: await state.load()};
    case 'run.clear': {
      const s = await state.load();
      if (isActive(s) && s.status === RUN.running) return {ok: false, error: {message: 'Pare a execução antes de limpar.'}};
      await state.clear(); return {ok: true};
    }
    case 'run.focus': {
      const s = await state.load();
      const L = s?.lanes && Number.isInteger(msg.lane) ? s.lanes[msg.lane] : s;
      const id = msg.which === 'chat' ? L?.chatTabId : L?.nlTabId;
      if (id) await activate(id);
      return {ok: true};
    }
    case 'settings.get': return {ok: true, settings: await settings()};
    case 'origin.enable': return {ok: await enableOrigin(msg.origin)};
    case 'settings.set': {
      // Only what was saved before plus what changed: defaults stay defaults (a new default reaches old installs).
      await storage.set(SETTINGS_KEY, {...((await storage.get(SETTINGS_KEY)) || {}), ...(msg.settings || {})});
      const next = await settings();
      const granted = await registerOrigins();
      return {ok: true, settings: next, granted};
    }
    default: return {ok: false, error: {message: 'Mensagem desconhecida.'}};
  }
}
