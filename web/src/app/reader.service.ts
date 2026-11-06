import {Injectable, NgZone, inject} from '@angular/core';

/**
 * Reads a section aloud. No AI and nothing leaves the computer:
 * 1. Natural voice: Piper neural voice run by the local API (/api/tts, worker/tts_worker.py).
 * 2. Fallback: a voice installed in Windows through the browser (localService only; online voices
 *    such as Edge "Natural" or "Google português" send the text out and report text is health data).
 * Speed 1x / 1.5x / 2x like WhatsApp, kept between sessions.
 */
@Injectable({providedIn: 'root'})
export class Reader {
  private zone = inject(NgZone);
  readonly rates = [1, 1.5, 2];
  key = '';            // section being read
  paused = false;
  loading = false;
  rate = (() => { try { const r = Number(localStorage.getItem('nl_read_rate')); return this.rates.includes(r) ? r : 1; } catch { return 1; } })();
  private audio: HTMLAudioElement | null = null;
  private cache = new Map<string, string>();   // text -> object URL of its audio (memory only)
  private pos = 0;                             // 0..1 for the progress bar
  // browser-voice fallback state
  private parts: string[] = [];
  private index = 0;
  private run = 0;     // invalidates callbacks of a cancelled reading

  constructor() {
    // voices load asynchronously in Chrome/Edge: refresh the screen when they arrive
    if (this.supported) speechSynthesis.addEventListener('voiceschanged', () => this.zone.run(() => {}));
  }

  get supported() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }
  /** The player is always offered: the local natural voice does not depend on the browser. */
  available() { return true; }

  toggle(key: string, text: string) {
    if (this.key === key) { this.paused ? this.resume() : this.pause(); return; }
    this.start(key, text);
  }

  async start(key: string, text: string) {
    this.stop();
    this.key = key; this.paused = false; this.loading = true;
    const run = this.run;
    try {
      const cached = this.cache.get(text);
      if (cached) { await this.play(new Audio(cached), text); return; }
      const res = await fetch('/api/tts', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionStorage.getItem('token')}, body: JSON.stringify({text})});
      if (!res.ok || !res.body) throw new Error('tts ' + res.status);
      if (run !== this.run) { res.body.cancel(); return; }   // stopped while loading
      const type = res.headers.get('Content-Type') || '';
      // Online voice (MP3) arrives in pieces: play from the first piece instead of waiting for the whole file.
      if (/audio\/mpeg/.test(type) && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg')) await this.stream(res.body, text, run);
      else { const url = URL.createObjectURL(await res.blob()); this.remember(text, url); if (run === this.run) await this.play(new Audio(url), text); }
    } catch {
      if (run !== this.run) return;
      this.loading = false;
      this.startBrowserVoice(key, text);   // local API voice missing: Windows voice instead
    }
  }
  private remember(text: string, url: string) {
    if (this.cache.size > 20) { const [k, u] = this.cache.entries().next().value!; URL.revokeObjectURL(u); this.cache.delete(k); }
    this.cache.set(text, url);
  }
  /** Seconds of speech expected for a text at 1x (used for the progress bar while the length is still unknown). */
  private estimate(text: string) { return Math.max(2, text.split(/\s+/).filter(Boolean).length / 2.4); }
  private async play(a: HTMLAudioElement, text: string) {
    const guess = this.estimate(text);
    a.playbackRate = this.rate; a.preservesPitch = true;
    a.ontimeupdate = () => this.zone.run(() => { const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : guess; this.pos = Math.min(1, a.currentTime / d); });
    a.onended = () => this.zone.run(() => { if (this.audio === a) this.stop(); });
    this.audio = a; this.loading = false;
    await a.play();
  }
  /** Feeds the MP3 pieces to the audio element as they arrive; the full file is kept for the next playback. */
  private async stream(body: ReadableStream<Uint8Array>, text: string, run: number) {
    const ms = new MediaSource();
    const a = new Audio(URL.createObjectURL(ms));
    await new Promise<void>(r => ms.addEventListener('sourceopen', () => r(), {once: true}));
    const sb = ms.addSourceBuffer('audio/mpeg');
    const appended = () => new Promise<void>(r => sb.addEventListener('updateend', () => r(), {once: true}));
    const reader = body.getReader(), parts: Uint8Array[] = [];
    let started = false;
    while (true) {
      const {done, value} = await reader.read();
      if (run !== this.run) { reader.cancel(); URL.revokeObjectURL(a.src); return; }
      if (done) break;
      if (!value?.length) continue;
      parts.push(value);
      sb.appendBuffer(value as BufferSource); await appended();
      if (!started) { started = true; await this.play(a, text); }
    }
    if (ms.readyState === 'open') ms.endOfStream();
    if (!started) throw new Error('empty audio');
    this.remember(text, URL.createObjectURL(new Blob(parts as BlobPart[], {type: 'audio/mpeg'})));
  }
  pause() {
    this.paused = true;
    if (this.audio) { this.audio.pause(); return; }
    this.run++; if (this.supported) speechSynthesis.cancel();
  }
  resume() {
    if (!this.key) return;
    this.paused = false;
    if (this.audio) { this.audio.play(); return; }
    this.speak();
  }
  stop() {
    this.run++; this.key = ''; this.paused = false; this.loading = false; this.pos = 0; this.parts = [];
    if (this.audio) { this.audio.pause(); this.audio = null; }
    if (this.supported) speechSynthesis.cancel();
  }
  /** 1x -> 1.5x -> 2x -> 1x; applies at once. */
  cycleRate() {
    this.rate = this.rates[(this.rates.indexOf(this.rate) + 1) % this.rates.length];
    try { localStorage.setItem('nl_read_rate', String(this.rate)); } catch {}
    if (this.audio) { this.audio.playbackRate = this.rate; return; }
    if (this.key && !this.paused && this.parts.length) { this.run++; speechSynthesis.cancel(); this.speak(); }
  }
  progress() { return this.audio ? this.pos : this.parts.length ? this.index / this.parts.length : 0; }

  // ---------- fallback: Windows voice through the browser ----------
  private voice(): SpeechSynthesisVoice | null {
    if (!this.supported) return null;
    const local = speechSynthesis.getVoices().filter(v => v.localService);
    const br = local.filter(v => /^pt[-_]BR/i.test(v.lang));
    const pt = br.length ? br : local.filter(v => /^pt/i.test(v.lang));
    return pt.find(v => /francisca|maria|luciana/i.test(v.name)) || pt[0] || null;
  }
  private startBrowserVoice(key: string, text: string) {
    this.parts = text.replace(/^#{1,6}\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1')
      .split(/\n\s*\n/).flatMap(p => p.replace(/\s+/g, ' ').match(/[^.!?;:]+[.!?;:]*\s*/g) || []).map(s => s.trim()).filter(Boolean);
    if (!this.parts.length || !this.voice()) { this.stop(); return; }
    this.key = key; this.index = 0; this.paused = false;
    this.speak();
  }
  private speak() {
    const run = ++this.run;
    const voice = this.voice();
    if (!voice) { this.stop(); return; }
    const u = new SpeechSynthesisUtterance(this.parts[this.index]);
    u.voice = voice; u.lang = voice.lang; u.rate = this.rate;
    u.onend = () => this.zone.run(() => {
      if (run !== this.run) return;
      this.index++;
      if (this.index < this.parts.length) this.speak(); else this.stop();
    });
    u.onerror = () => this.zone.run(() => { if (run === this.run) this.stop(); });
    speechSynthesis.speak(u);
  }
}
