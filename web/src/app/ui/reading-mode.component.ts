import {AfterViewChecked, Component, ElementRef, HostListener, Injectable, NgZone, OnDestroy, ViewChild, computed, effect, inject, signal, untracked} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import {IconComponent} from './icon.component';
import {Api} from '../api.service';
import {Reader} from '../reader.service';
import {Narrator, SERVER_VOICE, countIn, findRanges, highlight, segmentsOf} from './reading-narrator';

export interface ReadingDoc {
  title: string;
  /** Small line above the title (e.g. "Seção 04"). */
  subtitle?: string;
  /** Number shown in the index (e.g. "04"). */
  num?: string;
  /** Status kept by the system (e.g. approved); shown only when it exists. Reading never changes it. */
  status?: {label: string; css: string};
  /** Plain text: blank lines separate paragraphs. */
  text?: string;
  /** Formatted text from the editor (already sanitised by the caller's own pipeline). */
  html?: string;
  /** Id the caller uses for this text (e.g. the section key), passed back by "Editar". */
  key?: string;
}

/** Opens texts in the full-window reading mode. Display only: nothing is changed or saved.
 *  `reading.open(doc)` for one text, or `reading.open(list, i, context)` for a series (the report's sections);
 *  `context` (e.g. the evaluation id) lets the mode offer to go back to where the person stopped, in this session. */
@Injectable({providedIn: 'root'})
export class ReadingService {
  readonly list = signal<ReadingDoc[]>([]);
  readonly index = signal(0);
  readonly doc = computed<ReadingDoc | null>(() => this.list()[this.index()] || null);
  context = '';
  /** Set by the caller when the texts can be edited: "Editar" in the bar calls it with the key of the text on screen. */
  onEdit: ((key: string) => void) | null = null;
  /** Set by the caller when the Word preview can be shown: "Ver documento" calls it with the key on screen. */
  onDocument: ((key: string) => void) | null = null;
  /** True while a layer of the caller is over the reading mode (e.g. the Word preview): keys are left to it. */
  readonly covered = signal(false);
  /** Last place read per context (memory only, this session): section title and scroll fraction. */
  private static LAST = 'nl.reading.last';
  /** Last place read per context (evaluation): section title and scroll fraction, kept in this browser. */
  lastOf(context: string): {title: string; frac: number} | undefined {
    try { return JSON.parse(localStorage.getItem(ReadingService.LAST) || '{}')[context]; } catch { return undefined; }
  }
  setLast(context: string, spot: {title: string; frac: number}) {
    try {
      const all = JSON.parse(localStorage.getItem(ReadingService.LAST) || '{}');
      delete all[context]; all[context] = spot;
      const keys = Object.keys(all); for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete all[k];
      localStorage.setItem(ReadingService.LAST, JSON.stringify(all));
    } catch {}
  }
  open(d: ReadingDoc | ReadingDoc[], at = 0, context = '', onEdit: ((key: string) => void) | null = null, onDocument: ((key: string) => void) | null = null) {
    this.onEdit = onEdit; this.onDocument = onDocument;
    const all = (Array.isArray(d) ? d : [d]).filter(x => (x.text || '').trim() || (x.html || '').trim());
    if (!all.length) return;
    const target = Array.isArray(d) ? d[at] : d;
    this.context = context;
    this.list.set(all); this.index.set(Math.max(0, all.indexOf(target)));
  }
  go(i: number) { if (i >= 0 && i < this.list().length) this.index.set(i); }
  close() { this.list.set([]); this.index.set(0); this.onEdit = null; this.onDocument = null; }
}

type Item = {text: string; label?: string};
type Block = {kind: 'h' | 'p' | 'note'; text: string; label?: string} | {kind: 'list'; items: Item[]};

const LABEL = /^([A-Za-zÀ-ÿ][^:\n]{1,38}):\s*(.*)$/;
const isCaps = (s: string) => s.length <= 90 && /[A-ZÀ-Ý]/.test(s) && s === s.toUpperCase();
const SHORT = 180;
/** A paragraph longer than this is shown in smaller parts of a few sentences. */
const LONG = 520;

/** Splits a long paragraph at sentence ends into parts of about three sentences (display only, words unchanged). */
function chunks(text: string): string[] {
  if (text.length <= LONG) return [text];
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["”»)]*\s*|$)/g)?.map(s => s.trim()).filter(Boolean) || [text];
  const out: string[] = []; let cur = '';
  for (const s of sentences) {
    cur = cur ? cur + ' ' + s : s;
    if (cur.length >= 280) { out.push(cur); cur = ''; }
  }
  if (cur) { if (out.length && cur.length < 120) out[out.length - 1] += ' ' + cur; else out.push(cur); }
  return out;
}

/** Arranges a plain text for reading: "## " lines and "Rótulo:" lines with nothing after become headings, "Rótulo: texto"
 *  keeps the label in bold, all-caps lines stand out as notes, runs of two or more short lines (notes taken line by line)
 *  become a list, and very long paragraphs are shown in parts of a few sentences. Every word stays as written. */
export function organise(text: string): Block[] {
  const out: Block[] = [];
  const lines = (text || '').split('\n').map(l => l.replace(/\*\*(.+?)\*\*/g, '$1').trim()).filter(Boolean);
  let list: Item[] = [];
  const para = (it: Item) => chunks(it.text).forEach((c, i) => out.push({kind: 'p', text: c, label: i ? undefined : it.label}));
  const flush = () => { if (list.length > 1) out.push({kind: 'list', items: list}); else if (list.length) para(list[0]); list = []; };
  for (const l of lines) {
    if (/^#{1,6}\s/.test(l)) { flush(); out.push({kind: 'h', text: l.replace(/^#{1,6}\s*/, '')}); continue; }
    const m = LABEL.exec(l);
    if (m && !m[2]) { flush(); out.push({kind: 'h', text: m[1]}); continue; }
    if (isCaps(l) && !m) { flush(); out.push({kind: 'note', text: l}); continue; }
    const item = m ? {label: m[1], text: m[2]} : {text: l};
    if (l.length > SHORT) { flush(); para(item); continue; }
    list.push(item);
  }
  flush();
  return out;
}

type Theme = 'light' | 'sepia' | 'dark';
type Width = 'narrow' | 'normal' | 'wide' | 'xwide' | 'full';
type Prefs = {side: boolean; font: string; size: number; line: number; width: Width; theme: Theme; organised: boolean; autoSpeed: number;
  rate: number; voice: string; follow: boolean; scope: 'section' | 'all'};
const DEFAULTS: Prefs = {side: true, font: 'app', size: 19, line: 1.6, width: 'normal', theme: 'light', organised: true, autoSpeed: 40,
  rate: 1, voice: '', follow: true, scope: 'section'};
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
/** Fonts already installed in Windows (nothing is downloaded); 'app' is the font of the system itself. */
export const FONTS: {id: string; name: string; family: string; serif: boolean}[] = [
  {id: 'app', name: 'Padrão do sistema', family: 'var(--font)', serif: false},
  {id: 'arial', name: 'Arial', family: 'Arial, Helvetica, sans-serif', serif: false},
  {id: 'verdana', name: 'Verdana', family: 'Verdana, Geneva, sans-serif', serif: false},
  {id: 'calibri', name: 'Calibri', family: 'Calibri, Carlito, sans-serif', serif: false},
  {id: 'segoe', name: 'Segoe UI', family: "'Segoe UI', system-ui, sans-serif", serif: false},
  {id: 'tahoma', name: 'Tahoma', family: 'Tahoma, Verdana, sans-serif', serif: false},
  {id: 'trebuchet', name: 'Trebuchet MS', family: "'Trebuchet MS', sans-serif", serif: false},
  {id: 'georgia', name: 'Georgia', family: 'Georgia, serif', serif: true},
  {id: 'times', name: 'Times New Roman', family: "'Times New Roman', Times, serif", serif: true},
  {id: 'cambria', name: 'Cambria', family: 'Cambria, Caladea, serif', serif: true},
  {id: 'palatino', name: 'Palatino Linotype', family: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", serif: true},
];
const LINES = [1.4, 1.6, 1.8, 2];
/** Text column widths; `pct` is only for the small preview drawing in the width menu. */
export const WIDTHS: {id: Width; name: string; hint: string; pct: number}[] = [
  {id: 'narrow', name: 'Estreita', hint: 'cerca de 58 letras por linha', pct: 38},
  {id: 'normal', name: 'Confortável', hint: 'cerca de 70 letras por linha', pct: 50},
  {id: 'wide', name: 'Ampla', hint: 'cerca de 96 letras por linha', pct: 66},
  {id: 'xwide', name: 'Muito ampla', hint: 'cerca de 130 letras por linha', pct: 84},
  {id: 'full', name: 'Toda a largura', hint: 'ocupa toda a área de leitura', pct: 100}];
const plainOf = (d: ReadingDoc) => d.text || (d.html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

@Component({
  selector: 'nl-reading-mode',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './reading-mode.component.html',
  styleUrl: './reading-mode.component.css',
})
export class ReadingModeComponent implements AfterViewChecked, OnDestroy {
  readonly r = inject(ReadingService);
  private san = inject(DomSanitizer);
  private api = inject(Api);
  private zone = inject(NgZone);
  private reader = inject(Reader);
  @ViewChild('root') root?: ElementRef<HTMLElement>;
  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;
  @ViewChild('body') body?: ElementRef<HTMLElement>;
  @ViewChild('exitBtn') exitBtn?: ElementRef<HTMLButtonElement>;
  @ViewChild('searchBox') searchBox?: ElementRef<HTMLInputElement>;

  readonly RATES = RATES; readonly LINES = LINES; readonly WIDTHS = WIDTHS;
  readonly sansFonts = FONTS.filter(f => !f.serif); readonly serifFonts = FONTS.filter(f => f.serif);
  family() { return (FONTS.find(f => f.id === this.prefs().font) || FONTS[0]).family; }
  readonly prefs = signal<Prefs>(DEFAULTS);
  readonly progress = signal(0);
  readonly sideOpen = signal(true);
  readonly narrow = signal(false);
  readonly panel = signal<'' | 'look' | 'more' | 'width'>('');
  readonly searchOpen = signal(false);
  readonly full = signal(false);
  readonly fullOk = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  readonly autoOn = signal(false);
  readonly autoPaused = signal(false);
  readonly resumeOffer = signal<{title: string; index: number; frac: number} | null>(null);
  query = '';
  readonly hits = signal<{doc: number; nth: number}[]>([]);
  readonly hitAt = signal(-1);
  readonly narrator = new Narrator(this.zone);
  private opened = false;
  private returnTo: Element | null = null;
  private renderedFor: ReadingDoc | null = null;
  private pendingScroll: {frac?: number; nth?: number; continueReading?: boolean} | null = null;
  private raf = 0; private rafLast = 0; private carry = 0;
  private fullAt = 0;

  readonly blocks = computed(() => organise(this.r.doc()?.text || ''));
  readonly plain = computed(() => (this.r.doc()?.text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean));
  readonly safeHtml = computed((): SafeHtml => this.san.bypassSecurityTrustHtml(this.r.doc()?.html || ''));
  private readonly count = computed(() => { const d = this.r.doc(); return d ? (plainOf(d).match(/\S+/g) || []).length : 0; });

  constructor() {
    // a new text on screen: reset the speech to it (whole-report reading continues by itself)
    effect(() => {
      const d = this.r.doc();
      untracked(() => {
        if (!d) { if (this.opened) this.onClose(); return; }
        if (!this.opened) this.onOpen();
      });
    });
    this.narrator.onSegment = i => this.showSegment(i);
    this.narrator.onFinished = () => {
      if (this.prefs().scope !== 'all' || this.r.index() >= this.r.list().length - 1) return false;
      this.pendingScroll = {frac: 0, continueReading: true};
      this.r.go(this.r.index() + 1);
      return true;
    };
  }

  // ---------- open / close ----------
  private prefKey() { return 'nl.reading.' + (this.api.me()?.id || 'anon'); }
  private onOpen() {
    this.opened = true; this.returnTo = document.activeElement;
    // the page behind stays still: the mouse wheel only moves the reading text
    document.documentElement.classList.add('nl-reading-open');
    try {
      const saved = JSON.parse(localStorage.getItem(this.prefKey()) || '{}');
      if (!saved.font && saved.serif) saved.font = 'georgia';
      this.prefs.set({...DEFAULTS, ...saved});
    } catch { this.prefs.set(DEFAULTS); }
    const p = this.prefs(); this.narrator.rate = p.rate; this.narrator.voiceId = p.voice;
    this.narrator.loadVoices();
    this.reader.stop();   // never two narrations: the section's "Ouvir texto" player stops
    this.checkWidth(); this.sideOpen.set(!this.narrow() && this.prefs().side);
    const last = this.r.context ? this.r.lastOf(this.r.context) : undefined;
    const at = last ? this.r.list().findIndex(d => d.title === last.title) : -1;
    this.resumeOffer.set(at >= 0 && (at !== this.r.index() || last!.frac > 0.05) ? {title: last!.title, index: at, frac: last!.frac} : null);
    this.renderedFor = null; this.progress.set(0);
    setTimeout(() => this.exitBtn?.nativeElement.focus());
  }
  private onClose() {
    this.opened = false;
    document.documentElement.classList.remove('nl-reading-open');
    this.narrator.stop(); this.stopAuto();
    highlight('nl-speak', []); highlight('nl-search', []); highlight('nl-search-cur', []);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.panel.set(''); this.searchOpen.set(false); this.query = ''; this.hits.set([]); this.hitAt.set(-1);
    const el = this.returnTo as HTMLElement | null; if (el?.isConnected) setTimeout(() => el.focus());
  }
  close() { this.saveSpot(); this.r.close(); }
  canEdit() { return !!this.r.onEdit && !!this.r.doc()?.key; }
  canDocument() { return !!this.r.onDocument && !!this.r.doc()?.key; }
  /** The Word as it is turning out, over the reading mode (closing it comes back here). */
  document() { const k = this.r.doc()?.key, go = this.r.onDocument; if (!k || !go) return; this.narrator.pause(); this.pauseAuto(); go(k); }
  /** Leaves the reading mode and opens the edit mode on the text on screen. */
  edit() { const k = this.r.doc()?.key, go = this.r.onEdit; if (!k || !go) return; this.close(); go(k); }
  ngOnDestroy() { this.narrator.destroy(); this.stopAuto(); }

  /** After each render of a new section: speech segments, search marks, scroll position. */
  ngAfterViewChecked() {
    const d = this.r.doc();
    if (!d || !this.body || this.renderedFor === d) return;
    this.renderedFor = d;
    const segs = segmentsOf(this.body.nativeElement);
    const ps = this.pendingScroll; this.pendingScroll = null;
    const el = this.scroller?.nativeElement;
    if (ps?.continueReading) this.narrator.continueWith(segs); else this.narrator.load(segs);
    if (el) el.scrollTop = ps?.frac ? ps.frac * Math.max(0, el.scrollHeight - el.clientHeight) : 0;
    setTimeout(() => {
      this.markSearch(ps?.nth);
      this.onScroll();
    });
  }

  // ---------- header info ----------
  words() { return this.count(); }
  minutes() { return Math.max(1, Math.round(this.count() / 200)); }
  useHtml() { const d = this.r.doc(); return !!d?.html && (!d.text || !this.prefs().organised); }
  titleAt(step: number) { const d: ReadingDoc | undefined = this.r.list()[this.r.index() + step]; return d ? d.title : ''; }

  // ---------- preferences ----------
  set(p: Partial<Prefs>) {
    const v = {...this.prefs(), ...p}; v.size = Math.min(28, Math.max(14, v.size)); v.autoSpeed = Math.min(160, Math.max(10, v.autoSpeed));
    this.prefs.set(v);
    try { localStorage.setItem(this.prefKey(), JSON.stringify(v)); } catch {}
    if ('organised' in p) { this.renderedFor = null; this.pendingScroll = {frac: this.frac()}; }
  }
  resetPrefs() { this.set({...DEFAULTS}); this.narrator.setRate(DEFAULTS.rate); }
  togglePanel(p: 'look' | 'more' | 'width') {
    this.previewWidth.set(''); this.panel.set(this.panel() === p ? '' : p); }

  // ---------- sections ----------
  goTo(i: number) {
    if (i < 0 || i >= this.r.list().length || i === this.r.index()) { if (this.narrow()) this.sideOpen.set(false); return; }
    this.narrator.stop(); this.pendingScroll = {frac: 0};
    this.r.go(i); this.resumeOffer.set(null);
    if (this.narrow()) this.sideOpen.set(false);
  }
  resume() { const o = this.resumeOffer(); if (!o) return; this.resumeOffer.set(null); this.narrator.stop(); this.pendingScroll = {frac: o.frac}; if (o.index === this.r.index()) { this.renderedFor = null; } this.r.go(o.index); }
  private frac() { const el = this.scroller?.nativeElement; if (!el) return 0; const max = el.scrollHeight - el.clientHeight; return max > 0 ? el.scrollTop / max : 0; }
  private spotTimer: any;
  private saveSpot() {
    clearTimeout(this.spotTimer);
    this.spotTimer = setTimeout(() => { const d = this.r.doc(); if (d && this.r.context) this.r.setLast(this.r.context, {title: d.title, frac: this.frac()}); }, 400);
  }
  onScroll() {
    const n = this.r.list().length || 1;
    this.progress.set(Math.min(100, (this.r.index() + this.frac()) / n * 100));
    this.saveSpot();
  }

  // ---------- full screen ----------
  async toggleFull() {
    if (!this.fullOk) return;
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await this.root?.nativeElement.requestFullscreen(); } catch {}
  }
  @HostListener('document:fullscreenchange') onFullChange() { this.full.set(!!document.fullscreenElement); this.fullAt = Date.now(); }

  // ---------- search ----------
  toggleSearch() {
    const open = !this.searchOpen(); this.searchOpen.set(open); this.panel.set('');
    if (open) setTimeout(() => this.searchBox?.nativeElement.focus()); else { this.query = ''; this.runSearch(); }
  }
  runSearch() {
    const q = this.query, list = this.r.list(), out: {doc: number; nth: number}[] = [];
    list.forEach((d, i) => { const n = countIn(plainOf(d), q); for (let k = 0; k < n; k++) out.push({doc: i, nth: k}); });
    this.hits.set(out);
    const first = out.findIndex(h => h.doc >= this.r.index());
    this.hitAt.set(out.length ? (first >= 0 ? first : 0) : -1);
    this.markSearch(undefined, true);
  }
  searchStep(d: number) {
    const n = this.hits().length; if (!n) return;
    this.hitAt.set((this.hitAt() + d + n) % n); this.showHit();
  }
  private showHit() {
    const h = this.hits()[this.hitAt()]; if (!h) return;
    if (h.doc !== this.r.index()) { this.narrator.stop(); this.pendingScroll = {frac: 0, nth: h.nth}; this.r.go(h.doc); return; }
    this.markSearch(h.nth);
  }
  /** Marks the matches on the page and brings the current one into view. */
  private markSearch(nth?: number, scroll = false) {
    if (!this.body) return;
    const ranges = this.searchOpen() ? findRanges(this.body.nativeElement, this.query) : [];
    const h = this.hits()[this.hitAt()];
    const cur = nth ?? (h && h.doc === this.r.index() ? h.nth : -1);
    const r = ranges[Math.min(cur, ranges.length - 1)];
    highlight('nl-search', ranges.filter(x => x !== r)); highlight('nl-search-cur', r && cur >= 0 ? [r] : []);
    if (r && cur >= 0 && (scroll || nth !== undefined)) this.reveal(r, true);
  }

  // ---------- reading aloud ----------
  playPause() {
    const s = this.narrator.state();
    if (s === 'playing' || s === 'loading') this.narrator.pause();
    else if (s === 'paused') this.narrator.resume();
    else { this.reader.stop(); this.pauseAuto(); this.narrator.start(s === 'done' ? 0 : this.narrator.index()); }
  }
  stateLabel() {
    return ({ready: 'Pronto', loading: 'Preparando a voz…', playing: 'Lendo', paused: 'Pausado', done: 'Concluído',
      unavailable: 'Voz indisponível agora: tente outra voz'} as const)[this.narrator.state()];
  }
  setRate(v: string | number) { const r = Number(v); this.set({rate: r}); this.narrator.setRate(r); }
  setVoice(id: string) { this.set({voice: id}); this.narrator.setVoice(id); }
  onlineVoices() { return this.narrator.voices().filter(v => !v.local); }
  localVoices() { return this.narrator.voices().filter(v => v.local); }
  private showSegment(i: number | null) {
    const s = i === null ? undefined : this.narrator.segment(i);
    highlight('nl-speak', s ? [s.range] : []);
    if (s && this.prefs().follow) this.reveal(s.range, false);
  }
  /** Brings a range into the middle band of the reading area, smoothly; leaves it alone when already visible. */
  private reveal(range: Range, center: boolean) {
    const el = this.scroller?.nativeElement; if (!el) return;
    const box = el.getBoundingClientRect(), rect = range.getBoundingClientRect();
    if (!rect.height) return;
    const top = box.top + box.height * 0.18, bottom = box.top + box.height * 0.7;
    if (!center && rect.top >= top && rect.bottom <= bottom) return;
    const target = el.scrollTop + rect.top - box.top - box.height * 0.35;
    el.scrollTo({top: Math.max(0, target), behavior: this.reduced() ? 'auto' : 'smooth'});
  }
  private reduced() { return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  speaking() { const s = this.narrator.state(); return s === 'playing' || s === 'loading'; }

  // ---------- automatic scrolling (works without audio) ----------
  toggleAuto() { if (this.autoOn() && !this.autoPaused()) this.stopAuto(); else this.startAuto(); }
  startAuto() {
    const el = this.scroller?.nativeElement; if (!el) return;
    if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) el.scrollTop = 0;
    this.autoOn.set(true); this.autoPaused.set(false); this.carry = 0; this.rafLast = 0;
    cancelAnimationFrame(this.raf);
    this.zone.runOutsideAngular(() => { this.raf = requestAnimationFrame(t => this.tick(t)); });
  }
  stopAuto() { cancelAnimationFrame(this.raf); this.raf = 0; this.autoOn.set(false); this.autoPaused.set(false); }
  pauseAuto() { if (this.autoOn()) { cancelAnimationFrame(this.raf); this.raf = 0; this.autoPaused.set(true); } }
  private tick(t: number) {
    const el = this.scroller?.nativeElement;
    if (!el || !this.autoOn() || this.autoPaused()) return;
    const dt = this.rafLast ? Math.min(100, t - this.rafLast) : 0; this.rafLast = t;
    // following the narrated sentence wins while the voice reads: no tug of war between the two
    if (!(this.speaking() && this.prefs().follow)) {
      this.carry += this.prefs().autoSpeed * dt / 1000;
      const px = Math.floor(this.carry);
      if (px) { el.scrollTop += px; this.carry -= px; }
      if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) { this.zone.run(() => this.stopAuto()); return; }
    }
    this.raf = requestAnimationFrame(n => this.tick(n));
  }
  /** The person scrolls by hand: automatic scrolling pauses and offers to resume. */
  manualScroll() { if (this.autoOn() && !this.autoPaused()) this.pauseAuto(); }
  @HostListener('document:visibilitychange') onHidden() { if (document.hidden) this.pauseAuto(); }

  // ---------- layout ----------
  @HostListener('window:resize') checkWidth() {
    const n = window.innerWidth < 900; if (n !== this.narrow()) { this.narrow.set(n); this.sideOpen.set(!n && this.prefs().side); }
  }
  toggleSide() { this.sideOpen.set(!this.sideOpen()); if (!this.narrow()) this.set({side: this.sideOpen()}); }
  /** Top-bar menu: the text widths, each with a small preview. */
  /** Width shown while the pointer or focus is on an option of the menu (live preview, not saved). */
  readonly previewWidth = signal<Width | ''>('');
  shownWidth() { return this.previewWidth() || this.prefs().width; }
  pickWidth(id: Width) { this.previewWidth.set(''); this.set({width: id}); this.panel.set(''); }
  widthName() { return WIDTHS.find(w => w.id === this.prefs().width)?.name || ''; }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (!this.r.doc() || this.r.covered()) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName || '');
    if (e.key === 'Escape') {
      e.preventDefault();
      // full screen first (the browser may already have left it with this same key), then panels, then the mode
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      if (Date.now() - this.fullAt < 400) return;
      if (this.panel()) { this.panel.set(''); this.previewWidth.set(''); return; }
      if (this.searchOpen()) { this.toggleSearch(); return; }
      if (this.narrow() && this.sideOpen()) { this.sideOpen.set(false); return; }
      this.close(); return;
    }
    if (typing) { if (e.key === 'Enter' && (e.target as HTMLElement) === this.searchBox?.nativeElement) { e.preventDefault(); this.searchStep(e.shiftKey ? -1 : 1); } return; }
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) this.manualScroll();
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.goTo(this.r.index() + (e.key === 'ArrowLeft' ? -1 : 1)); return; }
    if (e.key === 'f' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!this.searchOpen()) this.toggleSearch(); else this.searchBox?.nativeElement.focus(); return; }
    if (e.key !== 'Tab' || !this.root) return;
    const f = Array.from(this.root.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled]), select, input, [tabindex="0"]')).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}
