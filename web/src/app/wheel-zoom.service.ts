import {Injectable, NgZone, inject} from '@angular/core';

/** A screen's zoom step: returns true when it took the step (the screen is on top and visible). */
export type ZoomHandler = (dir: -1 | 1) => boolean;

interface Pending {base: number; target: number; timer: any; commit: (v: number) => void}

/**
 * Ctrl (or Cmd) + mouse wheel zooms the screen in front instead of the browser: the reading mode changes the font size,
 * the edit mode and the Word preview their own zoom, everything else the app's screen size (A-/A+). Handlers registered
 * last are asked first. Pinch on a touchpad arrives the same way and works too. The browser's own zoom is untouched.
 *
 * Re-laying out a long text at every wheel click makes the screen stall, so a screen can ask for preview(): the step
 * shows at once as a visual scale (no layout), and the real zoom is applied once, when the wheel stops.
 */
@Injectable({providedIn: 'root'})
export class WheelZoom {
  private zone = inject(NgZone);
  private handlers: ZoomHandler[] = [];
  private last = 0;
  private pend = new Map<HTMLElement, Pending>();
  private hudEl: HTMLDivElement | null = null;
  private hudTimer: any;

  constructor() {
    this.zone.runOutsideAngular(() => window.addEventListener('wheel', e => this.onWheel(e), {passive: false, capture: true}));
  }

  /** Adds a handler on top; call the returned function to remove it. */
  register(h: ZoomHandler): () => void {
    this.handlers.push(h);
    return () => { this.handlers = this.handlers.filter(x => x !== h); };
  }

  /** Value a preview is heading to (or the applied one when there is none). */
  current(el: HTMLElement | null | undefined, base: number) { return (el && this.pend.get(el)?.target) ?? base; }

  /** Shows `target` at once as a scale of `el`, and calls commit(target) once the wheel has been still for a moment. */
  preview(el: HTMLElement | null | undefined, base: number, target: number, commit: (v: number) => void, label: string) {
    this.hud(label);
    if (!el) { this.zone.run(() => commit(target)); return; }
    let p = this.pend.get(el);
    if (!p) { p = {base, target, timer: 0, commit}; this.pend.set(el, p); el.style.transformOrigin = 'top center'; el.style.willChange = 'transform'; }
    p.target = target; p.commit = commit;
    el.style.transform = target === p.base ? '' : `scale(${target / p.base})`;
    clearTimeout(p.timer);
    const done = p;
    p.timer = setTimeout(() => {
      this.pend.delete(el);
      this.zone.run(() => done.commit(done.target));
      // the scale goes away right after the real zoom is drawn, so the text does not jump
      requestAnimationFrame(() => { el.style.transform = ''; el.style.willChange = ''; });
    }, 260);
  }

  /** Small badge with the zoom just chosen (like Word and the browser show). */
  hud(label: string) {
    if (!this.hudEl) {
      const d = document.createElement('div');
      d.setAttribute('role', 'status'); d.setAttribute('aria-live', 'polite');
      d.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2000;padding:8px 16px;border-radius:999px;' +
        'background:rgba(15,40,35,.88);color:#fff;font:600 14px var(--font, system-ui);pointer-events:none;transition:opacity .2s;opacity:0';
      document.body.appendChild(d); this.hudEl = d;
    }
    this.hudEl.textContent = label; this.hudEl.style.opacity = '1';
    clearTimeout(this.hudTimer);
    this.hudTimer = setTimeout(() => { if (this.hudEl) this.hudEl.style.opacity = '0'; }, 900);
  }

  private onWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();   // the browser does not zoom
    if (!e.deltaY) return;
    // one step per wheel click, at once; a touchpad sends a burst of tiny events, so at most one step every 60 ms
    const now = performance.now();
    if (now - this.last < 60) return;
    this.last = now;
    const dir: -1 | 1 = e.deltaY < 0 ? 1 : -1;   // wheel up = bigger
    // handlers run outside Angular: a preview step does not redraw the whole app; commits enter Angular themselves
    for (const h of [...this.handlers].reverse()) if (h(dir)) return;
  }
}
