import {Injectable, NgZone, inject} from '@angular/core';

/** A screen's zoom step: returns true when it took the step (the screen is on top and visible). */
export type ZoomHandler = (dir: -1 | 1) => boolean;

/**
 * Ctrl (or Cmd) + mouse wheel zooms the screen in front instead of the browser: the reading mode changes the font size,
 * the edit mode and the Word preview their own zoom, everything else the app's screen size (A-/A+). Handlers registered
 * last are asked first. Pinch on a touchpad arrives the same way and works too. The browser's own zoom is untouched.
 */
@Injectable({providedIn: 'root'})
export class WheelZoom {
  private zone = inject(NgZone);
  private handlers: ZoomHandler[] = [];
  private last = 0;

  constructor() {
    this.zone.runOutsideAngular(() => window.addEventListener('wheel', e => this.onWheel(e), {passive: false, capture: true}));
  }

  /** Adds a handler on top; call the returned function to remove it. */
  register(h: ZoomHandler): () => void {
    this.handlers.push(h);
    return () => { this.handlers = this.handlers.filter(x => x !== h); };
  }

  private onWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();   // the browser does not zoom
    if (!e.deltaY) return;
    // one step per wheel click, at once; a touchpad sends a burst of tiny events, so at most one step every 90 ms
    const now = performance.now();
    if (now - this.last < 90) return;
    this.last = now;
    const dir: -1 | 1 = e.deltaY < 0 ? 1 : -1;   // wheel up = bigger
    this.zone.run(() => { for (const h of [...this.handlers].reverse()) if (h(dir)) return; });
  }
}
