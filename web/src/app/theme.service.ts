import {Injectable, signal} from '@angular/core';

export type Theme = 'light' | 'dark';

/** Light/dark theme: kept per browser in localStorage and applied as data-theme on <html>. */
@Injectable({providedIn: 'root'})
export class ThemeService {
  readonly theme = signal<Theme>(ThemeService.initial());

  /** Screen size (zoom of the whole page), 80% to 150%; kept per browser like the theme. */
  static readonly ZOOMS = [80, 90, 100, 110, 125, 150];
  readonly zoom = signal<number>(ThemeService.initialZoom());

  constructor() { this.apply(this.theme()); this.applyZoom(this.zoom()); }

  private static initialZoom(): number {
    try { const z = Number(localStorage.getItem('nl-zoom')); if (ThemeService.ZOOMS.includes(z)) return z; } catch {}
    return 100;
  }
  /** One step smaller (-1) or bigger (+1); 0 goes back to 100%. */
  stepZoom(dir: -1 | 0 | 1) {
    const list = ThemeService.ZOOMS, i = list.indexOf(this.zoom());
    const z = dir === 0 ? 100 : list[Math.min(list.length - 1, Math.max(0, i + dir))];
    this.zoom.set(z); this.applyZoom(z);
    try { localStorage.setItem('nl-zoom', String(z)); } catch {}
  }
  canZoom(dir: -1 | 1) { const list = ThemeService.ZOOMS, i = list.indexOf(this.zoom()); return dir < 0 ? i > 0 : i < list.length - 1; }
  /** Zooms the whole page like the browser zoom: CSS zoom on <html>, and --zoom so every vh/vw size in the styles is
   *  divided by it (written as calc(100vh / var(--zoom, 1))), keeping the screen filled at any size. */
  private applyZoom(z: number) {
    const root = document.documentElement.style;
    root.zoom = z === 100 ? '' : String(z / 100);
    if (z === 100) root.removeProperty('--zoom'); else root.setProperty('--zoom', String(z / 100));
  }

  private static initial(): Theme {
    try {
      const saved = localStorage.getItem('nl-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'light';
  }

  set(t: Theme) {
    this.theme.set(t);
    this.apply(t);
    try { localStorage.setItem('nl-theme', t); } catch {}
  }

  private apply(t: Theme) { document.documentElement.setAttribute('data-theme', t); }
}
