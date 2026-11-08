/**
 * App tooltip in place of the browser's: any element with a `title` (static or bound) gets it.
 * On hover or keyboard focus the title moves to `data-nl-tip` (so the system tooltip never shows),
 * and one shared bubble is placed above the element (below when there is no room).
 * Elements with no visible text keep their accessible name through aria-label.
 */
const SHOW_DELAY = 350;
const GAP = 8;

let installed = false;

export function installTooltips(doc: Document = document) {
  if (installed) return;
  installed = true;

  const tip = doc.createElement('div');
  tip.id = 'nl-tip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(tip);

  let current: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Takes the element's title into data-nl-tip; returns the text to show. */
  const take = (el: HTMLElement): string => {
    const t = el.getAttribute('title');
    if (t !== null) {
      el.removeAttribute('title');
      if (t.trim()) {
        el.setAttribute('data-nl-tip', t);
        // an icon-only control would lose its name with the title: keep it for screen readers
        if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !(el.textContent || '').trim()) el.setAttribute('aria-label', t);
      } else el.removeAttribute('data-nl-tip');
    }
    return el.getAttribute('data-nl-tip') || '';
  };
  const target = (node: EventTarget | null): HTMLElement | null => {
    let el = node instanceof Element ? node as HTMLElement : null;
    while (el && el !== doc.body) {
      if (el.hasAttribute('title') || el.hasAttribute('data-nl-tip')) return el;
      el = el.parentElement;
    }
    return null;
  };
  const zoom = () => parseFloat(getComputedStyle(doc.documentElement).zoom || '1') || 1;

  const place = (el: HTMLElement) => {
    const z = zoom();
    // the bubble lives inside the zoomed <html>: screen coordinates are divided by the zoom
    const r = el.getBoundingClientRect(), vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
    const rect = {left: r.left / z, right: r.right / z, top: r.top / z, bottom: r.bottom / z, width: r.width / z};
    tip.style.left = '0px'; tip.style.top = '0px';
    const tw = tip.offsetWidth, th = tip.offsetHeight, W = vw / z, H = vh / z;
    let top = rect.top - th - GAP, below = false;
    if (top < 4) { top = rect.bottom + GAP; below = true; }
    if (below && top + th > H - 4) top = Math.max(4, H - th - 4);
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.min(Math.max(4, left), W - tw - 4);
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
    tip.classList.toggle('below', below);
    tip.style.setProperty('--arrow', Math.min(Math.max(10, rect.left + rect.width / 2 - left), tw - 10) + 'px');
  };

  const hide = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (current) current.removeAttribute('aria-describedby');
    current = null;
    tip.classList.remove('on');
    tip.setAttribute('aria-hidden', 'true');
  };
  const show = (el: HTMLElement, now = false) => {
    const text = take(el);
    if (!text) { hide(); return; }
    if (current === el && tip.classList.contains('on')) return;
    hide();
    current = el;
    const run = () => {
      if (current !== el || !el.isConnected) return;
      tip.textContent = el.getAttribute('data-nl-tip') || text;
      tip.classList.add('on');
      tip.setAttribute('aria-hidden', 'false');
      el.setAttribute('aria-describedby', 'nl-tip');
      place(el);
    };
    if (now) run(); else timer = setTimeout(run, SHOW_DELAY);
  };

  doc.addEventListener('mouseover', e => {
    const el = target(e.target);
    if (!el) { if (current) hide(); return; }
    if (el !== current) show(el);
  }, true);
  doc.addEventListener('mouseout', e => {
    if (!current) return;
    const to = (e as MouseEvent).relatedTarget as Node | null;
    if (!to || !current.contains(to)) { const next = target(to); if (next !== current) hide(); }
  }, true);
  // keyboard: show on focus (focus-visible only, so a mouse click does not leave a bubble open)
  doc.addEventListener('focusin', e => {
    const el = target(e.target);
    if (el && (e.target as HTMLElement).matches?.(':focus-visible')) show(el, true);
  });
  doc.addEventListener('focusout', () => hide());
  doc.addEventListener('mousedown', () => hide(), true);
  doc.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); }, true);
  doc.addEventListener('scroll', () => hide(), true);
  window.addEventListener('resize', () => hide());
  window.addEventListener('blur', () => hide());
}
