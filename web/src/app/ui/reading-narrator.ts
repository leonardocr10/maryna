import {NgZone, signal} from '@angular/core';

/** One piece read aloud: a sentence of the rendered text and where it is on the page (for the highlight). */
export interface Segment {text: string; range: Range}
export type NarrationState = 'ready' | 'loading' | 'playing' | 'paused' | 'done' | 'unavailable';
/** Natural voice served by the API (/api/tts/voices): the online Edge ones when authorized in the server's .env, and
 *  the Piper models installed in this computer. The computer's own (robotic) voices are not offered. */
export interface VoiceOption {id: string; name: string; gender: string; local: boolean}
/** Used before the list arrives: the server's default voice. */
export const SERVER_VOICE: VoiceOption = {id: '', name: 'Voz natural do NeuroLaudos', gender: '', local: false};

/**
 * Reads segments in order, one sentence at a time, so the sentence being read can be highlighted and the person can
 * go to the previous or next sentence. The audio has no clock for the whole text, so progress is by sentence, never
 * by fake minutes and seconds. Only one narration exists at a time; stop() releases the audio.
 */
export class Narrator {
  readonly state = signal<NarrationState>('ready');
  readonly index = signal(0);
  readonly count = signal(0);
  readonly voices = signal<VoiceOption[]>([]);
  /** Called with the segment being read (null when nothing is). */
  onSegment: (i: number | null) => void = () => {};
  /** Called when the last segment ends; return true when more text was loaded and reading goes on. */
  onFinished: () => boolean = () => false;
  rate = 1;
  voiceId = '';
  private segments: Segment[] = [];
  private run = 0;
  private audio: HTMLAudioElement | null = null;
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();

  constructor(private zone: NgZone) {}
  segment(i: number): Segment | undefined { return this.segments[i]; }

  /** The natural voices the server offers; keeps the chosen one when it is still there. */
  async loadVoices() {
    try {
      const r = await fetch('/api/tts/voices', {headers: {Authorization: 'Bearer ' + sessionStorage.getItem('token')}});
      if (!r.ok) throw new Error('voices ' + r.status);
      const list: VoiceOption[] = (await r.json()).voices || [];
      this.zone.run(() => {
        this.voices.set(list);
        if (list.length && !list.some(v => v.id === this.voiceId)) this.voiceId = list[0].id;
      });
    } catch { this.zone.run(() => this.voices.set([])); }
  }

  /** New text to read (the section on screen). Stops what was being read. */
  load(segments: Segment[]) {
    this.stop();
    this.segments = segments; this.count.set(segments.length); this.index.set(0);
    this.state.set(segments.length ? 'ready' : 'done');
  }
  /** Keeps reading with the new text (whole report mode, next section). */
  continueWith(segments: Segment[]) {
    const run = ++this.run;
    this.segments = segments; this.count.set(segments.length); this.index.set(0);
    if (!segments.length) { if (!this.onFinished()) this.finish(); return; }
    this.play(run);
  }

  start(from = this.index()) {
    if (!this.segments.length) return;
    if (this.state() === 'unavailable') this.state.set('ready');
    this.index.set(Math.max(0, Math.min(from, this.segments.length - 1)));
    this.play(++this.run);
  }
  pause() {
    if (this.state() !== 'playing' && this.state() !== 'loading') return;
    this.run++; this.state.set('paused');
    if (this.audio) this.audio.pause();
  }
  /** Resumes where it stopped (inside the sentence when its audio is still loaded). */
  resume() {
    if (this.state() !== 'paused') return;
    const run = ++this.run, a = this.audio;
    if (a && !a.ended && a.currentTime > 0) {
      a.onended = () => this.zone.run(() => { if (this.audio === a) this.next(run); });
      this.state.set('playing'); a.play().catch(() => this.play(run)); return;
    }
    this.play(run);
  }
  stop() {
    this.run++;
    if (this.audio) { this.audio.pause(); this.audio.src = ''; this.audio = null; }
    this.index.set(0);
    if (this.state() !== 'unavailable') this.state.set(this.segments.length ? 'ready' : 'done');
    this.onSegment(null);
  }
  step(delta: number) {
    const i = Math.max(0, Math.min(this.index() + delta, this.segments.length - 1));
    this.index.set(i);
    if (this.state() === 'playing' || this.state() === 'loading') this.play(++this.run);
    else { if (this.audio) { this.audio.pause(); this.audio = null; } this.onSegment(i); }
  }
  setRate(r: number) { this.rate = r; if (this.audio) this.audio.playbackRate = r; }
  setVoice(id: string) {
    this.voiceId = id;
    if (this.state() === 'playing' || this.state() === 'loading') this.play(++this.run);
    else if (this.audio) { this.audio.pause(); this.audio = null; }
  }
  destroy() {
    this.stop(); this.segments = []; this.count.set(0);
    for (const u of this.cache.values()) URL.revokeObjectURL(u);
    this.cache.clear(); this.pending.clear();
  }

  private finish() { this.run++; this.audio = null; this.state.set('done'); this.index.set(0); this.onSegment(null); }
  private next(run: number) {
    if (run !== this.run) return;
    const i = this.index() + 1;
    if (i < this.segments.length) { this.index.set(i); this.play(run); return; }
    if (!this.onFinished()) this.finish();
  }
  private async play(run: number) {
    const i = this.index(), seg = this.segments[i];
    if (!seg) { this.finish(); return; }
    if (this.audio) { this.audio.pause(); this.audio = null; }
    this.onSegment(i);
    this.state.set('loading');
    try {
      const url = await this.fetch(seg.text);
      if (run !== this.run) return;
      for (const n of [i + 1, i + 2]) if (this.segments[n]) this.fetch(this.segments[n].text).catch(() => {});
      const a = new Audio(url); a.playbackRate = this.rate; a.preservesPitch = true;
      a.onended = () => this.zone.run(() => { if (this.audio === a) this.next(run); });
      a.onerror = () => this.zone.run(() => { if (this.audio === a) this.fail(run); });
      this.audio = a; await a.play();
      if (run === this.run) this.state.set('playing');
    } catch { this.fail(run); }
  }
  private fail(run: number) {
    if (run !== this.run) return;
    this.run++; this.audio = null; this.state.set('unavailable'); this.onSegment(null);
  }
  /** Audio of one sentence in the chosen voice: memory cache, request on the way, or a new request. */
  private fetch(text: string): Promise<string> {
    const key = this.voiceId + '\u0000' + text;
    const hit = this.cache.get(key); if (hit) return Promise.resolve(hit);
    let p = this.pending.get(key);
    if (!p) {
      p = fetch('/api/tts', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionStorage.getItem('token')}, body: JSON.stringify({text, voice: this.voiceId})})
        .then(async r => {
          if (!r.ok) throw new Error('tts ' + r.status);
          const url = URL.createObjectURL(await r.blob());
          if (this.cache.size > 300) { const [k, u] = this.cache.entries().next().value!; URL.revokeObjectURL(u); this.cache.delete(k); }
          this.cache.set(key, url); return url;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }
}

/** Sentences of the rendered reading text, with their place on the page. Reads headings, paragraphs and list items in
 *  page order; tables are skipped (numbers read aloud cell by cell do not help). The page itself is not changed. */
export function segmentsOf(root: HTMLElement): Segment[] {
  const sel = 'h2, h3, h4, p, li, blockquote';
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(b => !b.querySelector(sel) && !b.closest('table'));
  const out: Segment[] = [];
  for (const b of blocks) {
    const nodes: {node: Text; start: number}[] = []; let all = '';
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) { nodes.push({node: n, start: all.length}); all += n.data; }
    const at = (pos: number): [Text, number] => {
      let k = nodes.length - 1; while (k > 0 && nodes[k].start > pos) k--;
      return [nodes[k].node, Math.min(pos - nodes[k].start, nodes[k].node.data.length)];
    };
    const re = /[^.!?…]+(?:[.!?…]+["”»)]*|$)/g;
    for (let m = re.exec(all); m; m = re.exec(all)) {
      if (!m[0]) { re.lastIndex++; continue; }
      const lead = m[0].length - m[0].trimStart().length, text = m[0].trim();
      if (!/[\p{L}\p{N}]/u.test(text) || !nodes.length) continue;
      const r = document.createRange();
      const [sn, so] = at(m.index + lead), [en, eo] = at(m.index + lead + text.length);
      r.setStart(sn, so); r.setEnd(en, eo);
      out.push({text, range: r});
    }
  }
  return out;
}

/** Letters folded one by one (case and accents) so positions in the folded text match the original text. */
export const fold = (s: string) => Array.from(s, c => (c.normalize('NFD')[0] || c).toLowerCase()).join('');

/** Every match of the query inside the root's text, as ranges (search on the page, nothing is changed). */
export function findRanges(root: HTMLElement, query: string): Range[] {
  const q = fold(query.trim()); if (q.length < 2) return [];
  const nodes: {node: Text; start: number}[] = []; let all = '';
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) { nodes.push({node: n, start: all.length}); all += n.data; }
  const text = fold(all), out: Range[] = [];
  const at = (pos: number, end = false): [Text, number] => {
    let k = nodes.length - 1; while (k > 0 && (end ? nodes[k].start >= pos : nodes[k].start > pos)) k--;
    return [nodes[k].node, pos - nodes[k].start];
  };
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
    const r = document.createRange(); const [sn, so] = at(i), [en, eo] = at(i + q.length, true);
    r.setStart(sn, so); r.setEnd(en, Math.min(eo, en.data.length)); out.push(r);
  }
  return out;
}
export function countIn(text: string, query: string) {
  const q = fold(query.trim()); if (q.length < 2) return 0;
  const t = fold(text); let n = 0;
  for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) n++;
  return n;
}

/** Sets a named text highlight (CSS Custom Highlight API) without touching the page; no-op where unsupported. */
export function highlight(name: string, ranges: Range[]) {
  const reg = (globalThis as any).CSS?.highlights, H = (globalThis as any).Highlight;
  if (!reg || !H) return;
  if (ranges.length) reg.set(name, new H(...ranges)); else reg.delete(name);
}
