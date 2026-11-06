import {Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {IconComponent} from './icon.component';

export type SelectOption = string | {label: string; value?: string; group?: string};
interface Normalized {label: string; value: string; group: string}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let seq = 0;

/** Select with a filter box (accent-insensitive). Keyboard: ↓/↑ move, Enter picks, Esc closes, Tab closes;
 *  click outside closes; supports groups. Every select in the system uses this component. */
@Component({
  selector: 'nl-filter-select',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
<div class="fs" [class.open]="open" [class.disabled]="disabled" [class.sm]="size==='sm'" (keydown)="onKey($event)">
  <button #field type="button" class="fs-field" [disabled]="disabled" (click)="toggle()"
    aria-haspopup="listbox" [attr.aria-expanded]="open" [attr.aria-controls]="listId" [attr.aria-label]="ariaLabel || null">
    <nl-icon *ngIf="icon" [name]="icon" class="lead"/><span class="fs-val" [class.ph]="!selected">{{selected?.label || placeholder}}</span>
    <svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
  </button>
  <div *ngIf="open" class="fs-menu" [class.up]="dropUp" [class.right]="alignRight">
    <div *ngIf="searchable" class="fs-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input #filterBox class="fs-filter" [(ngModel)]="query" (ngModelChange)="active=0" placeholder="Filtrar…" aria-label="Filtrar opções"
        role="combobox" [attr.aria-controls]="listId" aria-autocomplete="list" [attr.aria-activedescendant]="activeId()">
    </div>
    <div class="fs-list" role="listbox" [id]="listId">
      <ng-container *ngFor="let g of groups(); trackBy: trackGroup">
        <div *ngIf="g.name" class="fs-group" role="presentation">{{g.name}}</div>
        <button type="button" *ngFor="let o of g.items; trackBy: trackOption" class="fs-opt" role="option" tabindex="-1"
          [id]="optId(o)" [class.sel]="o.value===value" [class.active]="isActive(o)" [attr.aria-selected]="o.value===value"
          (mouseenter)="active=indexOf(o)" (click)="pick(o)">
          <svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>{{o.label}}</span>
        </button>
      </ng-container>
      <div *ngIf="!filtered().length" class="fs-empty">Nenhuma opção encontrada</div>
    </div>
  </div>
</div>`,
  styles: [`
:host{display:block;min-width:0}
.fs{position:relative}
.fs-field{width:100%;height:42px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 12px;border:1px solid var(--border-input);border-radius:var(--radius-sm);background:var(--card);color:var(--text);font:400 14px var(--font);cursor:pointer;text-align:left}
.fs-field span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.fs-field .fs-val{flex:1}.fs-field .lead{--ico-size:16px;color:var(--text-2)}
.fs-field:disabled{background:var(--field-disabled);color:var(--text-3);cursor:not-allowed}
.fs-field:focus-visible,.open .fs-field{outline:none;border:1.5px solid var(--primary);box-shadow:0 0 0 3px var(--ring);padding:0 11.5px}
.ph{color:var(--placeholder)}
svg{width:16px;height:16px;flex:none;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.caret{color:var(--text-3);transition:transform .15s}
.open .caret{transform:rotate(180deg)}
.sm .fs-field{height:34px;font-size:13px;font-weight:500;padding:0 10px}
.sm.open .fs-field,.sm .fs-field:focus-visible{padding:0 9.5px}
.fs-menu{position:absolute;top:calc(100% + 6px);left:0;min-width:100%;width:max-content;max-width:min(380px,90vw);background:var(--card);border:1px solid var(--border-card);border-radius:var(--radius-lg);box-shadow:var(--shadow-menu);padding:6px;z-index:40}
.fs-menu.up{top:auto;bottom:calc(100% + 6px)}
.fs-menu.right{left:auto;right:0}
.fs-search{position:relative;display:flex;align-items:center;margin-bottom:6px}
.fs-search svg{position:absolute;left:10px;width:15px;height:15px;color:var(--text-3)}
.fs-filter{width:100%;height:34px;border:1px solid var(--border-input);border-radius:var(--radius-sm);background:var(--bg);padding:0 10px 0 32px;font:400 13px var(--font);color:var(--text);outline:none}
.fs-filter:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--ring)}
.fs-list{max-height:260px;overflow:auto}
.fs-group{font-size:11px;font-weight:600;color:var(--caption);text-transform:uppercase;letter-spacing:.05em;padding:10px 10px 4px}
.fs-opt{width:100%;display:flex;align-items:center;gap:8px;padding:8px 10px;border:0;border-radius:var(--radius-sm);background:none;font:400 13.5px var(--font);color:var(--text);cursor:pointer;text-align:left;white-space:nowrap}
.fs-opt .check{width:14px;height:14px;stroke-width:2.5;color:var(--primary);visibility:hidden}
.fs-opt.active{background:var(--chip)}
.fs-opt.sel{background:var(--primary-soft);color:var(--primary-text);font-weight:600}
.fs-opt.sel .check{visibility:visible}
.fs-empty{padding:10px;font-size:13px;color:var(--text-3)}
`],
})
export class FilterSelectComponent {
  private host = inject(ElementRef<HTMLElement>);
  @ViewChild('filterBox') filterBox?: ElementRef<HTMLInputElement>;
  @ViewChild('field') field?: ElementRef<HTMLButtonElement>;

  @Input() options: SelectOption[] = [];
  @Input() value = '';
  /** Optional leading icon name (nl-icon). */
  @Input() icon = '';
  @Input() placeholder = 'Selecione';
  @Input() disabled = false;
  @Input() ariaLabel = '';
  /** 'sm' for toolbars (ordering, period, page size). */
  @Input() size: 'md' | 'sm' = 'md';
  /** Very short fixed lists (e.g. page size) may hide the filter box. */
  @Input() searchable = true;
  @Input() dropUp = false;
  @Input() alignRight = false;
  @Output() valueChange = new EventEmitter<string>();

  open = false;
  query = '';
  active = 0;
  readonly listId = 'fs-' + (++seq);

  private norm(): Normalized[] {
    return this.options.map(o => typeof o === 'string' ? {label: o, value: o, group: ''} : {label: o.label, value: o.value ?? o.label, group: o.group || ''});
  }
  get selected() { return this.norm().find(o => o.value === this.value); }
  filtered() { const q = fold(this.query.trim()); return this.norm().filter(o => !q || fold(o.label).includes(q) || fold(o.group).includes(q)); }
  groups() {
    const out: {name: string; items: Normalized[]}[] = [];
    for (const o of this.filtered()) { let g = out.find(x => x.name === o.group); if (!g) out.push(g = {name: o.group, items: []}); g.items.push(o); }
    return out;
  }
  /** Flat order as rendered (grouped), used for keyboard navigation. */
  private flat() { return this.groups().flatMap(g => g.items); }
  indexOf(o: Normalized) { return this.flat().findIndex(x => x.value === o.value); }
  isActive(o: Normalized) { return this.indexOf(o) === this.active; }
  optId(o: Normalized) { return this.listId + '-' + this.norm().findIndex(x => x.value === o.value); }
  activeId() { const o = this.flat()[this.active]; return o ? this.optId(o) : null; }

  // Stable identities: without these Angular rebuilds the option buttons on every mousedown and the click is lost.
  trackGroup = (_: number, g: {name: string}) => g.name;
  trackOption = (_: number, o: Normalized) => o.value;
  toggle() { this.open ? this.close() : this.show(); }
  show() {
    if (this.disabled) return;
    this.open = true; this.query = '';
    this.active = Math.max(0, this.flat().findIndex(o => o.value === this.value));
    setTimeout(() => { this.filterBox?.nativeElement.focus(); this.scrollActive(); });
  }
  close(refocus = false) { this.open = false; if (refocus) setTimeout(() => this.field?.nativeElement.focus()); }
  pick(o: Normalized) { this.value = o.value; this.valueChange.emit(o.value); this.close(true); }

  onKey(e: KeyboardEvent) {
    if (this.disabled) return;
    const items = this.flat();
    if (!this.open) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.show(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active = Math.min(items.length - 1, this.active + 1); this.scrollActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active = Math.max(0, this.active - 1); this.scrollActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = items[this.active] || items[0]; if (o) this.pick(o); }
    else if (e.key === 'Escape') { e.preventDefault(); this.close(true); }
    else if (e.key === 'Tab') { this.close(); }
  }
  private scrollActive() {
    setTimeout(() => {
      const id = this.activeId();
      if (id) this.host.nativeElement.querySelector('#' + CSS.escape(id))?.scrollIntoView({block: 'nearest'});
    });
  }

  @HostListener('document:mousedown', ['$event'])
  onOutside(e: MouseEvent) { if (this.open && !this.host.nativeElement.contains(e.target as Node)) this.close(); }
}
