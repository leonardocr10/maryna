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

  const textOf = c => c.innerText ?? c.value ?? '';
  /** Pastes like Ctrl+V (the editor's own paste handling); falls back to the browser's insert command. */
  async function pasteText(c, text) {
    placeCaretAtEnd(c);
    const before = textOf(c);
    try {
      const dt = new DataTransfer(); dt.setData('text/plain', text);
      c.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
    } catch {}
    const want = norm(text).slice(-12);
    if (await waitFor(() => textOf(c) !== before && norm(textOf(c)).includes(want), {timeout: 800})) return true;
    insertText(c, text);
    return !!(await waitFor(() => norm(textOf(c)).includes(want), {timeout: 1500}));
  }

  /** Elements showing the plugin name that appeared outside the field after typing (ChatGPT's suggestion list),
   *  for when the list has no role="option" markup. */
  function newSuggestion(name, before, c) {
    const short = norm(name).split(' ')[0];
    let best = null;
    for (const el of document.body.querySelectorAll('*')) {
      if (before.has(el) || c.contains(el) || el.closest('#nlx-cg-bar') || !visible(el)) continue;
      const t = norm(el.textContent);
      if (!t.includes(short) || t.length > 120) continue;
      if (!best || el.textContent.length < best.textContent.length) best = el;
    }
    return best ? (best.closest('[role="option"], [role="menuitem"], button, li, a') || best) : null;
  }
  const mentionText = (c, name) => norm(textOf(c)).includes('@' + norm(name).split(' ')[0]);

  /**
   * Like a person: types "@NeuroLaudos IA", waits for ChatGPT's list and presses Enter to pick the plugin.
   * Enter is pressed only when the list is showing (otherwise it would send the mention alone): without the list,
   * the run pauses so the person picks the plugin (and clicks "Já selecionei o plugin").
   */
  async function selectPlugin(name, trustManual) {
    const c = composer();
    if (!c) return fail(loginShown() ? 'cg_not_logged' : 'cg_composer');
    if (chipPresent(name)) return {ok: true, how: 'chip'};
    if (trustManual) return {ok: true, manual: true, how: 'manual'};
    clearEditor(c);
    const before = new Set(document.body.querySelectorAll('*'));
    placeCaretAtEnd(c);
    // Typed in pieces (input events like the keyboard), not pasted: the list opens while typing.
    for (const part of ['@', name.split(' ')[0].slice(0, 5), name.split(' ')[0].slice(5), name.slice(name.indexOf(' '))]) {
      if (!part) continue;
      insertText(c, part);
      await NLX.DOM.sleep(180);
    }
    if (!mentionText(c, name)) return fail('cg_insert', 'a menção @' + name + ' não entrou no campo');
    const opt = await waitFor(() => pluginOption(name) || newSuggestion(name, before, c), {timeout: 4000});
    if (!opt) { clearEditor(c); return fail('cg_plugin_select', 'a lista de plugins não apareceu ao digitar @' + name); }
    const picked = () => chipPresent(name) ? 'chip' : (!mentionText(c, name) || !opt.isConnected) ? 'picker' : null;
    c.focus(); placeCaretAtEnd(c);
    NLX.DOM.key(c, 'Enter', {keyCode: 13, which: 13});
    let how = await waitFor(picked, {timeout: 2000});
    if (!how && opt.isConnected) { click(opt); how = await waitFor(picked, {timeout: 2000}); }
    // Enter must not have sent the mention alone
    if (document.querySelectorAll(CG.userMsg).length && allMsgs().at(-1)?.getAttribute('data-message-author-role') === 'user' && norm(allMsgs().at(-1).textContent) === norm('@' + name)) return fail('cg_send', 'a menção foi enviada sozinha');
    if (!how) { clearEditor(c); return fail('cg_plugin_select', 'o plugin não ficou selecionado após Enter'); }
    return {ok: true, how: 'enter'};
  }

  // ---------- message ----------
  async function insert(text, code, name) {
    const c = composer();
    if (!c) return fail('cg_composer');
    // The command already starts with the mention placed in the previous step: the rest is pasted after it.
    let rest = String(text);
    const mention = '@' + (name || 'NeuroLaudos IA');
    if (rest.startsWith(mention)) rest = rest.slice(mention.length).trimStart();
    if (!await pasteText(c, (norm(textOf(c)) ? ' ' : '') + rest)) return fail('cg_insert');
    const ok = await waitFor(() => textOf(c).includes(code), {timeout: 4000});
    return ok ? {ok: true} : fail('cg_insert');
  }

  /** Sends with Enter, like a person; the send button is the fallback. */
  async function sendMessage(code) {
    const c = composer();
    if (!c) return fail('cg_composer');
    const n = userMsgs();
    const url = location.href;
    // Sent when: a new user message shows up, the answer starts, the page moved to the new conversation, or the
    // field (looked up again: ChatGPT may replace it) no longer holds the command.
    const acked = () => {
      const u = document.querySelectorAll(CG.userMsg);
      if (u.length > n || streaming() || location.href !== url) return true;
      const f = composer();
      return !f || !textOf(f).includes(code) ? true : null;
    };
    // An open suggestion list would take the Enter: close it first.
    if (pickerOptions().length) { NLX.DOM.key(c, 'Escape', {keyCode: 27, which: 27}); await NLX.DOM.sleep(200); }
    c.focus(); placeCaretAtEnd(c);
    NLX.DOM.key(c, 'Enter', {keyCode: 13, which: 13});
    if (await waitFor(acked, {timeout: 2500})) return {ok: true, how: 'enter'};
    const btn = await waitFor(() => { const b = sendBtn(); return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null; }, {timeout: LIMITS.sendReady});
    if (!btn) return fail('cg_send', 'Enter não enviou e o botão enviar não apareceu');
    click(btn);
    return (await waitFor(acked, {timeout: LIMITS.sendAck})) ? {ok: true, how: 'button'} : fail('cg_send');
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
        case 'cg.insert': return insert(msg.text, msg.code, msg.name);
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
