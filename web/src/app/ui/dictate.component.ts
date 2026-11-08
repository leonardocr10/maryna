import {AfterContentInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Output, ViewEncapsulation, computed, inject} from '@angular/core';
import {IconComponent} from './icon.component';
import {Dictation} from '../dictation/dictation.service';
import {clock, fitInsertion} from '../dictation/dictation-text';

type Field = HTMLTextAreaElement | HTMLInputElement;

/**
 * Wraps a text field and adds the voice-dictation microphone:
 *   <nl-dictate (inserted)="save()"><textarea [(ngModel)]="text"></textarea></nl-dictate>
 * Confirmed text is inserted at the cursor (never replacing what is there) through a regular "input" event, so ngModel
 * and the existing save flow see it as typing. Provisional text is shown below the field until it is confirmed.
 */
@Component({
  selector: 'nl-dictate',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="dct-wrap" [class.dct-on]="show()">
      <ng-content/>
      @if (dictation.available() && field && !field.disabled && !field.readOnly) {
        <button type="button" class="dct-mic" [class]="'dct-mic st-' + myState()" (mousedown)="$event.preventDefault()" (click)="toggle()"
          [attr.aria-label]="label()" [attr.title]="label()" [attr.aria-pressed]="myState()==='recording'">
          @switch (myState()) {
            @case ('requesting') { <span class="dct-spin" aria-hidden="true"></span> }
            @case ('processing') { <span class="dct-spin" aria-hidden="true"></span> }
            @case ('paused') { <nl-icon name="pause"/> }
            @case ('error') { <nl-icon name="micoff"/> }
            @default { <nl-icon name="mic"/> }
          }
        </button>
      }
    </div>
    @if (show()) {
      <div class="dct-panel" [class]="'dct-panel st-' + myState()" role="status" aria-live="polite">
        @if (myState()==='error') {
          <div class="dct-row"><nl-icon name="alert"/><span class="dct-msg">{{dictation.error()}}</span></div>
          @if (dictation.leftover()) {
            <p class="dct-prov"><b>Texto não confirmado:</b> {{dictation.leftover()}}</p>
          }
          <div class="dct-actions">
            @if (dictation.leftover()) { <button type="button" class="btn btn-secondary btn-sm" (click)="insertLeftover()">Inserir mesmo assim</button> }
            <button type="button" class="btn btn-secondary btn-sm" (click)="dictation.dismiss()">Fechar</button>
            <button type="button" class="btn btn-primary btn-sm" (click)="retry()"><nl-icon name="mic"/> Tentar de novo</button>
          </div>
        } @else {
          <div class="dct-row">
            <span class="dct-dot" aria-hidden="true"></span>
            <span class="dct-msg">{{stateText()}}</span>
            @if (dictation.seconds()) { <span class="dct-time mono">{{time()}}</span> }
            <span class="dct-actions">
              @if (myState()==='recording') { <button type="button" class="btn btn-secondary btn-sm" (mousedown)="$event.preventDefault()" (click)="dictation.pause()"><nl-icon name="pause"/> Pausar</button> }
              @if (myState()==='paused') { <button type="button" class="btn btn-secondary btn-sm" (mousedown)="$event.preventDefault()" (click)="dictation.resume()"><nl-icon name="mic"/> Continuar</button> }
              @if (myState()==='recording' || myState()==='paused') { <button type="button" class="btn btn-primary btn-sm" (mousedown)="$event.preventDefault()" (click)="dictation.stop()"><nl-icon name="check"/> Concluir</button> }
              @if (myState()==='requesting') { <button type="button" class="btn btn-secondary btn-sm" (click)="dictation.cancel()">Cancelar</button> }
            </span>
          </div>
          @if (dictation.preview()) { <p class="dct-prov" title="Texto provisório: entra no campo quando for confirmado">{{dictation.preview()}}</p> }
        }
      </div>
    }`,
  styles: [`
    nl-dictate{display:block}
    .dct-wrap{position:relative}
    .dct-wrap>textarea{padding-right:56px}
    .dct-mic{position:absolute;right:18px;bottom:8px;width:34px;height:34px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
      border:1px solid var(--border-input);background:var(--card);color:var(--text-3);cursor:pointer;--ico-size:17px;
      transition:background .15s,color .15s,border-color .15s,box-shadow .15s;touch-action:manipulation}
    .dct-mic:hover{background:var(--primary-soft);color:var(--primary-text);border-color:var(--primary-border-2)}
    .dct-mic:focus-visible{outline:none;box-shadow:0 0 0 3px var(--ring);border-color:var(--primary)}
    .dct-mic.st-recording{background:var(--primary);border-color:var(--primary);color:var(--on-primary);animation:dctPulse 1.6s ease-out infinite}
    .dct-mic.st-paused{background:var(--warn-bg);border-color:var(--warn-dot);color:var(--warn-fg)}
    .dct-mic.st-error{background:var(--danger-bg);border-color:var(--danger-border);color:var(--danger)}
    .dct-mic.st-requesting,.dct-mic.st-processing{color:var(--primary-text);border-color:var(--primary-border-2)}
    .dct-spin{width:15px;height:15px;border-radius:50%;border:2px solid var(--primary-border);border-top-color:var(--primary);animation:dctSpin .8s linear infinite}
    @keyframes dctPulse{0%{box-shadow:0 0 0 0 var(--ring)}70%{box-shadow:0 0 0 9px transparent}100%{box-shadow:0 0 0 0 transparent}}
    @keyframes dctSpin{to{transform:rotate(360deg)}}
    .dct-panel{margin-top:8px;padding:10px 12px;border:1px solid var(--primary-border);background:var(--primary-soft);border-radius:var(--radius-sm);font-size:13px;color:var(--text-2);animation:nlFade .15s}
    .dct-panel.st-paused{border-color:var(--warn-dot);background:var(--warn-bg);color:var(--warn-fg)}
    .dct-panel.st-error{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}
    .dct-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:34px}
    .dct-msg{font-weight:600}
    .dct-time{font-size:12px;color:var(--caption)}
    .dct-actions{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}
    .dct-panel.st-error .dct-actions{margin-top:8px;justify-content:flex-end}
    .dct-dot{width:8px;height:8px;border-radius:50%;background:var(--primary);flex:none}
    .dct-panel.st-recording .dct-dot{animation:dctBlink 1.2s ease-in-out infinite}
    .dct-panel.st-paused .dct-dot{background:var(--warn-dot)}
    .dct-panel.st-requesting .dct-dot,.dct-panel.st-processing .dct-dot{background:var(--primary-border-2)}
    @keyframes dctBlink{50%{opacity:.25}}
    .dct-prov{margin:6px 0 0;font-style:italic;color:var(--text-3);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
    .dct-panel.st-error .dct-prov{color:var(--text-2)}
    @media (prefers-reduced-motion: reduce){.dct-mic.st-recording,.dct-panel.st-recording .dct-dot,.dct-spin{animation-duration:3s}.dct-mic.st-recording{animation:none}}
    @media (max-width:560px){.dct-actions{margin-left:0;width:100%}.dct-actions .btn{flex:1}}
  `],
})
export class DictateComponent implements AfterContentInit, OnDestroy {
  readonly dictation = inject(Dictation);
  private zone = inject(NgZone);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Evaluation the text belongs to (only for the audit log). */
  @Input() evaluationId?: string;
  /** Fired after dictated text is inserted, for fields that save on their own (e.g. on blur). */
  @Output() inserted = new EventEmitter<string>();
  field?: Field;
  /** Rich editor (nl-rich-editor) instead of a text field. */
  private rich?: HTMLElement;
  private richRange: Range | null = null;
  private readonly trackRich = () => { const s = document.getSelection(); if (this.rich && s?.rangeCount && this.rich.contains(s.anchorNode)) this.richRange = s.getRangeAt(0).cloneRange(); };
  private caret: number | null = null;
  private readonly sink = {insert: (t: string) => this.insert(t)};
  private readonly track = () => { const f = this.field; if (f && document.activeElement === f) this.caret = f.selectionEnd ?? f.value.length; };
  private readonly events = ['select', 'keyup', 'mouseup', 'input', 'focus', 'blur', 'touchend'];

  readonly myState = computed(() => this.dictation.isMine(this) ? this.dictation.state() : 'idle');
  readonly show = computed(() => this.myState() !== 'idle');
  readonly time = computed(() => clock(this.dictation.seconds()) + (this.dictation.maxSeconds() ? ' / ' + clock(this.dictation.maxSeconds()) : ''));
  readonly label = computed(() => ({idle: 'Ditar por voz', requesting: 'Conectando o microfone… (clique para cancelar)', recording: 'Ditando: clique para concluir',
    paused: 'Ditado pausado: clique para continuar', processing: 'Finalizando a transcrição…', error: 'Falha no ditado: clique para tentar de novo'} as Record<string, string>)[this.myState()]);
  readonly stateText = computed(() => ({requesting: 'Solicitando o microfone…', recording: 'Ouvindo… fale normalmente; o texto entra no campo a cada pausa.',
    paused: 'Ditado pausado. O microfone está desligado.', processing: 'Transcrevendo o final…'} as Record<string, string>)[this.myState()] || '');

  ngAfterContentInit() {
    this.rich = this.host.nativeElement.querySelector('.rte-area') as HTMLElement | undefined;
    this.field = this.rich ? {disabled: false, readOnly: false} as Field : this.host.nativeElement.querySelector('textarea, input') as Field | undefined;
    if (this.rich) this.zone.runOutsideAngular(() => document.addEventListener('selectionchange', this.trackRich)); // cursor moves need no screen check
    else for (const e of this.events) this.field?.addEventListener(e, this.track);
    this.dictation.loadStatus();
  }

  ngOnDestroy() {
    document.removeEventListener('selectionchange', this.trackRich);
    if (!this.rich) for (const e of this.events) this.field?.removeEventListener(e, this.track);
    if (this.dictation.isMine(this)) this.dictation.cancel();
  }

  toggle() {
    const st = this.myState();
    if (st === 'idle' || st === 'error') this.retry();
    else if (st === 'recording') this.dictation.stop();
    else if (st === 'paused') this.dictation.resume();
    else if (st === 'requesting') this.dictation.cancel();
  }

  retry() {
    if (this.field && document.activeElement === this.field) this.track();
    this.dictation.start(this, this.sink, this.evaluationId);
  }

  insertLeftover() { const t = this.dictation.takeLeftover(); if (t) this.insert(t); this.dictation.dismiss(); }

  /** Inserts at the cursor of this field (or where it was last), never over a selection, then notifies ngModel. */
  private insert(text: string) {
    if (this.rich) { this.insertRich(text); return; }
    const f = this.field; if (!f || !text.trim()) return;
    const focused = document.activeElement === f;
    const len = f.value.length;
    const at = Math.min(len, Math.max(0, (focused ? f.selectionEnd : this.caret) ?? len));
    const piece = fitInsertion(f.value.slice(0, at), f.value.slice(at), text);
    if (!piece) return;
    f.setRangeText(piece, at, at, focused ? 'end' : 'preserve');
    this.caret = at + piece.length;
    f.dispatchEvent(new Event('input', {bubbles: true}));
    this.inserted.emit(piece);
  }

  /** Rich editor: inserts at the last cursor position (or at the end) through the editor's own input flow. */
  private insertRich(text: string) {
    const el = this.rich!; if (!text.trim() || el.getAttribute('contenteditable') !== 'true') return;
    el.focus();
    const s = document.getSelection();
    if (this.richRange && el.contains(this.richRange.startContainer)) { s?.removeAllRanges(); s?.addRange(this.richRange); }
    else if (s) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
    const r = s?.rangeCount ? s.getRangeAt(0) : null;
    const before = r ? (r.startContainer.textContent || '').slice(0, r.startOffset) : '';
    const piece = fitInsertion(before, '', text) || text;
    document.execCommand('insertText', false, piece);
    this.trackRich();
    this.inserted.emit(piece);
  }
}
