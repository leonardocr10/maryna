// Content script of ChatGPT (dedicated tab opened by the extension). Uses only the visible interface: the message
// field, the plugin picker, the send button. No private endpoints, no cookies, no tokens.
// Never clicks a confirmation of a tool call: it only detects it and tells the worker to wait for the person.
// Reads the conversation only to know its state (answering, finished, error); no text leaves this page.
(() => {
  const NLX = globalThis.NLX;
  if (!NLX || NLX.cgLoaded) return;
  NLX.cgLoaded = true;
  const {CG, first, visible, norm} = NLX.SEL;
  const {waitFor, waitQuiet, click, insertText, clearEditor, placeCaretAtEnd} = NLX.DOM;
  const LIMITS = {pluginMenu: 8000, pluginChip: 6000, sendReady: 15000, sendAck: 20000};
  const fail = (code, detail) => ({ok: false, code, detail: detail || null});

  const composer = () => first(CG.composer);
  const loginShown = () => !!first(CG.login);
  const allMsgs = () => [...document.querySelectorAll('[data-message-author-role]')];
  const userMsgs = () => document.querySelectorAll(CG.userMsg).length;
  const lastRole = () => allMsgs().at(-1)?.getAttribute('data-message-author-role') || null;
  const streaming = () => !!first(CG.stop);
  const sendBtn = () => first(CG.send);
  const container = c => c.closest('form') || c.parentElement?.parentElement?.parentElement || document.body;

  // ---------- plugin ----------
  /** Visible options of the picker that matches the plugin name. */
  function pickerOptions() {
    const seen = new Set(), out = [];
    for (const s of CG.option) for (const el of document.querySelectorAll(s)) if (!seen.has(el) && visible(el)) { seen.add(el); out.push(el); }
    return out;
  }
  function pluginOption(name) {
    const want = norm(name), short = want.split(' ')[0];
    const opts = pickerOptions().filter(o => norm(o.textContent).includes(short));
    return opts.find(o => norm(o.textContent) === want) || opts.find(o => norm(o.textContent).startsWith(want)) || (opts.length === 1 ? opts[0] : null);
  }
  /** The plugin counts as selected only when the interface shows it as a chip (not plain text typed in the field). */
  function chipPresent(name) {
    const c = composer(); if (!c) return false;
    const short = norm(name).split(' ')[0];
    const typed = norm(c.innerText || c.value || '');
    if (typed.includes('@' + short)) return false;                      // still literal text
    const area = container(c);
    for (const el of area.querySelectorAll('*')) {
      if (el.childElementCount > 3 || !visible(el)) continue;
      const t = norm(el.textContent);
      if (!t.includes(short) || t.length > 60) continue;
      if (!c.contains(el)) return true;                                 // chip shown next to the field
      if (el.closest('[contenteditable="false"]') || el.getAttribute('data-type') || el.getAttribute('data-id')) return true;   // pill node inside the editor
    }
    return false;
  }

  async function selectPlugin(name, trustManual) {
    const c = composer();
    if (!c) return fail(loginShown() ? 'cg_not_logged' : 'cg_composer');
    if (chipPresent(name)) return {ok: true, already: true};
    if (trustManual) return {ok: true, manual: true};
    clearEditor(c);
    insertText(c, '@');
    const menu = await waitFor(() => pickerOptions().length ? true : null, {timeout: LIMITS.pluginMenu});
    insertText(c, name.split(' ')[0]);
    const opt = await waitFor(() => pluginOption(name), {timeout: LIMITS.pluginMenu});
    if (!opt) { clearEditor(c); return fail(menu ? 'cg_plugin_missing' : 'cg_plugin_select', menu ? 'opção não encontrada no seletor' : 'o seletor @ não abriu'); }
    click(opt);
    const ok = await waitFor(() => chipPresent(name), {timeout: LIMITS.pluginChip});
    if (!ok) { clearEditor(c); return fail('cg_plugin_select', 'seleção não confirmada na interface'); }
    return {ok: true};
  }

  // ---------- message ----------
  async function insert(text, code) {
    const c = composer();
    if (!c) return fail('cg_composer');
    placeCaretAtEnd(c);
    const before = norm(c.innerText || c.value || '');
    insertText(c, (before ? ' ' : '') + text);
    const ok = await waitFor(() => (c.innerText || c.value || '').includes(code), {timeout: 4000});
    return ok ? {ok: true} : fail('cg_insert');
  }

  async function sendMessage(code) {
    const btn = await waitFor(() => { const b = sendBtn(); return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null; }, {timeout: LIMITS.sendReady});
    if (!btn) return fail('cg_send', 'botão enviar indisponível');
    const n = userMsgs();
    click(btn);
    const ok = await waitFor(() => {
      const u = document.querySelectorAll(CG.userMsg);
      if (u.length > n && (u[u.length - 1].textContent || '').includes(code)) return true;
      return streaming() && u.length > n ? true : null;
    }, {timeout: LIMITS.sendAck});
    return ok ? {ok: true} : fail('cg_send');
  }

  // ---------- state of the answer ----------
  /** Interface text of the last turn and alerts, without the model's written text (avoids false alarms). */
  function uiText() {
    const parts = [];
    const last = allMsgs().at(-1)?.closest('article, [data-testid^="conversation-turn"]') || allMsgs().at(-1);
    if (last) { const cl = last.cloneNode(true); cl.querySelectorAll('.markdown, .prose, [data-message-author-role="user"]').forEach(n => n.remove()); parts.push(cl.textContent); }
    document.querySelectorAll('[role="alert"], [data-testid*="toast"], [class*="toast"], [role="status"]').forEach(n => visible(n) && parts.push(n.textContent));
    const c = composer(); if (c) { const f = container(c); const cl = f.cloneNode(true); cl.querySelectorAll('[contenteditable], textarea').forEach(n => n.remove()); parts.push(cl.textContent); }
    return norm(parts.join(' \n '));
  }
  function authButtons() {
    const last = allMsgs().at(-1)?.closest('article, [data-testid^="conversation-turn"]');
    const scopes = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]'), last].filter(Boolean);
    for (const s of scopes) for (const b of s.querySelectorAll('button')) {
      if (b.closest('.markdown, .prose') || !visible(b)) continue;
      if (CG.authText.test(norm(b.textContent))) return true;
    }
    return false;
  }
  function snapshot() {
    if (loginShown() && !composer()) return 'logged_out';
    const ui = uiText();
    if (CG.rateLimit.test(ui)) return 'rate_limit';
    if (CG.errorText.test(ui)) return 'error';
    if (authButtons()) return 'auth';
    if (streaming()) return 'streaming';
    return lastRole() === 'assistant' ? 'maybe_done' : 'waiting';
  }

  /** Waits up to chunkMs. Returns done | auth | streaming | waiting | rate_limit | error. */
  async function waitAnswer(chunkMs) {
    const end = Date.now() + chunkMs;
    for (;;) {
      const st = await waitFor(() => { const s = snapshot(); return ['rate_limit', 'error', 'auth', 'maybe_done', 'logged_out'].includes(s) ? s : null; }, {timeout: Math.max(500, end - Date.now()), interval: 1000});
      if (!st) return {ok: true, state: streaming() ? 'streaming' : 'waiting'};
      if (st === 'logged_out') return fail('cg_not_logged');
      if (st === 'rate_limit' || st === 'error') return {ok: true, state: st, detail: st};
      if (st === 'auth') {
        // The person decides in ChatGPT. Wait here until it disappears or the chunk ends (no busy loop).
        const gone = await waitFor(() => !authButtons(), {timeout: Math.max(500, end - Date.now()), interval: 1000});
        if (!gone) return {ok: true, state: 'auth'};
        continue;
      }
      // Finished only when nothing changes for a while and no stop button came back.
      await waitQuiet({quietMs: 2500, timeout: Math.max(3000, Math.min(15000, end - Date.now()))});
      const again = snapshot();
      if (again === 'maybe_done') return {ok: true, state: 'done'};
      if (Date.now() >= end) return {ok: true, state: again === 'auth' ? 'auth' : 'streaming'};
    }
  }

  // ---------- simulation ----------
  async function probe(name) {
    const checks = [];
    const add = (n, ok, detail) => checks.push({name: n, ok: !!ok, detail: detail || null});
    add('ChatGPT: sessão iniciada', !loginShown());
    const c = composer();
    add('ChatGPT: campo de mensagem', c);
    add('ChatGPT: botão enviar ou de voz visível', sendBtn() || document.querySelector('form button'), 'conferido sem clicar');
    if (!c) return {ok: true, checks};
    clearEditor(c);
    insertText(c, '@');
    const menu = await waitFor(() => pickerOptions().length ? true : null, {timeout: LIMITS.pluginMenu});
    add('ChatGPT: seletor @ abre', menu);
    insertText(c, name.split(' ')[0]);
    const opt = await waitFor(() => pluginOption(name), {timeout: LIMITS.pluginMenu});
    add(`ChatGPT: opção ${name} no seletor`, opt, opt ? null : 'conecte o plugin no ChatGPT');
    if (opt) { click(opt); add(`ChatGPT: ${name} selecionado (chip)`, await waitFor(() => chipPresent(name), {timeout: LIMITS.pluginChip})); }
    clearEditor(c);   // nothing is sent in the simulation
    return {ok: true, checks};
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg?.cmd?.startsWith('cg.')) return false;
    (async () => {
      switch (msg.cmd) {
        case 'cg.ping': { const c = composer(); return {ok: true, ready: !!c && !loginShown(), loggedIn: !loginShown(), composer: !!c, hasMessages: allMsgs().length > 0}; }
        case 'cg.selectPlugin': return selectPlugin(msg.name, msg.trustManual);
        case 'cg.insert': return insert(msg.text, msg.code);
        case 'cg.send': return sendMessage(msg.code);
        case 'cg.wait': return waitAnswer(Math.min(Math.max(msg.chunkMs || 30000, 1000), 60000));
        case 'cg.probe': return probe(msg.name);
        default: return fail('connection', 'comando desconhecido');
      }
    })().then(reply, e => reply(fail('connection', String(e?.message || e))));
    return true;
  });

  // ---------- small status bar in the dedicated tab ----------
  const RUN_KEY = 'nlauto.run';
  let tabId = null, bar = null;
  const LABEL = {pending: 'Pendente', preparing: 'Preparando tarefa', waiting_chatgpt: 'Aguardando ChatGPT', processing: 'Em processamento', waiting_auth: 'Aguardando sua autorização', confirming: 'Conferindo o rascunho', received: 'Rascunho recebido', needs_review: 'Revisão necessária', error: 'Erro'};
  function paint(run) {
    const mine = run && run.chatTabId === tabId && (run.status === 'running' || run.status === 'paused');
    NLX.DOM.keepAlive(!!mine && run.status === 'running');
    if (!mine) { bar?.remove(); bar = null; return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'nlx-cg-bar';
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:10px;z-index:2147483000;display:flex;gap:8px;align-items:center;padding:6px 10px;border-radius:999px;background:#0f6f5e;color:#fff;font:600 12.5px system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.2)';
      bar.innerHTML = '<span class="t"></span><button type="button" data-a="pause" style="border:0;border-radius:999px;padding:3px 10px;cursor:pointer;font:inherit">Pausar</button><button type="button" data-a="nl" style="border:0;border-radius:999px;padding:3px 10px;cursor:pointer;font:inherit">Ver painel</button>';
      bar.addEventListener('click', e => {
        const a = e.target?.getAttribute?.('data-a');
        if (a === 'pause') chrome.runtime.sendMessage({type: bar.dataset.paused === '1' ? 'run.resume' : 'run.pause'});
        if (a === 'nl') chrome.runtime.sendMessage({type: 'run.focus', which: 'nl'});
      });
      document.documentElement.appendChild(bar);
    }
    const it = run.items[run.current];
    bar.dataset.paused = run.status === 'paused' ? '1' : '0';
    bar.querySelector('.t').textContent = `NeuroLaudos IA · ${it ? it.name + ' — ' + (LABEL[it.status] || it.status) : 'Modo automático'}${run.status === 'paused' ? ' (pausado)' : ''}`;
    bar.querySelector('[data-a="pause"]').textContent = run.status === 'paused' ? 'Continuar' : 'Pausar';
  }
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[RUN_KEY]) paint(ch[RUN_KEY].newValue); });
  (async () => {
    try { tabId = (await chrome.runtime.sendMessage({type: 'hello'}))?.tabId ?? null; } catch {}
    try { paint((await chrome.storage.local.get(RUN_KEY))[RUN_KEY]); } catch {}
  })();
})();
