import {Injectable, signal} from '@angular/core';

export type Theme = 'light' | 'dark';

/** Light/dark theme: kept per browser in localStorage and applied as data-theme on <html>. */
@Injectable({providedIn: 'root'})
export class ThemeService {
  readonly theme = signal<Theme>(ThemeService.initial());

  constructor() { this.apply(this.theme()); }

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
