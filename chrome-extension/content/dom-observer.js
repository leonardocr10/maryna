// State based waits (MutationObserver + checks), user-like clicks and text input. No fixed sleeps decide outcomes;
// every wait has a maximum time and resolves on the real state of the page.
(() => {
  const NLX = globalThis.NLX = globalThis.NLX || {};
  if (NLX.DOM) return;

  /**
   * Resolves with the first truthy value of `check()`, re-evaluated on DOM mutations (batched per frame) and on a
   * slow safety interval. Resolves null when `timeout` passes. `attrs`: watch attribute changes too.
   */
  function waitFor(check, {timeout = 10000, root = document.documentElement, attrs = true, interval = 750} = {}) {
    return new Promise(resolve => {
      let done = false, queued = false;
      const finish = v => { if (done) return; done = true; obs.disconnect(); clearTimeout(timer); clearInterval(tick); resolve(v); };
      const run = () => { queued = false; if (done) return; let v; try { v = check(); } catch { v = null; } if (v) finish(v); };
      const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); setTimeout(run, 200); } };
      const obs = new MutationObserver(schedule);
      obs.observe(root, {childList: true, subtree: true, attributes: attrs, characterData: true});
      const timer = setTimeout(() => finish(null), timeout);
      const tick = setInterval(run, interval);   // background tabs throttle rAF: the interval keeps checking
      run();
    });
  }

  /** Resolves true when no mutation happened for `quietMs` (or false at `timeout`). */
  function waitQuiet({quietMs = 2000, timeout = 15000, root = document.documentElement} = {}) {
    return new Promise(resolve => {
      let last = Date.now();
      const obs = new MutationObserver(() => { last = Date.now(); });
      obs.observe(root, {childList: true, subtree: true, characterData: true});
      const end = Date.now() + timeout;
      const tick = setInterval(() => {
        if (Date.now() - last >= quietMs) { clearInterval(tick); obs.disconnect(); resolve(true); }
        else if (Date.now() > end) { clearInterval(tick); obs.disconnect(); resolve(false); }
      }, 250);
    });
  }

  /** A click like a person's: pointer and mouse events on the element itself (never screen coordinates). */
  function click(el) {
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    el.scrollIntoView({block: 'center', inline: 'nearest'});
    const r = el.getBoundingClientRect();
    const o = {bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0};
    try { el.dispatchEvent(new PointerEvent('pointerdown', {...o, pointerType: 'mouse', isPrimary: true})); } catch {}
    el.dispatchEvent(new MouseEvent('mousedown', o));
    try { el.dispatchEvent(new PointerEvent('pointerup', {...o, pointerType: 'mouse', isPrimary: true})); } catch {}
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
    return true;
  }

  /** Types into a contenteditable / textarea through the browser's own editing command (keeps the editor in sync). */
  function insertText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      const v = el.value + text;
      setter ? setter.call(el, v) : (el.value = v);
      el.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
      return true;
    }
    placeCaretAtEnd(el);
    if (document.execCommand('insertText', false, text)) return true;
    // Fallback: a paste event with the text, as the editors handle it.
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    return el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
  }

  function placeCaretAtEnd(el) {
    el.focus();
    const sel = window.getSelection(); const range = document.createRange();
    range.selectNodeContents(el); range.collapse(false);
    sel.removeAllRanges(); sel.addRange(range);
  }

  /** Clears an editor (contenteditable or textarea) through editing commands. */
  function clearEditor(el) {
    el.focus();
    if (el.tagName === 'TEXTAREA') { insertTextValue(el, ''); return; }
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
  }
  function insertTextValue(el, v) { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set; setter ? setter.call(el, v) : (el.value = v); el.dispatchEvent(new Event('input', {bubbles: true})); }

  function key(el, k, extra = {}) {
    const o = {key: k, code: k, bubbles: true, cancelable: true, composed: true, ...extra};
    el.dispatchEvent(new KeyboardEvent('keydown', o)); el.dispatchEvent(new KeyboardEvent('keyup', o));
  }

  /** Keeps the worker awake while a run is active (long waits). */
  let port = null;
  function keepAlive(on) {
    if (on && !port) {
      try { port = chrome.runtime.connect({name: 'nlauto-keepalive'}); port.onDisconnect.addListener(() => { port = null; }); } catch { port = null; }
      NLX._ka = setInterval(() => { try { port?.postMessage({t: Date.now()}); } catch {} }, 20000);
    } else if (!on && port) { clearInterval(NLX._ka); try { port.disconnect(); } catch {} port = null; }
  }

  NLX.DOM = {waitFor, waitQuiet, click, insertText, clearEditor, placeCaretAtEnd, key, keepAlive, sleep: ms => new Promise(r => setTimeout(r, ms))};
})();
