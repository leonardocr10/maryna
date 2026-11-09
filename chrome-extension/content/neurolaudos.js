// Content script of NeuroLaudos IA: the "Modo automático" button, the panel (iframe of the extension) and the
// page actions the worker asks for (open a section, open its ChatGPT window, prepare the task, read the status).
// It reads only the evaluation open in this tab, and only ids, codes and statuses: never clinical text.
(() => {
  const NLX = globalThis.NLX;
  if (!NLX || NLX.nlLoaded) return;
  NLX.nlLoaded = true;
  const {NL, NL_FALLBACK, first, visible, norm} = NLX.SEL;
  const {waitFor, click} = NLX.DOM;
  const RUN_KEY = 'nlauto.run';
  const CODE_RE = /^NL-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

  let tabId = null, run = null, panel = null, panelOpen = false;
  const fail = (code, detail) => ({ok: false, code, detail: detail || null});

  // ---------- reading the page ----------
  const review = () => document.querySelector(NL.review);
  const compat = () => !review() && !!NL_FALLBACK.reviewTitle();     // older app without data-nl-*
  const evaluationId = () => review()?.getAttribute('data-nl-evaluation') || (compat() ? location.pathname.match(/([0-9a-f-]{8,})/i)?.[1] || location.pathname : null);
  const approveAllBtn = () => document.querySelector(NL.approveAll) || NL_FALLBACK.approveAll();

  const LABEL_STATE = {pendente: 'pend', revisar: 'gen', aprovada: 'ap', 'aprovado · do arquivo': 'file'};
  function sectionsFromPage() {
    const bars = [...document.querySelectorAll(NL.sectionBar)];
    if (bars.length) return bars.map(b => ({key: b.getAttribute('data-nl-section'), name: b.getAttribute('data-nl-name') || '', kind: b.getAttribute('data-nl-kind'), state: b.getAttribute('data-nl-state')}));
    // Compatibility: ".sn-seg" title "NN. Nome · status". The kind is checked again when the section opens.
    return [...document.querySelectorAll('.sn-seg[title]')].map(b => {
      const m = b.getAttribute('title').match(/^(\d+)\.\s*(.+?)\s*·\s*(.+)$/);
      if (!m) return null;
      const label = norm(m[3]);
      const kind = label === 'falta no documento' ? 'missing' : label.includes('do arquivo') ? 'fixed' : norm(m[2]).startsWith('hipotese diagnostica') ? 'hand' : 'ai';
      return {key: 'pos-' + m[1], name: m[2], kind, state: LABEL_STATE[label] || 'pend', compat: true};
    }).filter(Boolean);
  }

  /** Sections bar is filtered while "Todas as seções" has a filter: close it to see every section. */
  async function showAllBars() {
    const t = document.querySelector(NL.sectionMenuToggle);
    if (t && t.getAttribute('aria-expanded') === 'true') { click(t); await waitFor(() => t.getAttribute('aria-expanded') !== 'true', {timeout: 3000}); }
    if (!document.querySelector(NL.sectionBar) && !document.querySelector('.sn-seg')) {
      const tab = NL_FALLBACK.sectionsTab();
      if (tab && tab.getAttribute('aria-selected') !== 'true') { click(tab); await waitFor(() => document.querySelector(NL.sectionBar) || document.querySelector('.sn-seg'), {timeout: 5000}); }
    }
  }

  async function scan() {
    if (!review() && !compat()) return document.querySelector(NL.login) ? fail('nl_not_logged') : fail('nl_not_review');
    await showAllBars();
    const sections = sectionsFromPage();
    if (!sections.length) return fail('nl_selector', 'lista de seções não encontrada');
    return {ok: true, evaluationId: evaluationId(), readOnly: review()?.getAttribute('data-nl-readonly') === '1' || !approveAllBtn(), compat: !review(), sections};
  }

  function checkEval(msg) { if (msg.evaluationId && evaluationId() !== msg.evaluationId) return fail(review() || compat() ? 'nl_changed' : (document.querySelector(NL.login) ? 'nl_not_logged' : 'nl_not_review')); return null; }

  const barFor = key => key.startsWith('pos-') ? [...document.querySelectorAll('.sn-seg[title]')].find(b => b.getAttribute('title').startsWith(key.slice(4) + '.')) : document.querySelector(NL.sectionBarFor(key));
  const editorFor = key => key.startsWith('pos-') ? document.querySelector('section.card.editor') : document.querySelector(NL.editorFor(key));

  async function openSection(key) {
    await showAllBars();
    if (editorFor(key) && !key.startsWith('pos-')) return {ok: true};
    const bar = barFor(key);
    if (!bar) return fail('nl_section', 'seção não está na lista');
    click(bar);
    const ok = await waitFor(() => {
      if (key.startsWith('pos-')) return bar.getAttribute('aria-current') === 'true' && document.querySelector('section.card.editor');
      return editorFor(key);
    }, {timeout: 15000});
    return ok ? {ok: true} : fail('nl_section');
  }

  // ---------- the section's ChatGPT window ----------
  const modalEl = key => key && !key.startsWith('pos-') ? document.querySelector(NL.modalFor(key)) : (document.querySelector(NL.modal) || NL_FALLBACK.modal());
  const STATUS_BY_LABEL = {pendente: 'pending', 'em processamento': 'processing', 'rascunho recebido': 'draft_received', revisado: 'reviewed', erro: 'error', expirada: 'expired', descartada: 'discarded'};

  function readModal(el) {
    if (!el) return null;
    if (el.hasAttribute('data-nl-cg')) return {
      ready: el.getAttribute('data-nl-ready') === '1', mcp: el.getAttribute('data-nl-mcp') === '1', method: el.getAttribute('data-nl-method'), busy: el.getAttribute('data-nl-busy') === '1',
      code: el.getAttribute('data-nl-task-code') || null, mode: el.getAttribute('data-nl-task-mode') || null, status: el.getAttribute('data-nl-task-status') || 'none', problem: el.getAttribute('data-nl-task-problem') || null,
      expires: el.getAttribute('data-nl-task-expires') || null, needsConfirmation: el.getAttribute('data-nl-needs-confirmation') === '1', applied: el.getAttribute('data-nl-applied') === '1',
    };
    // Compatibility reading (no data-nl-*): badge label, code box and radio state.
    const label = norm(el.querySelector('.cg-head .badge')?.textContent);
    const code = (el.querySelector('code.code')?.textContent || '').trim();
    const mcpRadio = el.querySelector('input[type="radio"][value="mcp"]');
    return {ready: true, mcp: !!mcpRadio && !mcpRadio.disabled, method: el.querySelector('input[type="radio"]:checked')?.value || null, busy: false,
      code: CODE_RE.test(code) ? code : null, mode: CODE_RE.test(code) ? 'mcp' : null, status: STATUS_BY_LABEL[label] || 'none', expires: null,
      needsConfirmation: !!el.querySelector('.alert.warn') && label === 'rascunho recebido', applied: false};
  }

  async function openModal(key) {
    const open = document.querySelector(NL.modal) || NL_FALLBACK.modal();
    if (open && modalEl(key) !== open) { click(open.querySelector(NL.close) || open.querySelector('.x')); await waitFor(() => !open.isConnected, {timeout: 5000}); }
    let el = modalEl(key);
    if (!el) {
      const ed = editorFor(key);
      if (!ed) return fail('nl_section');
      // The kind is checked again on the page: a disabled ChatGPT button means the AI never writes this section.
      const btn = ed.querySelector(NL.chatgptButton) || [...ed.querySelectorAll('button')].find(b => norm(b.textContent) === 'chatgpt');
      if (!btn) return fail('nl_selector', 'botão ChatGPT da seção');
      if (btn.disabled) return {ok: true, notEligible: true, reason: ed.querySelector('.act-why')?.textContent?.trim()?.slice(0, 120) || 'Seção escrita pela psicóloga'};
      if (/texto fixo do arquivo/i.test(ed.querySelector('.edt small')?.textContent || '')) return {ok: true, notEligible: true, reason: 'Texto fixo do arquivo'};
      click(btn);
    }
    el = await waitFor(() => { const m = modalEl(key); return m && readModal(m)?.ready ? m : null; }, {timeout: 15000});
    if (!el) return fail('nl_modal');
    return {ok: true, modal: readModal(el)};
  }

  async function prepare(key, images, previous) {
    const el = modalEl(key);
    if (!el) return fail('nl_modal');
    let m = readModal(el);
    if (!m.mcp) return fail('nl_mcp_off');
    if (m.method !== 'mcp') {
      const radio = el.querySelector(NL.mcpOption) || el.querySelector('input[type="radio"][value="mcp"]');
      if (!radio || radio.disabled) return fail('nl_mcp_off');
      click(radio);
      if (!await waitFor(() => (readModal(el).method === 'mcp' || radio.checked) && (el.querySelector(NL.prepare) || el.querySelector(NL.command) || el.querySelector('textarea[aria-label="Comando para o ChatGPT"]')), {timeout: 5000})) return fail('nl_selector', 'opção ChatGPT — plugin (MCP)');
    }
    m = readModal(el);
    if (m.mode === 'mcp' && ['pending', 'processing'].includes(m.status) && m.code && m.code !== previous) return {ok: true, modal: m};
    const box = el.querySelector(NL.images);
    if (box && box.checked !== !!images) click(box);
    // An open task made before: 'Gerar novo código' (the server closes the old one), never its code again.
    const btn = el.querySelector(NL.prepare) || [...el.querySelectorAll('button')].find(b => norm(b.textContent).startsWith('preparar tarefa'))
      || el.querySelector(NL.newCode) || [...el.querySelectorAll('button')].find(b => norm(b.textContent).startsWith('gerar novo codigo'));
    if (!btn) return fail('nl_selector', 'botão Preparar tarefa');
    if (!await waitFor(() => !btn.disabled, {timeout: 5000})) return fail('nl_prepare', 'botão desativado');
    click(btn);
    let sawBusy = false, idleSince = 0, goneSince = 0;
    const got = await waitFor(() => {
      const cur = modalEl(key);    // re-read every time: the app may re-render the window
      if (!cur) { goneSince ||= Date.now(); return Date.now() - goneSince > 2500 ? {gone: true} : null; }
      goneSince = 0;
      const r = readModal(cur);
      if (r.code && r.code !== previous && CODE_RE.test(r.code) && r.status === 'pending' && !r.busy) return {modal: r};
      if (r.busy) { sawBusy = true; idleSince = 0; }
      else if (sawBusy) { idleSince ||= Date.now(); if (Date.now() - idleSince > 4000) return {failed: true}; }
      return null;
    }, {timeout: 30000, interval: 500});
    if (!got) return fail('nl_no_code');
    if (got.gone) return fail('nl_modal', 'janela fechada durante o preparo');
    if (got.failed) return fail('nl_prepare');
    return {ok: true, modal: got.modal};
  }

  async function command(key) {
    const el = modalEl(key);
    if (!el) return fail('nl_modal');
    const ta = await waitFor(() => { const t = el.querySelector(NL.command) || el.querySelector('textarea[aria-label="Comando para o ChatGPT"]'); return t && t.value.trim() ? t : null; }, {timeout: 10000});
    return ta ? {ok: true, command: ta.value.trim()} : fail('nl_no_command');
  }

  /** Waits for the task to leave pending/processing. The app's window refreshes on its own every 5 s while visible;
   *  the `nlrefresh` event asks it to refresh now (it calls only the app's own server). */
  async function waitStatus(key, code, chunkMs) {
    if (!modalEl(key)) { const r = await openSection(key); if (!r.ok) return r; const o = await openModal(key); if (!o.ok) return o; }
    const ping = () => { try { modalEl(key)?.dispatchEvent(new CustomEvent('nlrefresh')); } catch {} };
    ping();
    const t = setInterval(ping, 4000);
    try {
      const r = await waitFor(() => {
        const el = modalEl(key);
        if (!el) return {gone: true};
        const m = readModal(el);
        if (m.code && code && m.code !== code) return {modal: m};
        return ['pending', 'processing', 'none'].includes(m.status) ? null : {modal: m};
      }, {timeout: Math.max(1000, chunkMs || 30000), interval: 1000});
      if (r?.gone) return {ok: true, modal: {status: 'pending', code}};   // window closed: the worker reopens it next round
      const el = modalEl(key);
      return {ok: true, modal: r?.modal || (el ? readModal(el) : {status: 'pending', code})};
    } finally { clearInterval(t); }
  }

  async function closeModal(key) {
    const el = modalEl(key) || document.querySelector(NL.modal) || NL_FALLBACK.modal();
    if (!el) return {ok: true};
    const x = el.querySelector(NL.close) || el.querySelector('.x');
    if (x) click(x);
    await waitFor(() => !el.isConnected, {timeout: 5000});
    return {ok: true};
  }

  // ---------- Conclusão instruction (the app answers through window events; strings only) ----------
  function askPage(send, reply, detail, timeout = 8000) {
    return new Promise(resolve => {
      const done = e => { clearTimeout(t); window.removeEventListener(reply, done); let d = {}; try { d = JSON.parse(e.detail || '{}'); } catch {} resolve(d); };
      const t = setTimeout(() => { window.removeEventListener(reply, done); resolve(null); }, timeout);
      window.addEventListener(reply, done);
      window.dispatchEvent(new CustomEvent(send, {detail}));
    });
  }
  async function getInstruction(key) {
    const d = await askPage('nlx-instruction-get', 'nlx-instruction', key);
    return d && d.key === key ? {ok: true, text: String(d.text || ''), editable: !!d.editable} : {ok: false, code: 'nl_selector', detail: 'instrução da Conclusão'};
  }
  async function setInstruction(key, text) {
    const d = await askPage('nlx-instruction-set', 'nlx-instruction-saved', JSON.stringify({key, text}), 15000);
    return d?.ok ? {ok: true} : {ok: false, code: 'nl_prepare', detail: 'a instrução da Conclusão não foi salva'};
  }

  async function reviewGet(key) {
    const d = await askPage('nlx-review-get', 'nlx-review', key, 15000);
    return d && d.key === key ? d : {ok: false, reason: 'page'};
  }
  async function reviewAct(key, taskId, action) {
    const d = await askPage('nlx-review-act', 'nlx-review-done', JSON.stringify({key, taskId, action}), 20000);
    return {ok: !!d?.ok};
  }

  // ---------- messages from the worker ----------
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg?.cmd?.startsWith('nl.')) return false;
    (async () => {
      if (msg.cmd !== 'nl.scan') { const bad = checkEval(msg); if (bad) return bad; }
      switch (msg.cmd) {
        case 'nl.scan': return scan();
        case 'nl.openSection': return openSection(msg.key);
        case 'nl.openModal': return openModal(msg.key);
        case 'nl.modalInfo': { const el = modalEl(msg.key); return el ? {ok: true, modal: readModal(el)} : fail('nl_modal'); }
        case 'nl.prepare': return prepare(msg.key, msg.images, msg.previous);
        case 'nl.command': return command(msg.key);
        case 'nl.waitStatus': return waitStatus(msg.key, msg.code, msg.chunkMs);
        case 'nl.closeModal': return closeModal(msg.key);
        case 'nl.getInstruction': return getInstruction(msg.key);
        case 'nl.reviewGet': return reviewGet(msg.key);
        case 'nl.reviewAct': return reviewAct(msg.key, msg.taskId, msg.action);
        case 'nl.setInstruction': return setInstruction(msg.key, msg.text);
        default: return fail('connection', 'comando desconhecido');
      }
    })().then(reply, e => reply(fail('connection', String(e?.message || e))));
    return true;
  });

  // ---------- button and panel ----------
  const ROBOT = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4"/><circle cx="12" cy="3.5" r="1"/><circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none"/><path d="M9.5 16.5h5M2 12v3M22 12v3"/></svg>';
  const mine = () => run && run.nlTabId === tabId;
  function buttonState() {
    if (!mine()) return {cls: '', label: 'Modo automático'};
    if (run.status === 'running') return {cls: 'running', label: 'Executando…'};
    if (run.status === 'paused') return {cls: 'paused', label: 'Pausado'};
    if (run.status === 'done') return {cls: 'done', label: 'Concluído'};
    return {cls: '', label: 'Modo automático'};
  }

  function ensureButton() {
    const anchor = approveAllBtn();
    let btn = document.getElementById('nlx-auto-btn');
    // The app's own button (data-nl-action="auto-mode") replaces the injected one: only its state is updated here.
    const native = document.querySelector('[data-nl-action="auto-mode"]');
    if (native) { btn?.remove(); paintButton(native); return; }
    if (!anchor) { btn?.remove(); return; }
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'nlx-auto-btn'; btn.type = 'button';
      btn.className = 'btn btn-sm nlx-auto-btn';
      btn.title = 'Gerar rascunhos automaticamente com ChatGPT';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.innerHTML = ROBOT + '<span class="nlx-label"></span>';
      btn.addEventListener('click', () => togglePanel());
    }
    if (btn.previousElementSibling !== anchor) anchor.after(btn);
    paintButton(btn);
  }
  function paintButton(btn) {
    const st = buttonState();
    if (btn.dataset.state !== (st.cls || 'idle')) btn.dataset.state = st.cls || 'idle';
    const lab = btn.querySelector('.nlx-label');
    if (lab && lab.textContent !== st.label) lab.textContent = st.label;
    const exp = panelOpen ? 'true' : 'false';
    if (btn.getAttribute('aria-expanded') !== exp) btn.setAttribute('aria-expanded', exp);
  }

  function togglePanel(force) {
    panelOpen = force ?? !panelOpen;
    if (panelOpen) shownFor = null;   // the automation window is back: the section window steps aside again
    if (panelOpen && !panel && tabId != null) {
      panel = document.createElement('iframe');
      panel.id = 'nlx-panel';
      panel.title = 'NeuroLaudos IA — Modo automático';
      const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      panel.src = chrome.runtime.getURL(`ui/panel.html?tab=${tabId}&theme=${theme}`);
      panel.setAttribute('allow', 'clipboard-write');   // "Copiar registro" in the details
      document.body.appendChild(panel);
    }
    if (panel) panel.hidden = !panelOpen;
    syncBackdrop();
    syncHide();
    ensureButton();
  }

  // ---------- one place for the run: the section's ChatGPT window hides while the run works ----------
  // The window stays open (the run reads it), only invisible; the panel shows the steps. It comes back when the run
  // pauses or when the person asks to see it ("Mostrar janela da seção" in the panel).
  let shownFor = null, hiddenEl = null;   // shownFor: "key|code" the person chose to see
  function syncHide() {
    const it = mine() && run.status === 'running' ? run.items?.[run.current] : null;
    const host = it ? modalEl(it.key) : null;
    const root = host ? (host.closest('.modal-bg') || host.closest('[role="dialog"]') || host) : null;
    const hide = root && shownFor !== `${it.key}|${it.code || ''}` ? root : null;
    if (hiddenEl && hiddenEl !== hide) { hiddenEl.classList.remove('nlx-run-hidden'); hiddenEl = null; }
    if (hide && !hide.classList.contains('nlx-run-hidden')) hide.classList.add('nlx-run-hidden');
    hiddenEl = hide;
    // Side panel open next to a visible window: the window moves left instead of going under the panel.
    const side = !!panel && panelOpen && !panel.classList.contains('nlx-modal');
    document.documentElement.classList.toggle('nlx-side-open', side);
  }

  // Setup screen: wide centered window over a dimmed page. During a run: side panel, the page stays visible.
  let backdrop = null;
  function syncBackdrop() {
    const on = !!panel && panelOpen && panel.classList.contains('nlx-modal');
    if (on && !backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'nlx-backdrop';
      // Clicking outside never closes it: only the X (or Esc, which asks first while a run works).
      document.body.insertBefore(backdrop, panel);
    }
    if (backdrop) backdrop.hidden = !on;
  }
  const maxH = () => panel?.classList.contains('nlx-modal') ? Math.floor(window.innerHeight * 0.9) : window.innerHeight - 96;

  // The panel asks for its height and to close (messages from the extension's own frame only).
  window.addEventListener('message', e => {
    if (!panel || e.source !== panel.contentWindow || e.origin !== new URL(chrome.runtime.getURL('')).origin) return;
    const d = e.data || {};
    if (d.nlx === 'height' && Number.isFinite(d.h)) panel.style.height = Math.min(Math.max(120, d.h), maxH()) + 'px';
    if (d.nlx === 'layout') { panel.classList.toggle('nlx-modal', d.mode === 'modal'); panel.classList.toggle('nlx-wide', !!d.wide); syncBackdrop(); syncHide(); }
    if (d.nlx === 'showModal') { const it = run?.items?.[run.current]; shownFor = d.on && it ? `${it.key}|${it.code || ''}` : null; syncHide(); }
    if (d.nlx === 'close') togglePanel(false);
    if (d.nlx === 'collapse') panel.classList.toggle('nlx-collapsed', !!d.on);
  });

  let queued = false;
  const flush = () => { if (!queued) return; queued = false; ensureButton(); syncHide(); };
  // rAF batches the checks; the timeout covers background tabs, where rAF does not run.
  const obs = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(flush); setTimeout(flush, 150); });

  // The app's own "Modo automático" button asks for the panel; the mark tells the app the extension is installed.
  document.documentElement.setAttribute('data-nlx-extension', chrome.runtime.getManifest?.().version || '1');
  window.addEventListener('nlx-open-panel', () => togglePanel(true));

  async function init() {
    try { tabId = (await chrome.runtime.sendMessage({type: 'hello'}))?.tabId ?? null; } catch {}
    try { run = (await chrome.storage.local.get(RUN_KEY))[RUN_KEY] || null; } catch {}
    obs.observe(document.body, {childList: true, subtree: true});
    ensureButton();
    if (mine() && (run.status === 'running' || run.status === 'paused')) { togglePanel(true); NLX.DOM.keepAlive(true); }
  }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !ch[RUN_KEY]) return;
    run = ch[RUN_KEY].newValue || null;
    NLX.DOM.keepAlive(mine() && run.status === 'running');
    if (mine() && run.status === 'paused' && !panelOpen) togglePanel(true);
    ensureButton();
    syncHide();
  });
  init();
})();
