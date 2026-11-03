import {Injectable, inject, signal} from '@angular/core';
import {Api} from './api.service';

const IDLE_MS = 5 * 60_000;   // pause after 5 minutes without mouse/keyboard
const FLUSH_EVERY = 30;       // seconds between saves to the server

/** Counts active working time on the open evaluation (paused when the tab is hidden or idle; stops at approval). */
@Injectable({providedIn: 'root'})
export class WorkTimer {
  private api = inject(Api);
  readonly evalId = signal('');
  readonly seconds = signal(0);
  readonly state = signal<'off' | 'running' | 'paused' | 'finished'>('off');
  readonly pauseReason = signal('');
  readonly stats = signal<any>(null);

  private saved = 0;      // seconds already stored on the server
  private pending = 0;    // counted but not yet sent
  private lastActivity = Date.now();

  constructor() {
    const touch = () => { this.lastActivity = Date.now(); };
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']) document.addEventListener(ev, touch, {passive: true, capture: true});
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); else touch(); });
    window.addEventListener('pagehide', () => this.flush(true));
    setInterval(() => this.tick(), 1000);
    this.loadStats();
  }

  start(id: string, workSeconds: number, finished: boolean) {
    if (this.evalId() && this.evalId() !== id) this.flush();
    this.evalId.set(id); this.saved = Number(workSeconds) || 0; this.pending = 0; this.lastActivity = Date.now();
    this.seconds.set(this.saved);
    this.state.set(finished ? 'finished' : 'running');
  }
  /** Evaluation approved: last flush, then the time is frozen. */
  finish() { if (this.state() === 'finished') return; this.flush(); this.state.set('finished'); this.loadStats(); }
  stop() { this.flush(); this.evalId.set(''); this.state.set('off'); }

  private tick() {
    if (!this.evalId() || this.state() === 'finished' || this.state() === 'off') return;
    if (document.hidden) { this.pause('Aba do navegador escondida'); return; }
    if (Date.now() - this.lastActivity > IDLE_MS) { this.pause('Sem uso há mais de 5 minutos'); return; }
    this.state.set('running'); this.pauseReason.set('');
    this.pending++; this.seconds.set(this.saved + this.pending);
    if (this.pending >= FLUSH_EVERY) this.flush();
  }
  private pause(reason: string) { if (this.state() !== 'paused') { this.state.set('paused'); this.flush(); } this.pauseReason.set(reason); }

  private flush(onUnload = false) {
    const id = this.evalId(), secs = this.pending;
    if (!id || secs <= 0) return;
    this.pending = 0; this.saved += secs;
    const body = JSON.stringify({seconds: secs});
    const headers = {'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionStorage.getItem('token')};
    // keepalive lets the last seconds reach the server while the page is closing
    fetch(`/api/evaluations/${id}/time`, {method: 'POST', headers, body, keepalive: onUnload}).catch(() => { this.pending += secs; this.saved -= secs; });
  }

  async loadStats() { if (!this.api.loggedIn()) return; try { this.stats.set(await this.api.req('GET', '/stats/time')); } catch {} }
}

/** 3725 -> "1h 02min"; 95 -> "1min 35s". */
export function duration(total: number, withSeconds = false) {
  const s = Math.max(0, Math.round(total || 0)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}min`;
  if (m) return withSeconds ? `${m}min ${String(sec).padStart(2, '0')}s` : `${m}min`;
  return `${sec}s`;
}
/** Stopwatch format 01:02:05. */
export const clock = (total: number) => { const s = Math.max(0, Math.floor(total || 0)); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
