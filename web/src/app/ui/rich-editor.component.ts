import {AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, ViewChild, ViewEncapsulation, inject} from '@angular/core';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import {sanitizeHtml, textFromHtml} from '../rich-text';

/** Toolbar icons (24px grid, currentColor). Static strings, never user content. */
const ICONS: Record<string, string> = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  left: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  center: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  right: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  justify: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  ul: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  ol: '<path d="M10 6h10M10 12h10M10 18h10M4 4v4M3 8h2M3 12.5c.5-.8 2-.8 2 .2 0 .8-2 1.3-2 2.3h2M3 17h2v3H3"/>',
  outdent: '<path d="M4 6h16M11 10h9M11 14h9M4 18h16M8 9l-3 3 3 3"/>',
  indent: '<path d="M4 6h16M11 10h9M11 14h9M4 18h16M5 9l3 3-3 3"/>',
  clear: '<path d="M6 5h12M12 5l-3 14M4 20h8M15 15l5 5M20 15l-5 5"/>',
};
const BLOCK = 'p,h3,li';

/**
 * Rich text editor with a full formatting toolbar. Emits sanitized HTML (htmlChange) and the matching plain text
 * (textChange). Everything in the toolbar is read by the Word export (worker/docx_worker.py, rich blocks).
 * Undo/redo keeps its own snapshots, so paragraph formatting (spacing, indent) also undoes.
 */
@Component({
  selector: 'nl-rich-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="rte" [class.ro]="readOnly">
      <div class="rte-bar" role="toolbar" aria-label="Formatação do texto" (mousedown)="keepSelection($event)">
        <select class="rte-sel" aria-label="Estilo do parágrafo" title="Estilo do parágrafo" (change)="block($any($event.target).value); $any($event.target).value=''">
          <option value="">Estilo</option><option value="p">Parágrafo</option><option value="h3">Título do tópico</option>
        </select>
        <select class="rte-sel" aria-label="Tamanho da fonte" title="Tamanho da fonte" (change)="fontSize($any($event.target).value); $any($event.target).value=''">
          <option value="">Tamanho</option>@for (s of sizes; track s) {<option [value]="s">{{s}} pt</option>}
        </select>
        <span class="rte-sep"></span>
        <button type="button" title="Negrito (Ctrl+B)" aria-label="Negrito" (click)="cmd('bold')"><b>B</b></button>
        <button type="button" title="Itálico (Ctrl+I)" aria-label="Itálico" (click)="cmd('italic')"><i>I</i></button>
        <button type="button" title="Sublinhado (Ctrl+U)" aria-label="Sublinhado" (click)="cmd('underline')"><u>U</u></button>
        <button type="button" title="Tachado" aria-label="Tachado" (click)="cmd('strikeThrough')"><s>S</s></button>
        <label class="rte-color" title="Cor do texto"><span style="text-decoration:underline 3px">A</span><input type="color" aria-label="Cor do texto" value="#c00000" (change)="cmd('foreColor', $any($event.target).value)"></label>
        <label class="rte-color" title="Realce"><span class="hl">ab</span><input type="color" aria-label="Cor de realce" value="#ffff00" (change)="cmd('hiliteColor', $any($event.target).value)"></label>
        <span class="rte-sep"></span>
        <button type="button" title="Alinhar à esquerda" aria-label="Alinhar à esquerda" (click)="align('left')" [innerHTML]="icon('left')"></button>
        <button type="button" title="Centralizar" aria-label="Centralizar" (click)="align('center')" [innerHTML]="icon('center')"></button>
        <button type="button" title="Alinhar à direita" aria-label="Alinhar à direita" (click)="align('right')" [innerHTML]="icon('right')"></button>
        <button type="button" title="Justificar" aria-label="Justificar" (click)="align('justify')" [innerHTML]="icon('justify')"></button>
        <span class="rte-sep"></span>
        <select class="rte-sel" aria-label="Espaçamento entre linhas" title="Espaçamento entre linhas" (change)="blockStyle('line-height', $any($event.target).value); $any($event.target).value=''">
          <option value="">Entre linhas</option>@for (l of lines; track l) {<option [value]="l">{{l.replace('.', ',')}}</option>}
        </select>
        <select class="rte-sel" aria-label="Espaço antes do parágrafo" title="Espaço antes do parágrafo" (change)="blockStyle('margin-top', $any($event.target).value); $any($event.target).value=''">
          <option value="">Antes</option>@for (s of gaps; track s) {<option [value]="s + 'pt'">{{s}} pt</option>}
        </select>
        <select class="rte-sel" aria-label="Espaço depois do parágrafo" title="Espaço depois do parágrafo" (change)="blockStyle('margin-bottom', $any($event.target).value); $any($event.target).value=''">
          <option value="">Depois</option>@for (s of gaps; track s) {<option [value]="s + 'pt'">{{s}} pt</option>}
        </select>
        <button type="button" title="Diminuir recuo" aria-label="Diminuir recuo" (click)="indent(-1)" [innerHTML]="icon('outdent')"></button>
        <button type="button" title="Aumentar recuo" aria-label="Aumentar recuo" (click)="indent(1)" [innerHTML]="icon('indent')"></button>
        <span class="rte-sep"></span>
        <button type="button" title="Lista com marcadores" aria-label="Lista com marcadores" (click)="cmd('insertUnorderedList')" [innerHTML]="icon('ul')"></button>
        <button type="button" title="Lista numerada" aria-label="Lista numerada" (click)="cmd('insertOrderedList')" [innerHTML]="icon('ol')"></button>
        <span class="rte-sep"></span>
        <button type="button" title="Desfazer (Ctrl+Z)" aria-label="Desfazer" (click)="undo()" [innerHTML]="icon('undo')"></button>
        <button type="button" title="Refazer (Ctrl+Y)" aria-label="Refazer" (click)="redo()" [innerHTML]="icon('redo')"></button>
        <button type="button" title="Limpar formatação" aria-label="Limpar formatação" (click)="clearFormat()" [innerHTML]="icon('clear')"></button>
      </div>
      <div #area class="rte-area draft editing" [attr.contenteditable]="readOnly ? 'false' : 'true'" role="textbox" aria-multiline="true" [attr.aria-label]="label"
        (beforeinput)="typing()" (input)="changed()" (keydown)="keys($event)" (paste)="paste($event)" (blur)="flush()"></div>
    </div>`,
  styles: [`
    nl-rich-editor{display:block}
    .rte{border:1px solid var(--border-input);border-radius:var(--radius-sm);background:var(--card)}
    .rte-bar{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:6px;border-bottom:1px solid var(--border);background:var(--surface-2, var(--card));border-radius:var(--radius-sm) var(--radius-sm) 0 0;position:sticky;top:0;z-index:2}
    .rte-bar button,.rte-color{min-width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:6px;background:none;color:var(--text-2);cursor:pointer;font-size:14px;padding:0 6px;position:relative}
    .rte-bar button:hover,.rte-color:hover{background:var(--primary-soft);color:var(--primary-text)}
    .rte-bar button:focus-visible,.rte-sel:focus-visible{outline:none;box-shadow:0 0 0 3px var(--ring)}
    .rte-bar svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
    .rte-sel{height:30px;border:1px solid var(--border-input);border-radius:6px;background:var(--card);color:var(--text-2);font-size:12.5px;padding:0 4px;max-width:120px}
    .rte-sep{width:1px;height:20px;background:var(--border);margin:0 4px}
    .rte-color input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
    .rte-color .hl{background:#ff0;color:#000;padding:0 2px;border-radius:2px}
    .rte-area{min-height:320px;max-height:70vh;overflow:auto;padding:14px 16px;outline:none;line-height:1.6;border:0 !important;border-radius:0 0 var(--radius-sm) var(--radius-sm)}
    .rte-area:focus{box-shadow:inset 0 0 0 2px var(--ring)}
    .rte-area p,.rte-area h3{margin:0 0 .6em}
    .rte-area h3{font-size:inherit;font-weight:700}
    .rte-area ul,.rte-area ol{margin:0 0 .6em;padding-left:1.6em}
    .rte.ro .rte-bar{display:none}
    @media (max-width:560px){.rte-sel{max-width:96px}}
  `],
})
export class RichEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  private sanitizer = inject(DomSanitizer);
  @ViewChild('area', {static: true}) area!: ElementRef<HTMLDivElement>;
  /** Initial HTML; changing it from outside resets the content (and the undo history). */
  @Input() html = '';
  @Input() readOnly = false;
  @Input() label = 'Texto';
  @Output() htmlChange = new EventEmitter<string>();
  @Output() textChange = new EventEmitter<string>();
  readonly sizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24];
  readonly lines = ['1', '1.15', '1.5', '2'];
  readonly gaps = [0, 3, 6, 12, 18, 24];
  private last = '';
  private history: string[] = [];
  private future: string[] = [];
  private snapTimer: any;
  private range: Range | null = null;
  private icons: Record<string, SafeHtml> = {};

  icon(n: string) {
    return this.icons[n] ??= this.sanitizer.bypassSecurityTrustHtml(`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`);
  }

  ngAfterViewInit() { this.load(); document.addEventListener('selectionchange', this.track); }
  ngOnChanges() { if (this.area && this.html !== this.last) this.load(); }
  ngOnDestroy() { document.removeEventListener('selectionchange', this.track); clearTimeout(this.snapTimer); }

  focus() { this.area.nativeElement.focus(); }

  /** Inserts plain text at the cursor (snippets, pasted answers). */
  insertText(t: string) {
    this.restore(); this.snapshot();
    document.execCommand('insertText', false, t);
    this.changed();
  }

  private load() {
    const clean = sanitizeHtml(this.html || '');
    this.area.nativeElement.innerHTML = clean || '<p><br></p>';
    this.last = this.html; this.history = []; this.future = [];
  }

  private readonly track = () => {
    const s = document.getSelection();
    if (s && s.rangeCount && this.area.nativeElement.contains(s.anchorNode)) this.range = s.getRangeAt(0).cloneRange();
  };
  private restore() {
    const el = this.area.nativeElement;
    const cur = document.getSelection();
    const inside = !!cur?.rangeCount && el.contains(cur.getRangeAt(0).commonAncestorContainer);
    if (document.activeElement !== el) el.focus();
    if (!inside && this.range && el.contains(this.range.startContainer)) { const s = document.getSelection(); s?.removeAllRanges(); s?.addRange(this.range); }
  }
  /** Buttons keep the text selection; selects and color inputs need focus, so the range is restored before applying. */
  keepSelection(e: MouseEvent) { const t = e.target as HTMLElement; if (t.closest('button')) e.preventDefault(); }

  private snapshot() {
    const h = this.area.nativeElement.innerHTML;
    if (this.history[this.history.length - 1] !== h) { this.history.push(h); if (this.history.length > 200) this.history.shift(); }
    this.future = [];
  }

  cmd(name: string, value?: string) {
    if (this.readOnly) return;
    this.restore(); this.snapshot();
    // colors as CSS spans; bold/italic/underline/strike as plain tags
    document.execCommand('styleWithCSS', false, name === 'foreColor' || name === 'hiliteColor' ? 'true' : 'false');
    if (name.startsWith('insert') && name.endsWith('List')) document.execCommand('formatBlock', false, 'p');
    document.execCommand(name, false, value);
    this.changed();
  }
  block(tag: string) { if (tag) this.cmd('formatBlock', tag); }

  fontSize(pt: string) {
    if (!pt || this.readOnly) return;
    this.restore(); this.snapshot();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('fontSize', false, '7');
    for (const f of Array.from(this.area.nativeElement.querySelectorAll('font[size="7"]')) as HTMLElement[]) {
      const s = document.createElement('span'); s.style.fontSize = pt + 'pt'; s.append(...Array.from(f.childNodes)); f.replaceWith(s);
    }
    this.changed();
  }

  /** Paragraphs touched by the selection (or the one with the cursor). */
  private blocks(): HTMLElement[] {
    this.restore();
    const el = this.area.nativeElement, s = document.getSelection();
    if (!s || !s.rangeCount) return [];
    const r = s.getRangeAt(0);
    const all = Array.from(el.querySelectorAll(BLOCK)) as HTMLElement[];
    const hit = all.filter(b => r.intersectsNode(b) && !b.querySelector(BLOCK));
    if (hit.length) return hit;
    let n: Node | null = r.startContainer;
    while (n && n !== el) { if (n instanceof HTMLElement && n.matches(BLOCK)) return [n]; n = n.parentNode; }
    return [];
  }

  blockStyle(prop: string, value: string) {
    if (!value || this.readOnly) return;
    const bs = this.blocks(); if (!bs.length) return;
    this.snapshot();
    for (const b of bs) b.style.setProperty(prop, value);
    this.changed();
  }
  align(a: string) { this.blockStyle('text-align', a); }
  indent(dir: number) {
    if (this.readOnly) return;
    const bs = this.blocks(); if (!bs.length) return;
    this.snapshot();
    for (const b of bs) {
      const cur = parseFloat(b.style.marginLeft) || 0, next = Math.max(0, cur + dir * 36);
      if (next) b.style.marginLeft = next + 'pt'; else b.style.removeProperty('margin-left');
    }
    this.changed();
  }
  clearFormat() {
    if (this.readOnly) return;
    this.restore(); this.snapshot();
    document.execCommand('removeFormat');
    for (const b of this.blocks()) b.removeAttribute('style');
    for (const s of Array.from(this.area.nativeElement.querySelectorAll('span')) as HTMLElement[]) {
      const sel = document.getSelection(); if (sel && sel.rangeCount && sel.getRangeAt(0).intersectsNode(s)) s.replaceWith(...Array.from(s.childNodes));
    }
    this.changed();
  }

  undo() { const el = this.area.nativeElement; const prev = this.history.pop(); if (prev === undefined) return; this.future.push(el.innerHTML); el.innerHTML = prev; this.emit(); }
  redo() { const el = this.area.nativeElement; const next = this.future.pop(); if (next === undefined) return; this.history.push(el.innerHTML); el.innerHTML = next; this.emit(); }

  keys(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
    else if (mod && ['b', 'i', 'u'].includes(k)) { e.preventDefault(); this.cmd(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline'); }
    else if (e.key === 'Tab') { e.preventDefault(); this.indent(e.shiftKey ? -1 : 1); }
  }

  /** Pastes as plain text, one paragraph per line, so outside formatting never reaches the report. */
  paste(e: ClipboardEvent) {
    const t = e.clipboardData?.getData('text/plain'); if (t == null) return;
    e.preventDefault(); this.snapshot();
    const html = t.replace(/\r/g, '').split(/\n+/).filter(l => l.trim()).map(l => '<p>' + l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>').join('');
    document.execCommand(t.includes('\n') ? 'insertHTML' : 'insertText', false, t.includes('\n') ? html : t);
    this.changed();
  }

  /** Typing: one undo step per burst (snapshot before the first key after a pause). */
  typing() { if (!this.burst) this.snapshot(); clearTimeout(this.snapTimer); this.burst = true; this.snapTimer = setTimeout(() => this.burst = false, 800); }
  private burst = false;
  changed() { this.emit(); }
  flush() { this.emit(); }

  private emit() {
    const el = this.area.nativeElement;
    if (!el.querySelector(BLOCK + ',ul,ol') && !el.textContent?.trim()) el.innerHTML = '<p><br></p>';
    const html = sanitizeHtml(el.innerHTML);
    this.last = html;
    this.htmlChange.emit(html);
    this.textChange.emit(textFromHtml(html));
  }
}
