import {AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, ViewChild, ViewEncapsulation, inject} from '@angular/core';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import {DOC_PT, EDITOR_FONTS, displayHtml, sanitizeHtml, textFromHtml} from '../rich-text';

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
  chev: '<path d="m6 9 6 6 6-6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  marker: '<path d="m15 4 5 5-9 9H6v-5zM4 21h8"/>',
  lines: '<path d="M10 6h10M10 12h10M10 18h10M4 8l2-3 2 3M4 16l2 3 2-3M6 5v14"/>',
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
    <div class="rte" [class.ro]="readOnly" [class.page]="page">
      <div class="rte-bar" role="toolbar" aria-label="Formatação do texto" (mousedown)="keepSelection($event)" [style.max-width]="page ? sheetMax(0) : null">
        <select class="rte-sel rte-style" aria-label="Estilo do texto" title="Estilo do texto" (change)="block($any($event.target).value); $any($event.target).value=''">
          <option value="">{{st.block === 'h3' ? 'Título do tópico' : 'Texto normal'}}</option><option value="p">Texto normal</option><option value="h3">Título do tópico</option>
        </select>
        <select class="rte-sel rte-size rte-wide" aria-label="Tamanho da fonte" title="Tamanho da fonte" (change)="fontSize($any($event.target).value); $any($event.target).value=''">
          <option value="">{{st.size || 'Tam.'}}</option>@for (s of sizes; track s) {<option [value]="s">{{s}}</option>}
        </select>
        <span class="rte-sep"></span>
        <button type="button" title="Negrito (Ctrl+B)" aria-label="Negrito" [class.on]="st.bold" [attr.aria-pressed]="st.bold" (click)="cmd('bold')"><b>B</b></button>
        <button type="button" title="Itálico (Ctrl+I)" aria-label="Itálico" [class.on]="st.italic" [attr.aria-pressed]="st.italic" (click)="cmd('italic')"><i>I</i></button>
        <button type="button" title="Sublinhado (Ctrl+U)" aria-label="Sublinhado" [class.on]="st.underline" [attr.aria-pressed]="st.underline" (click)="cmd('underline')"><u>U</u></button>
        <span class="rte-sep rte-wide"></span>
        <span class="rte-dd rte-wide">
          <button #alignBtn type="button" class="rte-ddb" [class.on]="menu==='align'" [attr.aria-expanded]="menu==='align'" aria-haspopup="menu" (click)="toggleMenu('align')"
            [attr.aria-label]="'Alinhamento: ' + alignName(st.align)" [title]="'Alinhamento: ' + alignName(st.align)"><span [innerHTML]="icon(alignIcon())"></span><span class="chev" [innerHTML]="icon('chev')"></span></button>
          @if (menu==='align') {
            <div class="rte-pop rte-pop-sm" role="menu" aria-label="Alinhamento" (keydown)="menuKeys($event)">
              @for (a of aligns; track a.id) {
                <button type="button" role="menuitemradio" [attr.aria-checked]="(st.align || 'justify')===a.id" [class.on]="(st.align || 'justify')===a.id" (click)="align(a.id); closeMenu()"><span [innerHTML]="icon(a.icon)"></span>{{a.name}}</button>
              }
            </div>
          }
        </span>
        <button type="button" class="rte-wide" title="Lista com marcadores" aria-label="Lista com marcadores" [class.on]="st.ul" [attr.aria-pressed]="st.ul" (click)="cmd('insertUnorderedList')" [innerHTML]="icon('ul')"></button>
        <span class="rte-sep rte-hist"></span>
        <button type="button" class="rte-hist" title="Desfazer (Ctrl+Z)" aria-label="Desfazer" [disabled]="!canUndo" (click)="undo()" [innerHTML]="icon('undo')"></button>
        <button type="button" class="rte-hist" title="Refazer (Ctrl+Y)" aria-label="Refazer" [disabled]="!canRedo" (click)="redo()" [innerHTML]="icon('redo')"></button>
        <span class="rte-grow"></span>
        <span class="rte-dd">
          <button #moreBtn type="button" class="rte-more" [class.on]="menu==='more'" [attr.aria-expanded]="menu==='more'" aria-haspopup="menu" (click)="toggleMenu('more')" title="Mais opções de formatação">
            <span class="dots" aria-hidden="true">•••</span><span class="lbl">Mais opções</span><span class="chev" [innerHTML]="icon('chev')"></span></button>
          @if (menu==='more') {
            <div class="rte-pop" role="menu" aria-label="Mais opções" (keydown)="menuKeys($event)">
              @switch (sub) {
                @case ('') {
                  <p class="rte-grp rte-narrow">Texto</p>
                  <button type="button" role="menuitem" class="rte-narrow" (click)="sub='size'"><span class="ico">16</span>Tamanho da fonte<span class="nx" [innerHTML]="icon('next')"></span></button>
                  <button type="button" role="menuitem" class="rte-narrow" (click)="sub='align'"><span [innerHTML]="icon(alignIcon())"></span>Alinhamento<span class="nx" [innerHTML]="icon('next')"></span></button>
                  <button type="button" role="menuitemcheckbox" class="rte-narrow" [attr.aria-checked]="st.ul" [class.on]="st.ul" (click)="cmd('insertUnorderedList')"><span [innerHTML]="icon('ul')"></span>Lista com marcadores</button>
                  <div class="rte-row2 rte-narrow2"><button type="button" [disabled]="!canUndo" (click)="undo()"><span [innerHTML]="icon('undo')"></span>Desfazer</button><button type="button" [disabled]="!canRedo" (click)="redo()"><span [innerHTML]="icon('redo')"></span>Refazer</button></div>
                  <p class="rte-grp">Formatação</p>
                  <button type="button" role="menuitem" (click)="sub='font'"><span class="ico">A</span>Fonte<small>{{st.font}}</small><span class="nx" [innerHTML]="icon('next')"></span></button>
                  <button type="button" role="menuitem" (click)="sub='color'"><span [innerHTML]="icon('drop')"></span>Cor do texto<span class="nx" [innerHTML]="icon('next')"></span></button>
                  <button type="button" role="menuitem" (click)="sub='mark'"><span [innerHTML]="icon('marker')"></span>Marca-texto<span class="nx" [innerHTML]="icon('next')"></span></button>
                  <button type="button" role="menuitemcheckbox" [attr.aria-checked]="st.strike" [class.on]="st.strike" (click)="cmd('strikeThrough')"><span class="ico"><s>S</s></span>Tachado</button>
                  <p class="rte-grp">Parágrafo</p>
                  <button type="button" role="menuitem" (click)="sub='lines'"><span [innerHTML]="icon('lines')"></span>Espaçamento entre linhas<span class="nx" [innerHTML]="icon('next')"></span></button>
                  <button type="button" role="menuitem" (click)="sub='indent'"><span [innerHTML]="icon('indent')"></span>Recuos e espaçamento<span class="nx" [innerHTML]="icon('next')"></span></button>
                  <button type="button" role="menuitemcheckbox" [attr.aria-checked]="st.ol" [class.on]="st.ol" (click)="cmd('insertOrderedList')"><span [innerHTML]="icon('ol')"></span>Lista numerada</button>
                  <hr>
                  <button type="button" role="menuitem" (click)="clearFormat(); closeMenu()"><span [innerHTML]="icon('clear')"></span>Limpar formatação</button>
                }
                @default {
                  <button type="button" class="rte-back" (click)="sub=''"><span [innerHTML]="icon('back')"></span>{{subName()}}</button>
                  @switch (sub) {
                    @case ('font') {
                      @for (f of fonts; track f) { <button type="button" role="menuitemradio" [attr.aria-checked]="st.font===f" [class.on]="st.font===f" [style.font-family]="f" (click)="fontFamily(f); closeMenu()">{{f}}</button> }
                    }
                    @case ('size') {
                      <div class="rte-chips">@for (z of sizes; track z) { <button type="button" [class.on]="st.size===''+z" (click)="fontSize(''+z); closeMenu()">{{z}}</button> }</div>
                    }
                    @case ('align') {
                      @for (a of aligns; track a.id) { <button type="button" role="menuitemradio" [attr.aria-checked]="(st.align || 'justify')===a.id" [class.on]="(st.align || 'justify')===a.id" (click)="align(a.id); closeMenu()"><span [innerHTML]="icon(a.icon)"></span>{{a.name}}</button> }
                    }
                    @case ('color') {
                      <div class="rte-sw">@for (c of colors; track c) { <button type="button" [style.background]="c" [attr.aria-label]="'Cor ' + c" [title]="c" (click)="cmd('foreColor', c); closeMenu()"></button> }</div>
                      <label class="rte-custom">Outra cor <input type="color" value="#c00000" aria-label="Escolher outra cor do texto" (change)="cmd('foreColor', $any($event.target).value); closeMenu()"></label>
                    }
                    @case ('mark') {
                      <div class="rte-sw">@for (c of marks; track c) { <button type="button" [style.background]="c" [attr.aria-label]="'Marca-texto ' + c" [title]="c" (click)="cmd('hiliteColor', c); closeMenu()"></button> }</div>
                      <button type="button" (click)="cmd('hiliteColor', 'transparent'); closeMenu()"><span [innerHTML]="icon('clear')"></span>Sem marca-texto</button>
                      <label class="rte-custom">Outra cor <input type="color" value="#ffff00" aria-label="Escolher outra cor de marca-texto" (change)="cmd('hiliteColor', $any($event.target).value); closeMenu()"></label>
                    }
                    @case ('lines') {
                      @for (l of lines; track l) { <button type="button" role="menuitem" (click)="blockStyle('line-height', l); closeMenu()">{{l.replace('.', ',')}}</button> }
                    }
                    @case ('indent') {
                      <div class="rte-row2"><button type="button" (click)="indent(-1)"><span [innerHTML]="icon('outdent')"></span>Diminuir recuo</button><button type="button" (click)="indent(1)"><span [innerHTML]="icon('indent')"></span>Aumentar recuo</button></div>
                      <p class="rte-grp">Espaço antes do parágrafo</p>
                      <div class="rte-chips">@for (g of gaps; track g) { <button type="button" (click)="blockStyle('margin-top', g + 'pt')">{{g}} pt</button> }</div>
                      <p class="rte-grp">Espaço depois do parágrafo</p>
                      <div class="rte-chips">@for (g of gaps; track g) { <button type="button" (click)="blockStyle('margin-bottom', g + 'pt')">{{g}} pt</button> }</div>
                    }
                  }
                }
              }
            </div>
          }
        </span>
      </div>
      @if (!readOnly && spellTip) {
        <div class="rte-spell" role="note"><span><b>Corretor ortográfico:</b> palavras com erro ficam sublinhadas em vermelho; clique com o botão direito nelas para ver as sugestões.
          Se não aparecer, ligue no Chrome: Configurações › Idiomas › Verificação ortográfica, com Português (Brasil).</span><button type="button" (click)="hideSpellTip()">Entendi</button></div>
      }
      <div #area class="rte-area draft editing" spellcheck="true" lang="pt-BR" [style.zoom]="page ? zoom : null" [style.max-width]="page ? sheetMax(0) : null" [attr.contenteditable]="readOnly ? 'false' : 'true'" role="textbox" aria-multiline="true" [attr.aria-label]="label"
        (paste)="paste($event)" (blur)="flush()"></div>
    </div>`,
  styles: [`
    nl-rich-editor{display:block}
    .rte-spell{display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--primary-soft);color:var(--text-2);font:13px/1.45 var(--font)}
    .rte-spell span{flex:1}.rte-spell b{color:var(--text)}
    .rte-spell button{flex:none;height:30px;padding:0 12px;border:1px solid var(--primary-border,var(--border));border-radius:8px;background:var(--card);color:var(--primary-text);font:600 12.5px var(--font);cursor:pointer}
    .rte{border:1px solid var(--border-input);border-radius:var(--radius-sm);background:var(--card)}
    .rte{container-type:inline-size;container-name:rte}
    .rte-bar{display:flex;flex-wrap:nowrap;align-items:center;gap:4px;padding:6px 8px;min-height:46px;box-sizing:border-box;width:100%;border-bottom:1px solid var(--border);background:var(--card);border-radius:var(--radius-sm) var(--radius-sm) 0 0;position:sticky;top:0;z-index:4}
    .rte-bar button{min-width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid transparent;border-radius:7px;background:none;color:var(--text-2);cursor:pointer;font:500 14px var(--font);padding:0 6px;position:relative;flex:none}
    .rte-bar>button:hover:not(:disabled),.rte-dd>button:hover{background:var(--primary-soft);color:var(--primary-text)}
    .rte-bar button:disabled{opacity:.35;cursor:default}
    .rte-bar button:focus-visible,.rte-sel:focus-visible,.rte-pop :is(button,input):focus-visible{outline:none;box-shadow:0 0 0 3px var(--ring)}
    .rte-bar svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;flex:none}
    .rte-sel{height:32px;border:1px solid var(--border-input);border-radius:7px;background:var(--card);color:var(--text);font-size:13px;padding:0 6px;flex:none}
    .rte-style{width:136px}.rte-size{width:62px}
    .rte-sep{width:1px;height:20px;background:var(--border);margin:0 2px;flex:none}
    .rte-grow{flex:1;min-width:4px}
    .rte-bar button.on{background:var(--primary-soft);color:var(--primary-text);border-color:var(--primary-border-2,var(--primary))}
    .rte-dd{position:relative;display:inline-flex;flex:none}
    .rte-ddb .chev svg,.rte-more .chev svg{width:13px;height:13px}
    .rte-more{border:1px solid var(--primary-border-2,var(--primary)) !important;color:var(--primary-text) !important;padding:0 10px !important;background:var(--card)}
    .rte-more .dots{letter-spacing:1px;font-size:11px}
    .rte-pop{position:absolute;top:calc(100% + 6px);right:0;z-index:20;width:286px;max-width:calc(100vw - 24px);max-height:min(70vh,520px);overflow:auto;padding:8px;background:var(--card);border:1px solid var(--border-card);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.14);display:flex;flex-direction:column;gap:1px;text-align:left}
    .rte-pop-sm{width:200px;right:auto;left:0}
    .rte-pop button{justify-content:flex-start !important;width:100%;height:36px !important;padding:0 10px !important;gap:12px !important;font:400 14px var(--font) !important;color:var(--text) !important;border-radius:8px !important}
    .rte-pop button:hover{background:var(--chip) !important}
    .rte-pop button.on{background:var(--primary-soft) !important;color:var(--primary-text) !important;border-color:transparent !important}
    .rte-pop button>span:first-child,.rte-pop .ico{width:20px;display:inline-flex;justify-content:center;flex:none;color:var(--text-2);font-weight:600}
    .rte-pop .nx{margin-left:auto;color:var(--text-3)}
    .rte-pop .nx svg{width:15px;height:15px}
    .rte-pop small{margin-left:auto;font-size:12px;color:var(--text-3)}
    .rte-pop small+.nx{margin-left:6px}
    .rte-grp{margin:8px 10px 4px;font-size:12.5px;font-weight:600;color:var(--primary-text)}
    .rte-grp:first-child{margin-top:2px}
    .rte-pop hr{border:0;border-top:1px solid var(--divider);margin:6px 4px}
    .rte-back{font-weight:600 !important;color:var(--primary-text) !important;border-bottom:1px solid var(--divider) !important;border-radius:8px 8px 0 0 !important;margin-bottom:4px}
    .rte-chips{display:flex;flex-wrap:wrap;gap:4px;padding:2px 6px 6px}
    .rte-chips button{width:auto !important;min-width:44px;height:32px !important;justify-content:center !important;border:1px solid var(--border-card) !important}
    .rte-sw{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;padding:4px 8px 8px}
    .rte-sw button{width:100% !important;height:28px !important;min-width:0;padding:0 !important;border:1px solid rgba(0,0,0,.15) !important;border-radius:6px !important}
    .rte-custom{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;font-size:13.5px;color:var(--text)}
    .rte-custom input{width:40px;height:28px;border:1px solid var(--border-card);border-radius:6px;padding:0;background:none;cursor:pointer}
    .rte-row2{display:grid;grid-template-columns:1fr 1fr;gap:4px}
    .rte-narrow,.rte-narrow2{display:none !important}
    .rte-area{font-family:var(--doc-font);text-align:justify;min-height:320px;max-height:calc(70vh / var(--zoom, 1));overflow:auto;padding:14px 16px;outline:none;line-height:1.6;border:0 !important;border-radius:0 0 var(--radius-sm) var(--radius-sm)}
    .rte-area:focus{box-shadow:inset 0 0 0 2px var(--ring)}
    .rte-area p,.rte-area h3{margin:0 0 .6em}
    .rte-area h3{font-size:inherit;font-weight:700}
    .rte-area ul,.rte-area ol{margin:0 0 .6em;padding-left:1.6em}
    .rte.ro .rte-bar{display:none}
    /* page layout (edit mode): toolbar fixed above, the text as a sheet that grows; the page scrolls, not the area */
    .rte.page{border:0;background:none}
    .rte.page .rte-bar{position:sticky;top:0;z-index:4;border:1px solid var(--border-card);border-radius:var(--radius-lg);margin:0 auto 12px;max-width:900px;background:var(--card);box-shadow:0 1px 3px rgba(0,0,0,.04)}
    .rte.page .rte-area{max-height:none;min-height:60vh;max-width:900px;margin:0 auto;padding:36px 48px 56px;background:var(--card);border:1px solid var(--border-card) !important;border-radius:var(--radius-lg);font-size:17px;line-height:1.7;hyphens:manual}
    .rte.page .rte-area:focus{box-shadow:0 0 0 3px var(--ring)}
    /* small screens: one row; size, alignment and bullets move into "Mais opções" */
    @media (max-width:700px){.rte.page .rte-area{padding:20px 16px 40px;font-size:16px}}
    /* narrow toolbar (by its own width): label of "Mais opções" first, then size, alignment and bullets move into the menu */
    @container rte (max-width:620px){.rte-more .lbl{display:none}}
    @container rte (max-width:520px){.rte-wide{display:none !important}.rte-narrow{display:flex !important}.rte-narrow.rte-grp{display:block !important}.rte-style{width:116px}}
    @container rte (max-width:400px){.rte-hist{display:none !important}.rte-narrow2{display:grid !important}.rte-style{width:104px}.rte-pop{position:fixed;left:12px;right:12px;width:auto;max-width:none}}
  `],
})
export class RichEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  private sanitizer = inject(DomSanitizer);
  /** One-time tip about the spell checker (Chrome's, in Portuguese - Brazil), per browser. */
  spellTip = (() => { try { return localStorage.getItem('nl-spell-tip') !== '1'; } catch { return false; } })();
  hideSpellTip() { this.spellTip = false; try { localStorage.setItem('nl-spell-tip', '1'); } catch {} }
  @ViewChild('area', {static: true}) area!: ElementRef<HTMLDivElement>;
  /** Initial HTML; changing it from outside resets the content (and the undo history). */
  @Input() html = '';
  @Input() readOnly = false;
  @Input() label = 'Texto';
  /** Page layout for the full-window edit mode. */
  @Input() page = false;
  /** Visual zoom of the text in page layout (does not change the saved font sizes). */
  @Input() zoom = 1;
  /** Width of the sheet in page layout, in px (0 = all the width there is). */
  @Input() sheet = 900;
  sheetMax(extra: number) { return this.sheet ? (this.sheet + extra) + 'px' : 'none'; }
  readonly fonts = EDITOR_FONTS;
  readonly aligns = [{id: 'left', name: 'Alinhar à esquerda', icon: 'left'}, {id: 'center', name: 'Centralizar', icon: 'center'}, {id: 'right', name: 'Alinhar à direita', icon: 'right'}, {id: 'justify', name: 'Justificar', icon: 'justify'}];
  readonly colors = ['#000000', '#404040', '#7f7f7f', '#c00000', '#e36c09', '#9c6500', '#00703c', '#0f6f5e', '#1f4e79', '#2e75b6', '#7030a0', '#c00078'];
  readonly marks = ['#ffff00', '#ffe599', '#c6efce', '#b4e5ff', '#f4cccc', '#e2cfee'];
  /** Open toolbar menu ('align' or 'more') and the sub-list shown inside "Mais opções". */
  menu: '' | 'align' | 'more' = ''; sub = '';
  @ViewChild('moreBtn') moreBtn?: ElementRef<HTMLButtonElement>;
  @ViewChild('alignBtn') alignBtn?: ElementRef<HTMLButtonElement>;
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  alignIcon() { return this.aligns.find(a => a.id === (this.st.align || 'justify'))?.icon || 'justify'; }
  /** Without a chosen alignment the paragraph is justified, as in the Word export. */
  alignName(id: string) { return this.aligns.find(a => a.id === (id || 'justify'))?.name || ''; }
  subName() { return ({font: 'Fonte', size: 'Tamanho da fonte', align: 'Alinhamento', color: 'Cor do texto', mark: 'Marca-texto', lines: 'Espaçamento entre linhas', indent: 'Recuos e espaçamento'} as Record<string, string>)[this.sub] || ''; }
  /** Opening a menu never touches the text; the selection is kept and restored when an option is applied. */
  toggleMenu(m: 'align' | 'more') { this.menu = this.menu === m ? '' : m; this.sub = ''; if (this.menu) document.addEventListener('mousedown', this.outside, true); this.cdr.markForCheck(); }
  closeMenu(focusBack = false) {
    const was = this.menu; this.menu = ''; this.sub = ''; document.removeEventListener('mousedown', this.outside, true); this.cdr.markForCheck();
    if (focusBack) (was === 'align' ? this.alignBtn : this.moreBtn)?.nativeElement.focus();
  }
  private readonly outside = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('.rte-dd') || !this.host.nativeElement.contains(e.target as Node)) this.closeMenu(); };
  menuKeys(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (this.sub) { this.sub = ''; this.cdr.markForCheck(); } else this.closeMenu(true); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not([disabled])')).filter(b => b.offsetParent !== null);
    const i = items.indexOf(document.activeElement as HTMLElement); e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
  /** Formatting at the cursor, shown by the toolbar. */
  st: {bold: boolean; italic: boolean; underline: boolean; strike: boolean; ul: boolean; ol: boolean; align: string; block: string; size: string; font: string} =
    {bold: false, italic: false, underline: false, strike: false, ul: false, ol: false, align: '', block: '', size: '', font: ''};
  private cdr = inject(ChangeDetectorRef);
  private zone = inject(NgZone);
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

  /** Typing, cursor moves and key presses are heard outside Angular, so a key press does not re-check the whole screen;
   *  the text is sent to the page after a short pause (or at once on blur, shortcuts, toolbar actions and flush()). */
  ngAfterViewInit() {
    this.load();
    const el = this.area.nativeElement;
    this.zone.runOutsideAngular(() => {
      el.addEventListener('beforeinput', this.onBeforeInput);
      el.addEventListener('input', this.onInput);
      el.addEventListener('keydown', this.onKeydown);
      document.addEventListener('selectionchange', this.track);
    });
  }
  ngOnChanges() { this.basePx = 0; if (this.area && this.html !== this.last) this.load(); }
  ngOnDestroy() {
    const el = this.area?.nativeElement;
    el?.removeEventListener('beforeinput', this.onBeforeInput); el?.removeEventListener('input', this.onInput); el?.removeEventListener('keydown', this.onKeydown);
    if (this.emitTimer) this.flush();
    document.removeEventListener('selectionchange', this.track); document.removeEventListener('mousedown', this.outside, true); clearTimeout(this.snapTimer); this.clearFind(); }

  focus() { this.area.nativeElement.focus(); }

  /** Inserts plain text at the cursor (snippets, pasted answers). */
  insertText(t: string) {
    this.restore(); this.snapshot();
    document.execCommand('insertText', false, t);
    this.changed();
  }

  /** Font family of the selection (only the fonts the Word export knows). */
  fontFamily(name: string) {
    if (!name || this.readOnly || !EDITOR_FONTS.includes(name)) return;
    this.restore(); this.snapshot();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('fontName', false, name);
    for (const f of Array.from(this.area.nativeElement.querySelectorAll('font[face]')) as HTMLElement[]) {
      const s = document.createElement('span'); s.style.fontFamily = f.getAttribute('face') || name; s.append(...Array.from(f.childNodes)); f.replaceWith(s);
    }
    this.changed(); this.readState();
  }
  /** Pastes plain text at the cursor (or over the selection): one paragraph per line, outside formatting dropped. */
  pasteText(t: string) {
    if (this.readOnly || !t.trim()) return;
    this.restore(); this.snapshot();
    const lines = t.replace(/\r/g, '').split(/\n+/).filter(l => l.trim());
    if (lines.length > 1) document.execCommand('insertHTML', false, lines.map(l => '<p>' + l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>').join(''));
    else document.execCommand('insertText', false, lines[0] || t);
    this.changed();
  }
  /** The editable element (for reading aloud the text being edited). */
  get element() { return this.area.nativeElement; }

  // ---------- find and replace (this section only) ----------
  private found: Range[] = [];
  foundAt = -1;
  get foundCount() { return this.found.length; }
  /** Marks every match; returns how many. Case and whole-word options as in Word. */
  find(q: string, opt: {matchCase?: boolean; word?: boolean} = {}): number {
    const el = this.area.nativeElement; this.found = [];
    if (q) {
      const nodes: {node: Text; start: number}[] = []; let all = '';
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) { nodes.push({node: n, start: all.length}); all += n.data; }
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(opt.word ? '(?<![\\p{L}\\p{N}_])' + esc + '(?![\\p{L}\\p{N}_])' : esc, 'gu' + (opt.matchCase ? '' : 'i'));
      const at = (pos: number, end: boolean): [Text, number] => {
        let k = nodes.length - 1; while (k > 0 && (end ? nodes[k].start >= pos : nodes[k].start > pos)) k--;
        return [nodes[k].node, pos - nodes[k].start];
      };
      for (let m = re.exec(all); m; m = re.exec(all)) {
        if (!m[0]) { re.lastIndex++; continue; }
        const r = document.createRange(); const [sn, so] = at(m.index, false), [en, eo] = at(m.index + m[0].length, true);
        r.setStart(sn, so); r.setEnd(en, Math.min(eo, en.data.length)); this.found.push(r);
      }
    }
    this.foundAt = this.found.length ? 0 : -1; this.paintFound();
    return this.found.length;
  }
  findStep(d: number) { const n = this.found.length; if (!n) return; this.foundAt = (this.foundAt + d + n) % n; this.paintFound(true); }
  /** Replaces the current match (one undo step); the formatting around it is kept. */
  replaceOne(q: string, by: string, opt: {matchCase?: boolean; word?: boolean} = {}) {
    const r = this.found[this.foundAt]; if (!r || this.readOnly) return;
    this.snapshot(); const keep = this.foundAt;
    r.deleteContents(); r.insertNode(document.createTextNode(by));
    this.area.nativeElement.normalize(); this.changed();
    this.find(q, opt); if (this.found.length) { this.foundAt = Math.min(keep, this.found.length - 1); this.paintFound(true); }
  }
  /** Replaces every match in this section (one undo step). Returns how many. */
  replaceAll(q: string, by: string, opt: {matchCase?: boolean; word?: boolean} = {}): number {
    if (this.readOnly) return 0;
    const n = this.find(q, opt); if (!n) return 0;
    this.snapshot();
    for (const r of [...this.found].reverse()) { r.deleteContents(); r.insertNode(document.createTextNode(by)); }
    this.area.nativeElement.normalize(); this.changed(); this.find(q, opt);
    return n;
  }
  clearFind() { this.found = []; this.foundAt = -1; this.paintFound(); }
  private paintFound(scroll = false) {
    const reg = (globalThis as any).CSS?.highlights, H = (globalThis as any).Highlight;
    if (!reg || !H) return;
    const cur = this.found[this.foundAt];
    if (this.found.length) reg.set('nl-ed-find', new H(...this.found.filter(r => r !== cur))); else reg.delete('nl-ed-find');
    if (cur) reg.set('nl-ed-find-cur', new H(cur)); else reg.delete('nl-ed-find-cur');
    if (scroll && cur) (cur.startContainer.parentElement as HTMLElement | null)?.scrollIntoView({block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }

  private load() {
    const clean = displayHtml(this.html || '');
    this.area.nativeElement.innerHTML = clean || '<p><br></p>';
    this.last = this.html; this.history = []; this.future = []; this.cdr?.markForCheck();
  }

  /** Cursor moves (outside Angular): only the toolbar is refreshed, and only when the formatting shown changes. */
  private readonly track = () => {
    const s = document.getSelection();
    if (s && s.rangeCount && this.area.nativeElement.contains(s.anchorNode)) { this.range = s.getRangeAt(0).cloneRange(); this.readState(); }
  };
  private readonly onBeforeInput = () => { const had = this.history.length; this.typing(); if (!had && this.history.length) this.cdr.detectChanges(); }; // undo button lights up
  private readonly onInput = () => this.emitLater();
  /** Only shortcuts enter Angular; plain letters stay outside. */
  private readonly onKeydown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === 'Tab' || (mod && ['z', 'y', 'b', 'i', 'u'].includes(k))) this.zone.run(() => this.keys(e));
  };
  private emitTimer: any = null;
  private emitLater() { clearTimeout(this.emitTimer); this.emitTimer = setTimeout(() => this.zone.run(() => this.flush()), 300); }
  /** Reads the formatting at the cursor so the toolbar shows it (pressed buttons, current size and font). */
  private readState() {
    const s = document.getSelection(); const n = s?.anchorNode; if (!n) return;
    const el = (n.nodeType === 1 ? n : n.parentElement) as HTMLElement | null; if (!el) return;
    const q = (c: string) => { try { return document.queryCommandState(c); } catch { return false; } };
    const block = el.closest('p,h3,li') as HTMLElement | null;
    // size relative to the editor's own text, which stands for the report default (11 pt): same as the Word file, at any zoom
    const pt = Math.round(this.px(el) / this.base() * DOC_PT * 2) / 2;
    const fam = el.closest('[style*="font-family"]') as HTMLElement | null;
    const next = {bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'),
      ul: !!el.closest('ul'), ol: !!el.closest('ol'), align: block?.style.textAlign || '', block: block ? block.tagName.toLowerCase() : '',
      size: String(pt), font: fam ? fam.style.fontFamily.split(',')[0].replace(/["']/g, '') : ''};
    if (JSON.stringify(next) !== JSON.stringify(this.st)) { this.st = next; this.cdr.detectChanges(); }
  }
  private restore() {
    const el = this.area.nativeElement;
    const cur = document.getSelection();
    const inside = !!cur?.rangeCount && el.contains(cur.getRangeAt(0).commonAncestorContainer);
    if (document.activeElement !== el) el.focus();
    if (!inside && this.range && el.contains(this.range.startContainer)) { const s = document.getSelection(); s?.removeAllRanges(); s?.addRange(this.range); }
  }
  /** Buttons keep the text selection; selects and color inputs need focus, so the range is restored before applying. */
  keepSelection(e: MouseEvent) { const t = e.target as HTMLElement; if (t.closest('button')) e.preventDefault(); }

  private snapshot(check = true) {
    const h = this.area.nativeElement.innerHTML;
    if (this.history[this.history.length - 1] !== h) { this.history.push(h); if (this.history.length > 200) this.history.shift(); }
    this.future = []; if (check) this.cdr.markForCheck();
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
      // em of the size around it (the editor's text is the 11 pt default); sizes inside the selection give way to the new one
      const s = document.createElement('span'); s.append(...Array.from(f.childNodes)); f.replaceWith(s);
      for (const d of Array.from(s.querySelectorAll<HTMLElement>('[style*="font-size"]'))) { d.style.removeProperty('font-size'); if (!d.getAttribute('style')) d.removeAttribute('style'); }
      const em = (+pt / DOC_PT) * this.base() / this.px(s.parentElement || this.area.nativeElement);
      s.style.fontSize = Math.round(em * 1000) / 1000 + 'em';
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

  get canUndo() { return this.history.length > 0; }
  get canRedo() { return this.future.length > 0; }
  undo() { const el = this.area.nativeElement; const prev = this.history.pop(); if (prev === undefined) return; this.future.push(el.innerHTML); el.innerHTML = prev; this.flush(); this.cdr.markForCheck(); }
  redo() { const el = this.area.nativeElement; const next = this.future.pop(); if (next === undefined) return; this.history.push(el.innerHTML); el.innerHTML = next; this.flush(); this.cdr.markForCheck(); }

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
  typing() { if (!this.burst) this.snapshot(false); clearTimeout(this.snapTimer); this.burst = true; this.snapTimer = setTimeout(() => this.burst = false, 800); }
  private burst = false;
  changed() { this.flush(); }
  /** Sends the text now (pending typing included). The page calls it before saving. */
  flush() { clearTimeout(this.emitTimer); this.emitTimer = null; this.emit(); }

  /** Font size in px as drawn (zoom left out, as it applies to the whole editor). */
  private px(el: Element) { return parseFloat(getComputedStyle(el).fontSize) || 16; }
  /** The editor's own text size (the 11 pt default), read once and again only when the inputs (zoom, page) change. */
  private basePx = 0;
  private base() { return this.basePx ||= this.px(this.area.nativeElement); }

  private emit() {
    const el = this.area.nativeElement;
    if (!el.querySelector(BLOCK + ',ul,ol') && !el.textContent?.trim()) el.innerHTML = '<p><br></p>';
    const html = sanitizeHtml(el.innerHTML, {baseColor: getComputedStyle(el).color});
    this.last = html;
    this.htmlChange.emit(html);
    this.textChange.emit(textFromHtml(html));
  }
}
