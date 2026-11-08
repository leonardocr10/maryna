// One place for every selector the extension depends on (NeuroLaudos IA and ChatGPT).
// Preferred: the stable data-nl-* attributes published by the NeuroLaudos IA app. Text based finders are a
// compatibility fallback for older app versions and are used only where the result can be checked.
// ChatGPT has no published contract: its list is ordered from most to least specific and every match is validated.
// To update after an interface change, see README.md > "Seletores".
(() => {
  const NLX = globalThis.NLX = globalThis.NLX || {};
  if (NLX.SEL) return;

  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = el => !!el && el.isConnected && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const byText = (root, sel, text) => [...(root || document).querySelectorAll(sel)].find(el => norm(el.textContent) === norm(text) || norm(el.textContent).startsWith(norm(text)));

  const NL = {
    review: '[data-nl-review]',
    headTools: '[data-nl-head-tools]',
    approveAll: '[data-nl-action="approve-all"]',
    sectionBar: '[data-nl-section][data-nl-kind]',
    sectionBarFor: k => `[data-nl-section="${CSS.escape(k)}"][data-nl-kind]`,
    editorFor: k => `[data-nl-editor="${CSS.escape(k)}"]`,
    chatgptButton: '[data-nl-action="chatgpt"]',
    modal: '[data-nl-cg]',
    modalFor: k => `[data-nl-cg][data-nl-section="${CSS.escape(k)}"]`,
    mcpOption: 'input[data-nl-method-option="mcp"]',
    images: 'input[data-nl-images]',
    prepare: '[data-nl-action="prepare-mcp"]',
    command: 'textarea[data-nl-command]',
    copyCommand: '[data-nl-action="copy-command"]',
    close: '[data-nl-action="close"]',
    sectionMenuToggle: 'button[aria-controls="sec-menu"]',
    login: 'input[type="password"]',
  };

  /** Fallback finders (older app without data-nl-*). Each returns null instead of guessing. */
  const NL_FALLBACK = {
    approveAll: () => { const b = byText(document, '.head-tools button, button', 'Aprovar todas'); return b && norm(b.textContent).includes('aprovar todas') ? b : null; },
    reviewTitle: () => [...document.querySelectorAll('h2')].find(h => norm(h.textContent) === 'conferir secoes') || null,
    sectionsTab: () => [...document.querySelectorAll('[role="tab"]')].find(b => norm(b.textContent).includes('secoes')) || null,
    modal: () => document.querySelector('[role="dialog"][aria-label^="ChatGPT:"] .cg') || null,
  };

  const CG = {
    composer: ['#prompt-textarea[contenteditable="true"]', 'div#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea#prompt-textarea', 'form textarea[name="prompt-textarea"]', 'form [contenteditable="true"][role="textbox"]', 'main [contenteditable="true"]', 'form textarea'],
    send: ['button[data-testid="send-button"]', 'button#composer-submit-button', 'button[data-testid="composer-submit-button"]', 'button[aria-label="Enviar prompt"]', 'button[aria-label="Send prompt"]', 'button[aria-label*="Enviar" i]', 'button[aria-label*="Send" i]'],
    stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Parar" i]', 'button[aria-label*="Stop" i]'],
    userMsg: '[data-message-author-role="user"]',
    assistantMsg: '[data-message-author-role="assistant"]',
    turn: 'article[data-testid^="conversation-turn"], [data-testid^="conversation-turn"]',
    login: ['button[data-testid="login-button"]', 'a[href*="/auth/login"]', 'button[data-testid="signup-button"]'],
    /** Options of the mention / plugin picker that opens on "@". */
    option: ['[role="listbox"] [role="option"]', '[role="menu"] [role="menuitem"]', '[role="option"]', '[role="menuitem"]', '[cmdk-item]', '[data-radix-collection-item]'],
    /** Buttons of a tool-call confirmation: detected only, never clicked. */
    authText: /^(confirmar|confirm|permitir|allow|aprovar|approve|sempre permitir|always allow|permitir sempre|negar|deny|recusar|decline)$/i,
    rateLimit: /(atingiu|alcancou|reached|hit).{0,60}(limite|limit)|limite de uso|usage cap|too many requests|muitas solicitacoes/i,
    errorText: /(algo deu errado|something went wrong|erro na rede|network error|an error occurred|ocorreu um erro|falha ao gerar|error in message stream|tente novamente mais tarde)/i,
  };

  /** First element matching any selector of the list, visible when `vis`. */
  function first(list, root = document, vis = true) {
    for (const s of [].concat(list)) {
      let found;
      try { found = [...root.querySelectorAll(s)]; } catch { continue; }
      const el = found.find(e => !vis || visible(e));
      if (el) return el;
    }
    return null;
  }

  NLX.SEL = {NL, NL_FALLBACK, CG, first, visible, norm, byText};
})();
